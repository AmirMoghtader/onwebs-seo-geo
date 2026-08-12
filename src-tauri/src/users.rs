// Telemetry removed.
//
// Upstream RustySEO POSTed this install's persistent UUID (`settings.rustyid`)
// plus a timestamp to https://api.rustyseo.com/users/ on every single launch.
// This build does not report to any vendor endpoint, so the function is kept
// only as an inert stub in case something else ever links against it.

#[allow(dead_code)]
pub async fn add_user() -> Result<(), String> {
    Ok(())
}
