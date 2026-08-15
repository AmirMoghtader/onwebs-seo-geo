//! Where this app is allowed to write.
//!
//! Every store in the codebase reached for `ProjectDirs::from("", "", "rustyseo")`,
//! which answers correctly on the three desktop platforms and returns `None` on
//! Android — that OS has no XDG-style location, only a directory the system
//! hands the app at runtime. So the phone build failed the moment it tried to
//! open the crawl database:
//!
//! ```text
//! Failed to create database: Failed to create project directories:
//! Failed to get project directories
//! ```
//!
//! Tauri knows the answer on every platform, but only through an `AppHandle`,
//! which the storage code does not have. So the handle is asked once during
//! setup and the result parked here for everyone else to read.

use std::path::PathBuf;
use std::sync::OnceLock;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Android's per-app storage, worked out without an `AppHandle`.
///
/// Settings are read before `setup` runs, so waiting for Tauri to hand us a
/// directory is too late — on the phone that read failed and the app started
/// with defaults every time. The path is derived from the process's own
/// package name rather than hardcoded, so it survives a rename.
#[cfg(target_os = "android")]
fn android_data_dir() -> Option<PathBuf> {
    let cmdline = std::fs::read_to_string("/proc/self/cmdline").ok()?;
    let package = cmdline.split('\0').next()?.trim();
    if package.is_empty() {
        return None;
    }
    let dir = PathBuf::from(format!("/data/data/{}/files", package));
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[cfg(not(target_os = "android"))]
fn android_data_dir() -> Option<PathBuf> {
    None
}

/// Records the directory Tauri resolved for this platform. Called once from
/// `setup`, before any command can run.
pub fn set_app_data_dir(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

/// The directory this app stores data in.
///
/// Prefers what Tauri resolved, because it is the only answer that is right on
/// Android. Falls back to `ProjectDirs` so anything running before setup — or
/// in a unit test, where there is no Tauri app at all — still works.
pub fn data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = APP_DATA_DIR.get() {
        return Ok(dir.clone());
    }
    if let Some(dir) = android_data_dir() {
        return Ok(dir);
    }
    directories::ProjectDirs::from("", "", "rustyseo")
        .map(|dirs| dirs.data_dir().to_path_buf())
        .ok_or_else(|| {
            "No writable app directory: Tauri had not resolved one yet and this \
             platform has no project-directory convention"
                .to_string()
        })
}

/// Where configuration lives. Tauri hands Android one directory for
/// everything, so config and data share it there; on desktop this stays the
/// platform's own config location.
pub fn config_dir() -> Result<PathBuf, String> {
    if let Some(dir) = APP_DATA_DIR.get() {
        return Ok(dir.clone());
    }
    if let Some(dir) = android_data_dir() {
        return Ok(dir);
    }
    directories::ProjectDirs::from("", "", "rustyseo")
        .map(|dirs| dirs.config_dir().to_path_buf())
        .ok_or_else(|| "No writable config directory on this platform".to_string())
}

/// A stand-in for `directories::ProjectDirs` that also has an answer on
/// Android. Same shape on purpose: every call site kept its own `expect` or
/// `ok_or_else`, so swapping the constructor changed nothing else.
pub struct AppDirs {
    data: PathBuf,
    config: PathBuf,
}

impl AppDirs {
    pub fn data_dir(&self) -> &std::path::Path {
        &self.data
    }

    pub fn config_dir(&self) -> &std::path::Path {
        &self.config
    }
}

/// Replaces `ProjectDirs::from("", "", "rustyseo")` throughout the crate.
///
/// On Android that call returns `None` — there is no XDG convention there —
/// and 41 call sites turned that `None` into a panic or an error. Each of
/// those was a way for the phone app to die on its first write.
pub fn project_dirs() -> Option<AppDirs> {
    if let Some(dir) = APP_DATA_DIR.get() {
        // Android hands the app one directory; data and config share it.
        return Some(AppDirs { data: dir.clone(), config: dir.clone() });
    }
    if let Some(dir) = android_data_dir() {
        return Some(AppDirs { data: dir.clone(), config: dir });
    }
    directories::ProjectDirs::from("", "", "rustyseo").map(|dirs| AppDirs {
        data: dirs.data_dir().to_path_buf(),
        config: dirs.config_dir().to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_when_tauri_has_not_answered() {
        // Unit tests run with no Tauri app, which is exactly the fallback path.
        assert!(data_dir().is_ok(), "desktop test runs must resolve a directory");
    }
}
