//! The native macOS menu bar.
//!
//! Screaming Frog puts File / View / Mode / Configuration / Bulk Export /
//! Reports / … up in the system menu bar, where a desktop app's menus belong.
//! Ours were drawn inside the window, which cost a row of vertical space and
//! did not behave like a Mac app — no keyboard traversal, no ⌘-shortcuts, and
//! they scrolled away with the content.
//!
//! Each item emits `native_menu` with its id; the frontend listens once and
//! routes the id to the handler that the in-window menu already used, so the
//! two stay in step rather than growing separate implementations.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// (id, label) for one menu entry. Ids match what the frontend switches on.
type Entry = (&'static str, &'static str);

const FILE: &[Entry] = &[
    ("crawl.start", "Start Crawl"),
    ("crawl.pause", "Pause Crawl"),
    ("crawl.stop", "Stop Crawl"),
    ("-", ""),
    ("file.openCrawl", "Open Crawl…"),
    ("file.saveCrawl", "Save Crawl…"),
    ("-", ""),
    ("file.openConfigFolder", "Open Config Folder"),
];

// Configuration absorbs Mode and the individual config panes, which all open
// the same window anyway — eleven top-level menus was more than the bar could
// hold without wrapping.
const CONFIGURATION: &[Entry] = &[
    ("config.crawlConfig", "Crawl Config…"),
    ("-", ""),
    ("mode.single", "Mode: Single Page"),
    ("mode.spider", "Mode: Full Site Crawl"),
    ("mode.list", "Mode: URL List"),
    ("-", ""),
    ("config.customSearch", "Custom Search"),
    ("config.customExtraction", "Custom Extraction"),
];

// Everything that produces a file lives under Export: the named reports and
// the bulk slices, which were two separate menus doing the same kind of job.
const EXPORT: &[Entry] = &[
    ("reports.crawlOverview", "Crawl Overview"),
    ("reports.redirects", "Redirects"),
    ("reports.insecureContent", "Insecure Content"),
    ("reports.orphanPages", "Orphan Pages"),
    ("reports.duplicateTitles", "Duplicate Page Titles"),
    ("reports.canonicalErrors", "Canonical Errors"),
    ("reports.serpSummary", "SERP Summary"),
    ("-", ""),
    ("bulk.allUrls", "Bulk: All URLs"),
    ("bulk.links", "Bulk: Links"),
    ("bulk.responseCodes", "Bulk: Response Codes"),
    ("bulk.images", "Bulk: Images"),
    ("-", ""),
    ("reports.crawlPdf", "Crawl Report (PDF)"),
];

// Tools, Connections, Sitemaps and Visualisations were four menus of a handful
// of items each; together they are one reasonable menu.
const TOOLS: &[Entry] = &[
    ("vis.open", "Visualisations…"),
    ("sitemaps.view", "Sitemap Review"),
    ("-", ""),
    ("tools.imageConverter", "Image Converter"),
    ("tools.diffChecker", "Diff Checker"),
    ("tools.serpKeywords", "SERP Keywords"),
    ("view.urlChecker", "URL Checker"),
    ("-", ""),
    ("conn.searchConsole", "Search Console"),
    ("conn.analytics", "Google Analytics"),
    ("conn.clarity", "Microsoft Clarity"),
    ("conn.powerBi", "Power BI"),
    ("conn.ollama", "Ollama"),
    ("conn.gemini", "Gemini"),
];

const VIEW: &[Entry] = &[
    ("view.toggleTheme", "Toggle Dark Mode"),
    ("view.panes", "Panes…"),
    ("-", ""),
    ("lang.fa", "زبان: فارسی"),
    ("lang.en", "Language: English"),
];

const HELP: &[Entry] = &[
    ("help.about", "About Onwebs SEO & GEO"),
    ("help.suggestion", "Send a Suggestion"),
];

fn submenu<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    entries: &[Entry],
) -> tauri::Result<Submenu<R>> {
    let sub = Submenu::new(app, title, true)?;
    for (id, label) in entries {
        if *id == "-" {
            sub.append(&PredefinedMenuItem::separator(app)?)?;
        } else {
            // Crawl controls get the shortcuts you would reach for.
            let accel = match *id {
                "crawl.start" => Some("CmdOrCtrl+Return"),
                "crawl.pause" => Some("CmdOrCtrl+P"),
                "crawl.stop" => Some("CmdOrCtrl+."),
                "file.openCrawl" => Some("CmdOrCtrl+O"),
                "file.saveCrawl" => Some("CmdOrCtrl+S"),
                _ => None,
            };
            sub.append(&MenuItem::with_id(app, *id, *label, true, accel)?)?;
        }
    }
    Ok(sub)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    // The app menu keeps the standard macOS entries — About, Hide, Quit —
    // which users expect to be there and which the window menubar never had.
    let app_menu = Submenu::new(app, "Onwebs SEO & GEO", true)?;
    app_menu.append(&MenuItem::with_id(
        app,
        "help.about",
        "About Onwebs SEO & GEO",
        true,
        None::<&str>,
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&MenuItem::with_id(
        app,
        "file.settings",
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::quit(app, None)?)?;
    menu.append(&app_menu)?;

    menu.append(&submenu(app, "File", FILE)?)?;

    // Edit is predefined so copy/paste and select-all work inside inputs.
    let edit = Submenu::new(app, "Edit", true)?;
    edit.append(&PredefinedMenuItem::undo(app, None)?)?;
    edit.append(&PredefinedMenuItem::redo(app, None)?)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit.append(&PredefinedMenuItem::select_all(app, None)?)?;
    menu.append(&edit)?;

    menu.append(&submenu(app, "View", VIEW)?)?;
    menu.append(&submenu(app, "Configuration", CONFIGURATION)?)?;
    menu.append(&submenu(app, "Export", EXPORT)?)?;
    menu.append(&submenu(app, "Tools", TOOLS)?)?;

    let window = Submenu::new(app, "Window", true)?;
    window.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window.append(&PredefinedMenuItem::maximize(app, None)?)?;
    window.append(&PredefinedMenuItem::separator(app)?)?;
    window.append(&PredefinedMenuItem::close_window(app, None)?)?;
    menu.append(&window)?;

    menu.append(&submenu(app, "Help", HELP)?)?;

    Ok(menu)
}

/// Forwards a menu click to the frontend. Everything the menus do already has
/// a handler there; this only carries the id across.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("native_menu", id);
    } else {
        let _ = app.emit("native_menu", id);
    }
}
