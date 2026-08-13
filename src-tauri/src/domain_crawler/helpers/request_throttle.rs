use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;
use tokio::time::sleep;

/// Shared pacing and adaptive backoff for primary crawl requests.
///
/// A delay of zero is genuinely unlimited: there is no hidden floor. When a
/// delay is configured, request starts are spaced globally. Network
/// concurrency is enforced separately by the request semaphore.
pub struct CrawlThrottle {
    adaptive: bool,
    base_delay_ms: u64,
    min_delay_ms: u64,
    max_delay_ms: u64,
    current_delay_ms: AtomicU64,
    cooldown_until_ms: AtomicU64,
    next_request_at: Mutex<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackoffState {
    pub delay_ms: u64,
    pub cooldown_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitOutcome {
    Ready,
    Stopped,
}

impl CrawlThrottle {
    pub fn new(
        adaptive: bool,
        base_delay_ms: u64,
        min_delay_ms: u64,
        max_delay_ms: u64,
    ) -> Self {
        let max_delay_ms = max_delay_ms.max(min_delay_ms).max(base_delay_ms);
        let initial = base_delay_ms.clamp(min_delay_ms, max_delay_ms);
        Self {
            adaptive,
            base_delay_ms,
            min_delay_ms,
            max_delay_ms,
            current_delay_ms: AtomicU64::new(initial),
            cooldown_until_ms: AtomicU64::new(0),
            next_request_at: Mutex::new(Instant::now()),
        }
    }

    pub fn current_delay_ms(&self) -> u64 {
        if self.adaptive {
            self.current_delay_ms.load(Ordering::Acquire)
        } else {
            self.base_delay_ms
        }
    }

    pub fn cooldown_remaining_ms(&self) -> u64 {
        self.cooldown_until_ms
            .load(Ordering::Acquire)
            .saturating_sub(epoch_millis())
    }

    /// Wait until a request is allowed to start. Pause and Stop are checked in
    /// short slices so controls remain responsive during long server cooldowns.
    pub async fn wait(
        &self,
        control: Option<&Arc<std::sync::atomic::AtomicU8>>,
    ) -> WaitOutcome {
        loop {
            match control.map(|flag| flag.load(Ordering::Acquire)) {
                Some(2) => return WaitOutcome::Stopped,
                Some(1) => {
                    sleep(Duration::from_millis(50)).await;
                    continue;
                }
                _ => {}
            }

            let cooldown = self.cooldown_remaining_ms();
            if cooldown > 0 {
                sleep(Duration::from_millis(cooldown.min(100))).await;
                continue;
            }

            // Keep the scheduler lock until this request actually receives its
            // start slot. Reserving a future slot before sleeping leaves stale
            // reservations behind when Pause or a server cooldown interrupts
            // the sleep, which can add an entire extra delay after Resume.
            let mut next = self.next_request_at.lock().await;
            loop {
                match control.map(|flag| flag.load(Ordering::Acquire)) {
                    Some(2) => return WaitOutcome::Stopped,
                    Some(1) => break,
                    _ => {}
                }

                let cooldown = self.cooldown_remaining_ms();
                if cooldown > 0 {
                    break;
                }

                let spacing_ms = self.current_delay_ms();
                if spacing_ms == 0 {
                    return WaitOutcome::Ready;
                }

                let now = Instant::now();
                let wait_for = (*next).saturating_duration_since(now);
                if wait_for.is_zero() {
                    // Record the next slot only when this request is actually
                    // released. Late wakeups therefore cannot create bursts.
                    *next = now + Duration::from_millis(spacing_ms);
                    return WaitOutcome::Ready;
                }

                sleep(wait_for.min(Duration::from_millis(50))).await;
            }
        }
    }

    pub fn on_rate_limited(&self, retry_after: Option<Duration>) -> BackoffState {
        let current = self.current_delay_ms.load(Ordering::Acquire);
        let floor = self.min_delay_ms.max(250);
        let proposed = current.max(floor).saturating_mul(2).max(1_000);
        let delay = proposed.min(self.max_delay_ms);

        if self.adaptive {
            let _ = self.current_delay_ms.fetch_update(
                Ordering::AcqRel,
                Ordering::Acquire,
                |seen| Some(seen.max(delay).min(self.max_delay_ms)),
            );
        }

        // `max_delay_ms` bounds the adaptive request spacing, not an explicit
        // server Retry-After directive. Stop remains responsive because wait()
        // sleeps in short slices even for a long server cooldown.
        let cooldown_ms = retry_after
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(delay.max(1_000));
        let until = epoch_millis().saturating_add(cooldown_ms);
        self.cooldown_until_ms.fetch_max(until, Ordering::AcqRel);

        BackoffState {
            delay_ms: self.current_delay_ms(),
            cooldown_ms,
        }
    }

    pub fn on_success(&self) {
        if !self.adaptive || self.cooldown_remaining_ms() > 0 {
            return;
        }
        let _ = self.current_delay_ms.fetch_update(
            Ordering::AcqRel,
            Ordering::Acquire,
            |current| {
                let decrement = (current / 20).max(1);
                Some(current.saturating_sub(decrement).max(self.min_delay_ms))
            },
        );
    }

    pub fn on_network_error(&self) {
        if !self.adaptive {
            return;
        }
        let _ = self.current_delay_ms.fetch_update(
            Ordering::AcqRel,
            Ordering::Acquire,
            |current| Some(current.saturating_add(100).min(self.max_delay_ms)),
        );
    }
}

fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn zero_delay_has_no_hidden_floor() {
        let throttle = CrawlThrottle::new(false, 0, 0, 30_000);
        let start = Instant::now();
        for _ in 0..100 {
            assert_eq!(throttle.wait(None).await, WaitOutcome::Ready);
        }
        assert!(start.elapsed() < Duration::from_millis(25));
    }

    #[tokio::test]
    async fn fixed_mode_uses_base_delay_not_random_max_delay() {
        let throttle = CrawlThrottle::new(false, 20, 0, 30_000);
        assert_eq!(throttle.wait(None).await, WaitOutcome::Ready);
        let start = Instant::now();
        assert_eq!(throttle.wait(None).await, WaitOutcome::Ready);
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::from_millis(15));
        assert!(elapsed < Duration::from_millis(250));
    }

    #[tokio::test]
    async fn stop_interrupts_pause_wait() {
        let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
        let control = Arc::new(std::sync::atomic::AtomicU8::new(1));
        let waiter = {
            let throttle = throttle.clone();
            let control = control.clone();
            tokio::spawn(async move { throttle.wait(Some(&control)).await })
        };
        sleep(Duration::from_millis(20)).await;
        control.store(2, Ordering::Release);
        assert_eq!(waiter.await.unwrap(), WaitOutcome::Stopped);
    }

    #[tokio::test]
    async fn pause_does_not_leave_a_stale_future_reservation() {
        let throttle = Arc::new(CrawlThrottle::new(false, 150, 0, 30_000));
        let control = Arc::new(std::sync::atomic::AtomicU8::new(0));
        assert_eq!(throttle.wait(Some(&control)).await, WaitOutcome::Ready);

        let waiter = {
            let throttle = throttle.clone();
            let control = control.clone();
            tokio::spawn(async move { throttle.wait(Some(&control)).await })
        };
        sleep(Duration::from_millis(20)).await;
        control.store(1, Ordering::Release);
        sleep(Duration::from_millis(180)).await;

        control.store(0, Ordering::Release);
        let resumed = tokio::time::timeout(Duration::from_millis(100), waiter)
            .await
            .expect("resume should not wait for a stale reserved slot")
            .unwrap();
        assert_eq!(resumed, WaitOutcome::Ready);
    }

    #[test]
    fn rate_limit_respects_configured_maximum() {
        let throttle = CrawlThrottle::new(true, 0, 0, 2_000);
        for _ in 0..10 {
            throttle.on_rate_limited(None);
        }
        assert_eq!(throttle.current_delay_ms(), 2_000);
    }

    #[test]
    fn explicit_retry_after_is_not_clipped_by_adaptive_delay_cap() {
        let throttle = CrawlThrottle::new(true, 0, 0, 2_000);
        let state = throttle.on_rate_limited(Some(Duration::from_secs(7)));
        assert_eq!(state.delay_ms, 1_000);
        assert_eq!(state.cooldown_ms, 7_000);
        assert!(throttle.cooldown_remaining_ms() >= 6_900);
    }
}
