"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";

// get_local_version_command (not version_check_command) is used here: the
// latter blocks on a live GitHub API round-trip before resolving even the
// local value, so by the time it returned the splash had already dismissed.

// Palette taken from onwebs.ir: a deep navy on a pale blue-grey field, with
// white cards. The previous splash was near-black with a violet glow, which
// belonged to a different product entirely.
const NAVY = "#1E3A6F";
const NAVY_DEEP = "#16294F";
const ACCENT = "#2B6CC4";
const CANVAS = "#EEF2F9";

const Loader = () => {
  const loadingMessages = useMemo(
    () => [
      "آماده‌سازی فضای کاری",
      "راه‌اندازی پایگاه داده",
      "بارگذاری تنظیمات کراول",
      "آماده‌سازی موتور تحلیل",
      "تقریباً آماده است",
    ],
    [],
  );

  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Visible by default everywhere: the server renders "visible", and the
  // client's FIRST render must agree with it or React reports a hydration
  // mismatch on every reload after the first (when the session flag exists).
  // Intra-session reloads are dismissed by the effect below instead.
  const [isVisible, setIsVisible] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    if (sessionStorage?.getItem("hasInitiallyLoaded")) setIsVisible(false);
  }, []);

  useEffect(() => {
    invoke<string>("get_local_version_command").then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const messageInterval = setInterval(() => {
      setMessageIndex((i) => (i === loadingMessages.length - 1 ? 0 : i + 1));
    }, 2200);

    // Dismiss as soon as the app is actually ready, not after a fixed wait.
    // MIN keeps the animation from flashing by; MAX is a safety net in case
    // `load` never fires; EXPECTED paces the bar so it reads as real progress.
    const MIN_DISPLAY_MS = 1600;
    const MAX_DISPLAY_MS = 10000;
    const EXPECTED_MS = 2400;
    const start = Date.now();

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(96, Math.round((elapsed / EXPECTED_MS) * 100)));
    }, 100);

    const dismiss = () => {
      setProgress(100);
      setIsVisible(false);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("hasInitiallyLoaded", "true");
      }
    };

    let dismissTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleDismiss = () => {
      const remaining = Math.max(0, MIN_DISPLAY_MS - (Date.now() - start));
      dismissTimeout = setTimeout(dismiss, remaining);
    };

    if (typeof document !== "undefined" && document.readyState === "complete") {
      scheduleDismiss();
    } else if (typeof window !== "undefined") {
      window.addEventListener("load", scheduleDismiss, { once: true });
    }

    const maxTimeout = setTimeout(dismiss, MAX_DISPLAY_MS);

    return () => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
      if (dismissTimeout) clearTimeout(dismissTimeout);
      clearTimeout(maxTimeout);
      if (typeof window !== "undefined") {
        window.removeEventListener("load", scheduleDismiss);
      }
    };
  }, [loadingMessages, isVisible]);

  if (pathname === "/global") return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="app-loader"
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center overflow-hidden"
          style={{ background: CANVAS, opacity: 1 }}
        >
          {/* Soft blurred field behind the card, echoing the site's hero. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `radial-gradient(60% 50% at 30% 20%, ${ACCENT}14 0%, transparent 70%),
                           radial-gradient(50% 40% at 80% 80%, ${NAVY}10 0%, transparent 70%)`,
            }}
          />

          {/* The card */}
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="relative flex flex-col items-center rounded-3xl bg-white px-14 py-12"
            style={{ boxShadow: "0 24px 60px rgba(30,58,111,0.12)" }}
          >
            {/* Mark, breathing rather than spinning — a spinner next to a
                progress bar says the same thing twice. */}
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="mb-6"
            >
              <img
                src="/icon.png"
                alt=""
                className="w-16 h-16 object-contain"
                style={{ filter: "drop-shadow(0 6px 14px rgba(30,58,111,0.18))" }}
              />
            </motion.div>

            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="text-[26px] font-bold tracking-tight"
                style={{ color: NAVY_DEEP }}
              >
                onwebs
              </span>
              <span
                className="text-[12px] font-semibold"
                style={{ color: ACCENT }}
              >
                SEO &amp; GEO
              </span>
            </div>

            <div className="h-5 mb-7 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.p
                  key={messageIndex}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -12, opacity: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="text-[12px]"
                  style={{ color: "#64748B" }}
                >
                  {loadingMessages[messageIndex]}
                </motion.p>
              </AnimatePresence>
            </div>

            <div
              className="w-64 h-[5px] rounded-full overflow-hidden"
              style={{ background: "#E2E8F0" }}
            >
              <motion.div
                className="h-full rounded-full"
                animate={{ width: `${progress}%` }}
                transition={{ ease: "easeOut", duration: 0.25 }}
                style={{
                  background: `linear-gradient(90deg, ${NAVY} 0%, ${ACCENT} 100%)`,
                }}
              />
            </div>

            <div className="mt-3 flex items-center gap-2 text-[10px] font-mono" style={{ color: "#94A3B8" }}>
              <span>{progress}%</span>
              {appVersion && (
                <>
                  <span>·</span>
                  <span>v{appVersion}</span>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Loader;
