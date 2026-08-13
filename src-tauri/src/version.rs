use serde::Serialize;

pub fn local_version() -> String {
    // Cargo.toml is the authoritative backend version. Keeping a second
    // handwritten value here previously made the 0.1.0 application report
    // itself as RustySEO 0.4.0 and also triggered destructive config resets.
    env!("CARGO_PKG_VERSION").to_string()
}

// Unlike version_check_command, this never touches the network — it's for
// callers (e.g. the boot splash) that need the local version immediately
// and don't care whether it's the latest release.
#[tauri::command]
pub fn get_local_version_command() -> String {
    local_version()
}

#[derive(Serialize)]
pub struct Versions {
    pub local: String,
    pub github: String,
}

// Update check removed.
//
// Upstream queried api.github.com/repos/mascanho/rustyseo/releases/latest on
// every launch, which (a) told GitHub the app had started, and (b) called
// `.unwrap()` on the result — so any offline or blocked launch panicked inside
// the command handler. This build reports the local version as both values, so
// callers always see "up to date" and no request leaves the machine.
#[tauri::command]
pub async fn version_check_command() -> Result<Versions, String> {
    let local = local_version();

    Ok(Versions {
        github: local.clone(),
        local,
    })
}
