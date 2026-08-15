
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::{domain_crawler::domain_crawler, AppState};

use super::{
    database::{self, DiffAnalysis},
    duplicate_content::{self, DuplicateGroup},
    excel::create_xlsx::{
        generate_css_table, generate_excel_main_table, generate_excel_two_cols,
        generate_keywords_excel, generate_links_table_excel, generate_xlsx,
    },
};

#[tauri::command]
pub async fn domain_crawl_command(
    domain: String,
    app_handle: tauri::AppHandle,
    settings_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let active = settings_state.crawl_active.clone();
    if active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A crawl is already running. Stop it before starting another crawl.".to_string());
    }

    // Clear the previous crawl's stop/pause flag right after claiming the slot
    // and before the first await. `crawl_domain` used to reset this only once
    // the database had been initialised and cleared, so a Stop pressed during
    // that window was silently discarded.
    settings_state.crawl_control.store(0, Ordering::Relaxed);

    struct ActiveCrawlGuard(Arc<std::sync::atomic::AtomicBool>);
    impl Drop for ActiveCrawlGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _active_crawl_guard = ActiveCrawlGuard(active);

    // Create and initialize the database
    let mut db = match database::Database::new("deep_crawl_batches.db") {
        Ok(db) => db,
        Err(e) => {
            let error_msg = format!("Failed to create database: {}", e);
            eprintln!("{}", error_msg);
            return Err(error_msg);
        }
    };

    // Initialize the database (create tables)
    if let Err(e) = db.initialize().await {
        let error_msg = format!("Failed to initialize database: {}", e);
        eprintln!("{}", error_msg);
        return Err(error_msg);
    }

    // Clear existing data from the database
    if let Err(e) = db.clear().await {
        let error_msg = format!("Failed to clear database: {}", e);
        eprintln!("{}", error_msg);
        return Err(error_msg);
    }

    // Call the crawl_domain function with a clone of the database
    match domain_crawler::crawl_domain(&domain, app_handle, Ok(db.clone()), settings_state).await {
        Ok(_) => {
            println!("Crawl finished successfully.");
            // Verify database contents using the original db
            match db.count_rows().await {
                Ok(count) => println!("Database contains {} rows after crawl", count),
                Err(e) => eprintln!("Failed to count rows: {}", e),
            }
            Ok(())
        }
        Err(e) => {
            eprintln!("Crawl error: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn create_excel(data: Vec<Value>) -> Result<Vec<u8>, String> {
    // Call the export_to_excel function and handle its result
    match generate_xlsx(data) {
        Ok(file) => Ok(file),
        Err(e) => {
            eprintln!("Error: {}", e);
            // Explicitly return the error
            Err(e)
        }
    }
}

// GENERATE THE EXCEL FROM THE MAIN TABLE
#[tauri::command]
pub async fn create_excel_main_table(
    data: Vec<Value>,
    visible_columns: Option<Vec<bool>>,
) -> Result<Vec<u8>, String> {
    match generate_excel_main_table(data, visible_columns) {
        Ok(file) => Ok(file),
        Err(e) => {
            // eprintln!("Error: {}", e);
            // Explicitly return the error
            Err(e)
        }
    }
}

// GENERATE EXCEL DIRECTLY FROM SQLITE WITHOUT FRONTEND LIMITS
#[tauri::command]
pub async fn export_full_crawl_to_excel_command(
    visible_columns: Option<Vec<bool>>,
) -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;

    // Fetch all raw data from SQLite (bypassing frontend memory limits)
    let all_data: Vec<Value> = db.get_all_crawl_data().await
        .map_err(|e| e.to_string())?;

    // Generate Excel
    match generate_excel_main_table(all_data, visible_columns) {
        Ok(file) => Ok(file),
        Err(e) => Err(e),
    }
}

// CREATE THE EXCEL FROM THE TABLE
#[tauri::command]
pub async fn create_excel_two_cols(data: Vec<Value>) -> Result<Vec<u8>, String> {
    match generate_excel_two_cols(data) {
        Ok(file) => Ok(file),
        Err(e) => {
            eprintln!("Error: {}", e);
            Err(e)
        }
    }
}

// CREATE THE CSS EXCEL FROM THE TABLE
#[tauri::command]
pub async fn create_css_excel(data: Vec<Value>) -> Result<Vec<u8>, String> {
    match generate_css_table(data) {
        Ok(file) => Ok(file),
        Err(e) => {
            eprintln!("Error: {}", e);
            Err(e)
        }
    }
}

// CREATE THE EXCEL FROM THE KEYWORDS TABLE
#[tauri::command]
pub async fn create_keywords_excel_command(data: Vec<Value>) -> Result<Vec<u8>, String> {
    match generate_keywords_excel(data) {
        Ok(file) => Ok(file),
        Err(e) => {
            eprintln!("Error: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn generate_links_table_xlsx_command(data: Vec<Value>) -> Result<Vec<u8>, String> {
    match generate_links_table_excel(data) {
        Ok(file) => Ok(file),
        Err(e) => {
            eprintln!("Error: {}", e);
            Err(e)
        }
    }
}

// GET THE DIFFERENCES BETWWEN THE CRAWLS
#[tauri::command]
pub async fn get_url_diff_command() -> Result<DiffAnalysis, String> {
    database::analyse_diffs().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clone_crawl_data_command() -> Result<(), String> {
    database::clone_batched_crawl_into_persistent_db()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_crawl_snapshot_command(session_id: i64) -> Result<usize, String> {
    database::restore_crawl_snapshot(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_crawl_file_command(
    path: String,
) -> Result<database::CrawlFileInfo, String> {
    database::save_crawl_file(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_crawl_file_command(
    path: String,
) -> Result<database::CrawlFileInfo, String> {
    database::open_crawl_file(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_url_data_command(url: String) -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_url_data(url).await.map_err(|e| e.to_string())
}

// On-demand screenshot for the crawl report cover page — deliberately
// independent of PageSpeed Insights (opt-in, often not run) and the JS
// crawling setting; launches its own short-lived headless Chrome tab.
#[tauri::command]
pub async fn capture_page_screenshot_command(url: String) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = url;
        return Err("Screenshots are not available on mobile".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    tokio::task::spawn_blocking(move || super::helpers::screenshot::capture_page_screenshot(&url))
        .await
        .map_err(|e| format!("Screenshot task panicked: {}", e))?
}

#[tauri::command]
pub async fn get_aggregated_crawl_data_command(data_type: String) -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_aggregated_crawl_data(data_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_links_page_command(
    data_type: String,
    limit: i64,
    offset: i64,
) -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_links_page(data_type, limit, offset).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_incoming_links_command(target_url: String) -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_incoming_links(target_url).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_crawl_page_command(
    limit: i64,
    offset: i64,
    search: Option<String>,
) -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_crawl_page(limit, offset, search).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_crawl_total_count_command(search: Option<String>) -> Result<i64, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_crawl_total_count(search).await.map_err(|e| e.to_string())
}

/// How many internal links point *at* each URL, and from how many distinct
/// pages.
///
/// Screaming Frog's Inlinks and Unique Inlinks. The crawl stores links the way
/// it finds them — outward, per page — so the inbound side has to be obtained
/// by inverting the graph, which no single page can do for itself. The table
/// tried to invert it in the browser and got zeros, because the paged query
/// deliberately strips the link arrays before they reach it; the details drawer
/// read `inlinks_count`, a field nothing had ever produced.
///
/// Inverting here means one pass over data already in SQLite and an answer
/// bounded by the number of distinct targets rather than the number of links.
#[tauri::command]
pub async fn get_inlink_counts_command() -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_inlink_counts().await.map_err(|e| e.to_string())
}

/// Re-crawls a chosen set of URLs, replacing their rows in place.
///
/// A failed URL is a row like any other — status 0 with the reason in
/// `crawl_error` — so the fix is not to crawl the site again but to ask these
/// specific addresses one more time. Most failures are the host having a bad
/// moment: of 27 failures in one websima.com crawl, every one fetched fine
/// when asked again on its own.
///
/// The whole-crawl clear is deliberately skipped. The insert upserts on `url`,
/// so a URL that now answers replaces its own failed row and everything else
/// in the table is left untouched.
#[tauri::command]
pub async fn retry_urls_command(
    urls: Vec<String>,
    app_handle: tauri::AppHandle,
    settings_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if urls.is_empty() {
        return Err("No URLs given to retry.".to_string());
    }

    // The origin the crawler treats as "internal" for this run. Retries always
    // come from one crawl, so the first URL settles it.
    let base = urls
        .first()
        .and_then(|u| url::Url::parse(u).ok())
        .ok_or_else(|| format!("Not a valid URL: {}", urls[0]))?;

    let active = settings_state.crawl_active.clone();
    if active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A crawl is already running. Stop it before retrying.".to_string());
    }
    settings_state.crawl_control.store(0, Ordering::Relaxed);

    struct ActiveCrawlGuard(Arc<std::sync::atomic::AtomicBool>);
    impl Drop for ActiveCrawlGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _active_crawl_guard = ActiveCrawlGuard(active);

    // List mode already means "crawl exactly these URLs and discover nothing".
    // It lives in the shared settings, so the previous values are restored
    // however this function leaves — including on a panic in the crawl.
    struct SettingsRestore {
        state: Arc<tokio::sync::RwLock<crate::settings::settings::Settings>>,
        list_mode: bool,
        list_urls: Vec<String>,
    }
    impl Drop for SettingsRestore {
        fn drop(&mut self) {
            let state = self.state.clone();
            let list_mode = self.list_mode;
            let list_urls = std::mem::take(&mut self.list_urls);
            tokio::spawn(async move {
                let mut settings = state.write().await;
                settings.list_mode = list_mode;
                settings.list_urls = list_urls;
            });
        }
    }

    let _restore = {
        let mut settings = settings_state.settings.write().await;
        let restore = SettingsRestore {
            state: settings_state.settings.clone(),
            list_mode: settings.list_mode,
            list_urls: settings.list_urls.clone(),
        };
        settings.list_mode = true;
        settings.list_urls = urls;
        restore
    };

    let mut db = database::Database::new("deep_crawl_batches.db")
        .map_err(|e| format!("Failed to open database: {}", e))?;
    db.initialize()
        .await
        .map_err(|e| format!("Failed to initialize database: {}", e))?;

    domain_crawler::crawl_domain(base.as_str(), app_handle, Ok(db), settings_state).await
}

/// Dead external links grouped by destination, with how many pages link to it.
///
/// Screaming Frog found `proxima.academy` failing DNS across websima.com; the
/// same crawl here shows it on 455 pages. Reporting that as one finding with a
/// count is the difference between a fixable instruction and 455 rows.
#[tauri::command]
pub async fn get_broken_links_command() -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_broken_links().await.map_err(|e| e.to_string())
}

/// Measures a site before agreeing to crawl it.
///
/// The phone asks this first so it can warn about — or refuse — a site that
/// would run for hours and fill the device. See `site_size` for the reasoning
/// behind the thresholds.
#[tauri::command]
pub async fn estimate_site_size_command(
    domain: String,
    settings_state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let ua = {
        let settings = settings_state.settings.read().await;
        settings.robots_user_agent.clone()
    };
    let size = crate::domain_crawler::site_size::measure(&domain, &ua).await?;
    serde_json::to_value(size).map_err(|e| e.to_string())
}

/// Crawls a domain, stopping after `max_urls` addresses.
///
/// The phone offers this for a site too large to finish: a sample big enough
/// to judge the site by, rather than a crawl that never ends. The cap is a
/// setting, so it is swapped for the run and restored however this returns.
#[tauri::command]
pub async fn domain_crawl_limited_command(
    domain: String,
    max_urls: usize,
    app_handle: tauri::AppHandle,
    settings_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    struct RestoreCap {
        state: Arc<tokio::sync::RwLock<crate::settings::settings::Settings>>,
        previous: usize,
    }
    impl Drop for RestoreCap {
        fn drop(&mut self) {
            let state = self.state.clone();
            let previous = self.previous;
            tokio::spawn(async move {
                state.write().await.max_urls_per_domain = previous;
            });
        }
    }

    let _restore = {
        let mut settings = settings_state.settings.write().await;
        let restore = RestoreCap {
            state: settings_state.settings.clone(),
            previous: settings.max_urls_per_domain,
        };
        settings.max_urls_per_domain = max_urls;
        restore
    };

    domain_crawl_command(domain, app_handle, settings_state).await
}

/// Empties the current crawl so the next one starts from nothing.
///
/// Screaming Frog has this next to its address bar and we did not, so the only
/// way to get a clean slate was to quit and reopen the app. Only the live
/// results table is emptied — `crawl_snapshots` holds the user's saved crawl
/// history and is not this button's business.
#[tauri::command]
pub async fn clear_crawl_data_command() -> Result<(), String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.clear().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_crawl_summary_stats_command() -> Result<Value, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    db.get_summary_stats().await.map_err(|e| e.to_string())
}

// Returns already-persisted Link Score values (computed automatically at the end of
// the crawl, when enabled in Settings), keyed by URL, so the frontend can merge them
// into the live tables once a crawl finishes.
//
// Scores are looked up only for the URL set the frontend actually holds, so a routine
// completion refresh never pulls the whole crawl through IPC. The count is bounded by
// MAX_IPC_PAGE_SIZE on the database side.
#[tauri::command]
pub async fn get_link_scores_command(urls: Vec<String>) -> Result<Value, String> {
    if urls.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let scores = db
        .get_link_scores_for_urls(urls)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&scores).map_err(|e| e.to_string())
}

// EXPORT DATA DIRECTLY FROM DATABASE - BYPASS FRONTEND MEMORY LIMITS

#[tauri::command]
pub async fn export_images_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let images_data = db.get_aggregated_crawl_data("images".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match images_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_images_excel(data)
        }
        _ => Err("Invalid data format for images".to_string()),
    }
}

#[tauri::command]
pub async fn export_keywords_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let keywords_data = db.get_aggregated_crawl_data("keywords".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match keywords_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_keywords_excel(data)
        }
        _ => Err("Invalid data format for keywords".to_string()),
    }
}

#[tauri::command]
pub async fn export_redirects_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let redirects_data = db.get_aggregated_crawl_data("redirects".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match redirects_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_redirects_excel(data)
        }
        _ => Err("Invalid data format for redirects".to_string()),
    }
}

#[tauri::command]
pub async fn export_internal_links_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let links_data = db.get_aggregated_crawl_data("internal_links".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match links_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_links_table_excel(data)
        }
        _ => Err("Invalid data format for internal links".to_string()),
    }
}

#[tauri::command]
pub async fn export_external_links_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let links_data = db.get_aggregated_crawl_data("external_links".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match links_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_links_table_excel(data)
        }
        _ => Err("Invalid data format for external links".to_string()),
    }
}

#[tauri::command]
pub async fn export_scripts_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let scripts_data = db.get_aggregated_crawl_data("scripts".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match scripts_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_excel_two_cols(data)
        }
        _ => Err("Invalid data format for scripts".to_string()),
    }
}

#[tauri::command]
pub async fn export_files_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let files_data = db.get_aggregated_crawl_data("files".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match files_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_files_excel(data)
        }
        _ => Err("Invalid data format for files".to_string()),
    }
}

#[derive(serde::Serialize)]
pub struct DuplicateContentReport {
    /// Mirrors Settings > Crawler > Duplicated Content Check, so the frontend can
    /// show a "not enabled" state instead of an empty result set.
    pub enabled: bool,
    pub groups: Vec<DuplicateGroup>,
}

// Clusters similar/identical pages from the current crawl using fingerprints computed
// during crawl (only present when Settings > Crawler > Duplicated Content Check was
// enabled at crawl time). Purely reads already-persisted data — safe to call repeatedly
// on demand from the Duplicate Content dashboard tab without re-crawling.
#[tauri::command]
pub async fn find_duplicate_content_command() -> Result<DuplicateContentReport, String> {
    let settings = crate::settings::settings::load_settings().await?;
    if !settings.duplicate_content_check_enabled {
        return Ok(DuplicateContentReport {
            enabled: false,
            groups: Vec::new(),
        });
    }

    let db = database::get_or_create_shared_db()
        .await
        .map_err(|e| e.to_string())?;
    let pages = db.get_all_crawl_data().await.map_err(|e| e.to_string())?;
    let groups = duplicate_content::find_duplicate_groups(&pages);

    Ok(DuplicateContentReport {
        enabled: true,
        groups,
    })
}

#[tauri::command]
pub async fn export_cwv_to_excel_command() -> Result<Vec<u8>, String> {
    let db = database::get_or_create_shared_db().await.map_err(|e| e.to_string())?;
    let cwv_data = db.get_aggregated_crawl_data("cwv".to_string()).await
        .map_err(|e| e.to_string())?;
    
    match cwv_data {
        Value::Array(data) => {
            crate::domain_crawler::excel::create_xlsx::generate_cwv_excel(data)
        }
        _ => Err("Invalid data format for CWV".to_string()),
    }
}

/// Requests every asset URL the Internal view is showing so it can fill in
/// Status Code, Size and Content Type — data the crawl itself never fetches.
#[tauri::command]
pub async fn check_assets_command(
    urls: Vec<String>,
) -> Result<Vec<super::helpers::asset_checker::AssetStatus>, String> {
    Ok(super::helpers::asset_checker::check_assets(urls).await)
}
