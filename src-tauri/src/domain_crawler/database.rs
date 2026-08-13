use directories::ProjectDirs;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{self, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{Mutex, OnceCell};
use url::Url;

use crate::domain_crawler::helpers::normalize_url::normalize_url;

const INTERNAL_LINK_RECONCILE_BATCH_SIZE: usize = 100;
const MAX_IPC_PAGE_SIZE: i64 = 5_000;
const LINK_SCORE_QUERY_CHUNK_SIZE: usize = 500;

fn validate_link_score_url_count(count: usize) -> Result<(), DatabaseError> {
    if count > MAX_IPC_PAGE_SIZE as usize {
        return Err(DatabaseError::QueryError(format!(
            "link score URL count must not exceed {}, got {}",
            MAX_IPC_PAGE_SIZE, count
        )));
    }
    Ok(())
}

fn validate_crawl_page_bounds(limit: i64, offset: i64) -> Result<usize, DatabaseError> {
    if !(1..=MAX_IPC_PAGE_SIZE).contains(&limit) {
        return Err(DatabaseError::QueryError(format!(
            "crawl page limit must be between 1 and {}, got {}",
            MAX_IPC_PAGE_SIZE, limit
        )));
    }
    if offset < 0 {
        return Err(DatabaseError::QueryError(format!(
            "crawl page offset must be non-negative, got {}",
            offset
        )));
    }

    usize::try_from(limit).map_err(|_| {
        DatabaseError::QueryError(format!("crawl page limit cannot fit in memory: {}", limit))
    })
}

fn validate_links_page_bounds(limit: i64, offset: i64) -> Result<i64, DatabaseError> {
    if limit < 0 || limit > MAX_IPC_PAGE_SIZE {
        return Err(DatabaseError::QueryError(format!(
            "links page limit must be 0 or between 1 and {}, got {}",
            MAX_IPC_PAGE_SIZE, limit
        )));
    }
    if offset < 0 {
        return Err(DatabaseError::QueryError(format!(
            "links page offset must be non-negative, got {}",
            offset
        )));
    }

    // Preserve the established explicit full-data contract used by PDF reports.
    Ok(if limit == 0 { -1 } else { limit })
}

/// Distinct destinations in one of the link arrays, ignoring the fragment.
///
/// The table cannot recompute this: the light row deliberately drops the link
/// arrays to keep a large crawl out of memory, and a total is not enough to
/// recover a distinct count from. Sending the number instead of the array
/// costs one pass over JSON already parsed here.
fn unique_link_count(data: &Value, side: &str) -> usize {
    data.get("inoutlinks_status_codes")
        .and_then(|l| l.get(side))
        .and_then(|v| v.as_array())
        .map(|links| {
            links
                .iter()
                .filter_map(|l| l.get("url").and_then(|u| u.as_str()))
                .map(|u| u.split('#').next().unwrap_or(u))
                .collect::<std::collections::HashSet<_>>()
                .len()
        })
        .unwrap_or(0)
}

/// The spelling two URLs must share to count as the same destination: no
/// fragment, no trailing slash. Kept deliberately identical to the frontend's
/// key so a count produced here lands on the row it belongs to.
fn inlink_key(url: &str) -> String {
    let without_fragment = url.split('#').next().unwrap_or(url);
    without_fragment.strip_suffix('/').unwrap_or(without_fragment).to_string()
}

/// Dead links grouped by destination, with how many pages carry each one.
///
/// A single broken link in a footer is one mistake repeated on every page, and
/// counting link instances hides that: what a person needs to hear is "this
/// domain is dead and 455 of your pages point at it", not 455 separate
/// findings. Grouping happens here because the paged query strips the link
/// arrays before the frontend ever sees them.
fn broken_links_from(conn: &Connection) -> Result<Value, DatabaseError> {
    /// Per destination. Enough to drive the issue list without letting one
    /// site-wide dead link drag every URL of a large crawl across IPC.
    const MAX_BROKEN_LINK_SOURCES: usize = 1_000;

    let mut stmt = conn.prepare(
        "SELECT json_extract(data, '$.url'), \
                json_extract(json_each.value, '$.url'), \
                json_extract(json_each.value, '$.status'), \
                json_extract(json_each.value, '$.error') \
         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.external')",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;

    struct Broken {
        status: Option<i64>,
        reason: String,
        pages: std::collections::HashSet<String>,
    }
    let mut broken: std::collections::HashMap<String, Broken> = std::collections::HashMap::new();

    for row in rows {
        let (Some(from), Some(to), status, error) = row? else { continue };
        // A link is dead if it answered badly or never answered at all. A
        // `status` we never resolved is not evidence of anything.
        let is_dead = matches!(status, Some(code) if code >= 400) || error.is_some();
        if !is_dead {
            continue;
        }
        let entry = broken.entry(to).or_insert_with(|| Broken {
            status,
            reason: error.clone().unwrap_or_default(),
            pages: std::collections::HashSet::new(),
        });
        entry.pages.insert(from);
    }

    let mut out = serde_json::Map::with_capacity(broken.len());
    for (url, info) in broken {
        out.insert(
            url,
            serde_json::json!({
                "status": info.status,
                "reason": info.reason,
                "pages": info.pages.len(),
                // The pages themselves, so the issue list can point at the
                // ones needing an edit. Bounded because a dead footer link on
                // a large site would otherwise ship the whole crawl back.
                "sources": info
                    .pages
                    .into_iter()
                    .take(MAX_BROKEN_LINK_SOURCES)
                    .collect::<Vec<_>>(),
            }),
        );
    }
    Ok(Value::Object(out))
}

/// The inversion itself, over any connection, so it can be tested without a
/// pool behind it.
fn inlink_counts_from(conn: &Connection) -> Result<Value, DatabaseError> {
    let mut stmt = conn.prepare(
        "SELECT json_extract(data, '$.url'), \
                json_extract(json_each.value, '$.url') \
         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.internal')",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;

    // Total links pointing in, and the distinct pages they came from. Screaming
    // Frog reports both because they answer different questions: one page
    // linking a destination twenty times is not twenty pages endorsing it.
    let mut totals: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut sources: std::collections::HashMap<String, std::collections::HashSet<String>> =
        std::collections::HashMap::new();

    for row in rows {
        let (Some(from), Some(to)) = row? else { continue };
        let to = inlink_key(&to);
        if to.is_empty() {
            continue;
        }
        *totals.entry(to.clone()).or_insert(0) += 1;
        sources.entry(to).or_default().insert(inlink_key(&from));
    }

    let mut out = serde_json::Map::with_capacity(totals.len());
    for (url, total) in totals {
        let unique = sources.get(&url).map(|s| s.len()).unwrap_or(0);
        out.insert(url, serde_json::json!({ "inlinks": total, "unique": unique }));
    }
    Ok(Value::Object(out))
}

fn to_light_crawl_result(data_json: &str, link_score: Option<i64>) -> Option<Value> {
    let data: Value = serde_json::from_str(data_json).ok()?;

    Some(serde_json::json!({
        "url": data.get("url").cloned().unwrap_or(Value::Null),
        "title": data.get("title").cloned().unwrap_or(Value::Null),
        "description": data.get("description").cloned().unwrap_or(Value::Null),
        "headings": data.get("headings").cloned().unwrap_or(Value::Null),
        "status_code": data.get("status_code").cloned().unwrap_or(Value::Null),
        "word_count": data.get("word_count").cloned().unwrap_or(Value::Null),
        "sentence_count": data.get("sentence_count").cloned().unwrap_or(Value::from(0)),
        "response_time": data.get("response_time").cloned().unwrap_or(Value::Null),
        "mobile": data.get("mobile").cloned().unwrap_or(Value::Null),
        "indexability": data.get("indexability").cloned().unwrap_or(Value::Null),
        "language": data.get("language").cloned().unwrap_or(Value::Null),
        "schema": data.get("schema").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(
            data.get("schema").and_then(|v| v.as_bool()).unwrap_or(false)
        ),
        "url_depth": data.get("url_depth").cloned().unwrap_or(Value::Null),
        "cookies_count": data.get("cookies_count").cloned()
            .unwrap_or_else(|| {
                data.get("cookies").and_then(|c| c.get("Ok"))
                    .and_then(|arr| arr.as_array())
                    .map(|a| Value::from(a.len()))
                    .unwrap_or(Value::from(0))
            }),
        "page_size": data.get("page_size").cloned().unwrap_or(Value::Null),
        "content_type": data.get("content_type").cloned().unwrap_or(Value::Null),
        "opengraph": data.get("opengraph").cloned().unwrap_or(Value::Null),
        "flesch": data.get("flesch").and_then(|f| f.get("Ok")).and_then(|arr| arr.get(0)).cloned(),
        "flesch_grade": data.get("flesch").and_then(|f| f.get("Ok")).and_then(|arr| arr.get(1)).cloned(),
        "text_ratio": data.get("text_ratio").and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|o| o.get("text_ratio"))
            .cloned(),
        "extractor": data.get("extractor").cloned().unwrap_or(Value::Null),
        "images_count": data.get("images").and_then(|i| i.get("Ok"))
            .and_then(|arr| arr.as_array())
            .map(|a| Value::from(a.len()))
            .unwrap_or(Value::from(0)),
        "had_redirect": data.get("had_redirect").cloned().unwrap_or(Value::Bool(false)),
        "redirect_url": data.get("redirect_url").cloned().unwrap_or(Value::Null),
        "redirect_count": data.get("redirect_count").cloned().unwrap_or(Value::from(0)),
        "redirection_type": data.get("redirection_type").cloned().unwrap_or(Value::Null),
        "redirect_chain": data.get("redirect_chain").cloned().unwrap_or(Value::Null),
        "crawl_error": data.get("crawl_error").cloned().unwrap_or(Value::Null),
        "https": data.get("https").cloned().unwrap_or(Value::Bool(false)),
        "meta_robots": data.get("meta_robots").cloned().unwrap_or(Value::Null),
        "canonicals": data.get("canonicals").cloned().unwrap_or(Value::Null),
        "hreflangs": data.get("hreflangs").cloned().unwrap_or(Value::Null),
        "pagination": data.get("pagination").cloned().unwrap_or_else(|| serde_json::json!({})),
        "page_meta": data.get("page_meta").cloned().unwrap_or_else(|| serde_json::json!({})),
        "internal_links_count": data.get("inoutlinks_status_codes")
            .and_then(|l| l.get("internal"))
            .and_then(|v| v.as_array())
            .map(|a| Value::from(a.len()))
            .unwrap_or(Value::from(0)),
        "external_links_count": data.get("inoutlinks_status_codes")
            .and_then(|l| l.get("external"))
            .and_then(|v| v.as_array())
            .map(|a| Value::from(a.len()))
            .unwrap_or(Value::from(0)),
        "forms": data.get("forms").cloned().unwrap_or(Value::Null),
        "unique_internal_links_count": unique_link_count(&data, "internal"),
        "unique_external_links_count": unique_link_count(&data, "external"),
        "link_score": link_score.map(Value::from).unwrap_or(Value::Null),
    }))
}

/// Lazy global shared Database instance for query commands.
/// This prevents creating a new connection pool (and leaking file descriptors)
/// every time a frontend query command is invoked.
static SHARED_BATCHES_DB: OnceCell<Database> = OnceCell::const_new();

/// Get or create a shared Database instance for the deep_crawl_batches.db.
/// All read-only query commands should use this instead of Database::new().
pub async fn get_or_create_shared_db() -> Result<Database, DatabaseError> {
    let db = SHARED_BATCHES_DB
        .get_or_try_init(|| async {
            let db = Database::new("deep_crawl_batches.db")?;
            Ok::<Database, DatabaseError>(db)
        })
        .await?;
    Ok(db.clone())
}

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("Rusqlite error: {0}")]
    Rusqlite(#[from] rusqlite::Error),

    #[error("Serde JSON error: {0}")]
    SerdeJson(#[from] serde_json::Error),

    #[error("R2D2 pool error: {0}")]
    R2D2(#[from] r2d2::Error),

    #[error("Tokio task error: {0}")]
    TokioTask(#[from] tokio::task::JoinError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to create project directories: {0}")]
    DirectoryError(String),

    #[error("Database connection error: {0}")]
    ConnectionError(String),

    #[error("Database not initialized")]
    NotInitialized,

    #[error("Lock error")]
    LockError,

    #[error("IO error: {0}")]
    NotFound(String), // Added

    #[error("IO error: {0}")]
    QueryError(String), // Added
    #[error("IO error: {0}")]
    JoinError(String), // Added

    #[error("Serialization Error")]
    SerializationError(String),

    #[error("Unknown error: {0}")]
    TransactionError(String),
}

#[derive(Serialize, Clone)]
pub struct DatabaseResults {
    pub url: String,
    pub data: Value,
}

#[derive(Clone)]
pub struct Database {
    pool: Arc<Pool<SqliteConnectionManager>>,
    initialized: Arc<Mutex<bool>>,
}

impl Database {
    pub fn new(db_name: &str) -> Result<Self, DatabaseError> {
        let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
            DatabaseError::DirectoryError("Failed to get project directories".to_string())
        })?;

        let data_dir = project_dirs.data_dir();
        let db_dir = data_dir.join("db");

        fs::create_dir_all(&db_dir).map_err(|e| {
            DatabaseError::DirectoryError(format!(
                "Failed to create database directory {}: {}",
                db_dir.display(),
                e
            ))
        })?;

        let metadata = fs::metadata(&db_dir).map_err(|e| {
            DatabaseError::DirectoryError(format!(
                "Failed to get directory metadata for {}: {}",
                db_dir.display(),
                e
            ))
        })?;

        if !metadata.permissions().readonly() {
            let db_path = db_dir.join(db_name);
            println!("Creating database at: {}", db_path.display());

            let manager = SqliteConnectionManager::file(&db_path).with_init(|conn| {
                conn.pragma_update(None, "journal_mode", "WAL")?;
                conn.pragma_update(None, "synchronous", "NORMAL")?;
                Ok(())
            });

            let pool = Pool::builder()
                .max_size(4)
                .connection_timeout(Duration::from_secs(30))
                .max_lifetime(Some(Duration::from_secs(900)))
                .idle_timeout(Some(Duration::from_secs(120)))
                .build(manager)
                .map_err(|e| {
                    DatabaseError::ConnectionError(format!(
                        "Failed to create connection pool for {}: {}",
                        db_path.display(),
                        e
                    ))
                })?;

            let test_conn = pool.get().map_err(|e| {
                DatabaseError::ConnectionError(format!(
                    "Failed to get initial connection for {}: {}",
                    db_path.display(),
                    e
                ))
            })?;
            drop(test_conn);

            Ok(Self {
                pool: Arc::new(pool),
                initialized: Arc::new(Mutex::new(false)),
            })
        } else {
            Err(DatabaseError::DirectoryError(format!(
                "Database directory {} is not writable",
                db_dir.display()
            )))
        }
    }

    pub fn get_pool(&self) -> Arc<Pool<SqliteConnectionManager>> {
        self.pool.clone()
    }

    pub async fn initialize(&mut self) -> Result<(), DatabaseError> {
        let pool = self.pool.clone();
        let initialized = self.initialized.clone();

        let result = tokio::task::spawn_blocking(move || {
            let conn = pool.get().map_err(|e| {
                DatabaseError::ConnectionError(format!(
                    "Failed to get connection for initialization: {}",
                    e
                ))
            })?;
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS domain_crawl (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL UNIQUE,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_domain_crawl_url ON domain_crawl(url);
                "#,
            )?;
            println!("Database schema initialized successfully");
            Ok(())
        })
        .await?;

        let mut initialized_guard = initialized.lock().await;
        *initialized_guard = true;

        result
    }

    pub async fn initialize_db(db_path: &Path) -> Result<Self, DatabaseError> {
        let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            Ok(())
        });

        let pool = Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(30))
            .max_lifetime(Some(Duration::from_secs(900)))
            .idle_timeout(Some(Duration::from_secs(120)))
            .build(manager)
            .map_err(|e| {
                DatabaseError::ConnectionError(format!(
                    "Failed to create connection pool for {}: {}",
                    db_path.display(),
                    e
                ))
            })?;

        let test_conn = pool.get().map_err(|e| {
            DatabaseError::ConnectionError(format!(
                "Failed to get initial connection for {}: {}",
                db_path.display(),
                e
            ))
        })?;
        drop(test_conn);

        Ok(Self {
            pool: Arc::new(pool),
            initialized: Arc::new(Mutex::new(false)),
        })
    }

    pub async fn get_urls(&self) -> Result<Vec<String>, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            let mut stmt = conn.prepare("SELECT url FROM domain_crawl")?;
            let urls = stmt
                .query_map(params![], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<String>, _>>()?;

            println!(
                "Found {} urls in database, transferring them to the frontend",
                urls.len()
            );

            Ok(urls)
        })
        .await?
    }

    /// Inlink totals per destination URL, keyed by the same normalised spelling
    /// the tables match on.
    ///
    /// Aggregating in Rust rather than SQL keeps one definition of "the same
    /// URL": a trailing slash and a `#fragment` must fold together here exactly
    /// as they do in the frontend, and expressing that in SQLite string
    /// functions would be a second, silently diverging implementation.
    pub async fn get_inlink_counts(&self) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            inlink_counts_from(&conn)
        })
        .await?
    }

    /// See [`broken_links_from`].
    pub async fn get_broken_links(&self) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();
        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            broken_links_from(&conn)
        })
        .await?
    }

    pub async fn clear(&self) -> Result<(), DatabaseError> {
        let initialized = self.initialized.lock().await;
        if !*initialized {
            return Err(DatabaseError::NotInitialized);
        }
        drop(initialized);

        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get().map_err(|e| {
                DatabaseError::ConnectionError(format!("Failed to get connection for clear: {}", e))
            })?;
            let rows_affected = conn.execute("DELETE FROM domain_crawl", params![])?;
            println!("Cleared database, affected {} rows", rows_affected);
            Ok(())
        })
        .await?
    }

    pub async fn count_rows(&self) -> Result<i64, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM domain_crawl", [], |row| row.get(0))?;
            Ok(count)
        })
        .await?
    }

    pub async fn get_url_data(&self, url: String) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            let mut stmt = conn.prepare("SELECT data FROM domain_crawl WHERE url = ?1")?;
            let data_json: String = stmt.query_row(params![url], |row| row.get(0))?;
            let data: Value = serde_json::from_str(&data_json)?;
            Ok(data)
        })
        .await?
    }

    pub async fn get_summary_stats(&self) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();
        let stats = tokio::task::spawn_blocking(move || {
            let conn = pool.get().map_err(|e| DatabaseError::ConnectionError(e.to_string()))?;
            let mut stmt = conn.prepare(
                r#"
                SELECT 
                    COUNT(*) as pages,
                    SUM(COALESCE(json_array_length(data, '$.inoutlinks_status_codes.internal'), 0)) as internal_links,
                    SUM(COALESCE(json_array_length(data, '$.inoutlinks_status_codes.external'), 0)) as external_links,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.indexability.indexability') AS REAL) >= 0.5) as indexable,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.indexability.indexability') AS REAL) < 0.5) as not_indexable,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.status_code') AS INTEGER) >= 400) as errors,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.status_code') AS INTEGER) >= 200 AND CAST(json_extract(data, '$.status_code') AS INTEGER) < 300) as status_2xx,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.status_code') AS INTEGER) >= 300 AND CAST(json_extract(data, '$.status_code') AS INTEGER) < 400) as status_3xx,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.status_code') AS INTEGER) >= 400 AND CAST(json_extract(data, '$.status_code') AS INTEGER) < 500) as status_4xx,
                    COUNT(*) FILTER (WHERE CAST(json_extract(data, '$.status_code') AS INTEGER) >= 500) as status_5xx,
                    SUM(COALESCE(json_array_length(data, '$.css.external'), 0)) as css,
                    SUM(COALESCE(json_array_length(data, '$.javascript.external'), 0)) as js,
                    SUM(COALESCE(json_array_length(data, '$.images.Ok'), 0)) as images,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.had_redirect') = 1 OR json_extract(data, '$.had_redirect') = 'true') as redirects,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.title') IS NULL OR json_extract(data, '$.title') = '[]' OR json_extract(data, '$.title') = '') as missing_title,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.description') IS NULL OR json_extract(data, '$.description') = '') as missing_description,
                    CAST(AVG(COALESCE(CAST(json_extract(data, '$.response_time') AS REAL), 0)) * 1000 AS INTEGER) as avg_response_time,
                    MAX(COALESCE(CAST(json_extract(data, '$.url_depth') AS INTEGER), 0)) as max_crawl_depth,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.https') = 1 OR json_extract(data, '$.https') = 'true') as total_secure_pages,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.schema') IS NOT NULL AND json_extract(data, '$.schema') != '' AND json_extract(data, '$.schema') != 'null') as total_schema_pages,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.mobile') = 1 OR json_extract(data, '$.mobile') = 'true') as total_mobile_pages,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.headings.h1') IS NULL OR json_extract(data, '$.headings.h1') = '[]') as missing_h1,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.canonicals') IS NULL OR json_extract(data, '$.canonicals') = '[]') as missing_canonical,
                    COUNT(*) FILTER (WHERE COALESCE(CAST(json_extract(data, '$.word_count') AS INTEGER), 0) < 300) as thin_content_pages,
                    COUNT(*) FILTER (WHERE json_extract(data, '$.meta_robots.meta_robots') LIKE '%noindex%') as noindex_pages,
                    COUNT(*) FILTER (WHERE COALESCE(CAST(json_extract(data, '$.cross_origin.total_mixed_content') AS INTEGER), 0) > 0) as mixed_content_pages,
                    COUNT(*) FILTER (WHERE COALESCE(json_array_length(data, '$.cookies.Ok'), 0) > 0) as cookies_pages,
                    CAST(AVG(COALESCE(CAST(json_extract(data, '$.word_count') AS REAL), 0)) AS INTEGER) as avg_word_count,
                    CAST(AVG(CASE WHEN json_extract(data, '$.flesch.Ok[0]') IS NOT NULL THEN CAST(json_extract(data, '$.flesch.Ok[0]') AS REAL) END) AS INTEGER) as avg_readability,
                    CAST(AVG(COALESCE(CAST(json_extract(data, '$.page_size[0].kb') AS REAL), 0)) AS INTEGER) as avg_page_size_kb,
                    (
                        (SELECT COUNT(*) FROM domain_crawl WHERE json_extract(data, '$.title[0].title') IS NOT NULL AND json_extract(data, '$.title[0].title') != '')
                        -
                        (SELECT COUNT(DISTINCT json_extract(data, '$.title[0].title')) FROM domain_crawl WHERE json_extract(data, '$.title[0].title') IS NOT NULL AND json_extract(data, '$.title[0].title') != '')
                    ) as duplicate_titles,
                    (
                        (SELECT COUNT(*) FROM domain_crawl WHERE json_extract(data, '$.description') IS NOT NULL AND json_extract(data, '$.description') != '')
                        -
                        (SELECT COUNT(DISTINCT json_extract(data, '$.description')) FROM domain_crawl WHERE json_extract(data, '$.description') IS NOT NULL AND json_extract(data, '$.description') != '')
                    ) as duplicate_descriptions
                FROM domain_crawl
                "#
            )?;

            let stats = stmt.query_row([], |row| {
                Ok(serde_json::json!({
                    "pages": row.get::<_, i64>(0).unwrap_or(0),
                    "total_internal_links": row.get::<_, i64>(1).unwrap_or(0),
                    "total_external_links": row.get::<_, i64>(2).unwrap_or(0),
                    "total_links": row.get::<_, i64>(1).unwrap_or(0) + row.get::<_, i64>(2).unwrap_or(0),
                    "indexable_pages": row.get::<_, i64>(3).unwrap_or(0),
                    "not_indexable_pages": row.get::<_, i64>(4).unwrap_or(0),
                    "errors": row.get::<_, i64>(5).unwrap_or(0),
                    "status_2xx": row.get::<_, i64>(6).unwrap_or(0),
                    "status_3xx": row.get::<_, i64>(7).unwrap_or(0),
                    "status_4xx": row.get::<_, i64>(8).unwrap_or(0),
                    "status_5xx": row.get::<_, i64>(9).unwrap_or(0),
                    "total_css": row.get::<_, i64>(10).unwrap_or(0),
                    "total_javascript": row.get::<_, i64>(11).unwrap_or(0),
                    "total_images": row.get::<_, i64>(12).unwrap_or(0),
                    "total_redirects": row.get::<_, i64>(13).unwrap_or(0),
                    "missing_title": row.get::<_, i64>(14).unwrap_or(0),
                    "missing_description": row.get::<_, i64>(15).unwrap_or(0),
                    "avg_response_time": row.get::<_, i64>(16).unwrap_or(0),
                    "max_crawl_depth": row.get::<_, i64>(17).unwrap_or(0),
                    "total_secure_pages": row.get::<_, i64>(18).unwrap_or(0),
                    "total_schema_pages": row.get::<_, i64>(19).unwrap_or(0),
                    "total_mobile_pages": row.get::<_, i64>(20).unwrap_or(0),
                    "missing_h1": row.get::<_, i64>(21).unwrap_or(0),
                    "missing_canonical": row.get::<_, i64>(22).unwrap_or(0),
                    "thin_content_pages": row.get::<_, i64>(23).unwrap_or(0),
                    "noindex_pages": row.get::<_, i64>(24).unwrap_or(0),
                    "mixed_content_pages": row.get::<_, i64>(25).unwrap_or(0),
                    "cookies_pages": row.get::<_, i64>(26).unwrap_or(0),
                    "avg_word_count": row.get::<_, i64>(27).unwrap_or(0),
                    "avg_readability": row.get::<_, i64>(28).unwrap_or(0),
                    "avg_page_size_kb": row.get::<_, i64>(29).unwrap_or(0),
                    "duplicate_titles": row.get::<_, i64>(30).unwrap_or(0),
                    "duplicate_descriptions": row.get::<_, i64>(31).unwrap_or(0),
                }))
            })?;

            Ok::<Value, DatabaseError>(stats)
        })
        .await??;

        Ok(stats)
    }

    pub async fn get_aggregated_crawl_data(
        &self,
        data_type: String,
    ) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();
        println!("Getting aggregated crawl data for type: {}", data_type);

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            
            match data_type.as_str() {
                "images" => {
                    // Extract all unique images
                    let mut stmt = conn.prepare(
                        "SELECT DISTINCT json_each.value FROM domain_crawl, json_each(data, '$.images.Ok')"
                    )?;
                    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                    
                    let mut images_map = std::collections::HashMap::new();
                    for img_json_res in rows {
                        if let Ok(img_json) = img_json_res {
                            if let Ok(img) = serde_json::from_str::<Value>(&img_json) {
                                if let Some(url) = img.get(0).and_then(|v| v.as_str()) {
                                    images_map.insert(url.to_string(), img);
                                }
                            }
                        }
                    }
                    Ok(serde_json::to_value(
                        images_map.into_values().collect::<Vec<Value>>(),
                    )?)
                }
                "scripts" => {
                    let mut stmt = conn.prepare(
                        "SELECT DISTINCT json_each.value FROM domain_crawl, json_each(data, '$.javascript.external')"
                    )?;
                    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                    let mut scripts = std::collections::HashSet::new();
                    for script_res in rows {
                        if let Ok(script) = script_res {
                            scripts.insert(script);
                        }
                    }
                    Ok(serde_json::to_value(
                        scripts.into_iter().collect::<Vec<String>>(),
                    )?)
                }
                "stylesheets" => {
                    let mut stmt = conn.prepare(
                        "SELECT DISTINCT json_each.value FROM domain_crawl, json_each(data, '$.css.external')"
                    )?;
                    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                    let mut css = std::collections::HashSet::new();
                    for css_res in rows {
                        if let Ok(c) = css_res {
                            css.insert(c);
                        }
                    }
                    Ok(serde_json::to_value(
                        css.into_iter().collect::<Vec<String>>(),
                    )?)
                }
                "internal_links" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_each.value
                         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.internal')"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let link_json: String = row.get(1)?;
                        Ok((page_url, link_json))
                    })?;

                    let mut internal_links = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, link_json)) = row_res {
                            if let Ok(mut link_obj) = serde_json::from_str::<Value>(&link_json) {
                                if let Some(obj_map) = link_obj.as_object_mut() {
                                    obj_map.insert("page".to_string(), Value::String(page_url));
                                }
                                internal_links.push(link_obj);
                            }
                        }
                    }
                    Ok(Value::Array(internal_links))
                }
                "external_links" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_each.value
                         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.external')"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let link_json: String = row.get(1)?;
                        Ok((page_url, link_json))
                    })?;

                    let mut external_links = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, link_json)) = row_res {
                            if let Ok(mut link_obj) = serde_json::from_str::<Value>(&link_json) {
                                if let Some(obj_map) = link_obj.as_object_mut() {
                                    obj_map.insert("page".to_string(), Value::String(page_url));
                                }
                                external_links.push(link_obj);
                            }
                        }
                    }
                    Ok(Value::Array(external_links))
                }
                "keywords" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_extract(data, '$.keywords') 
                         FROM domain_crawl 
                         WHERE json_extract(data, '$.keywords') IS NOT NULL 
                           AND json_extract(data, '$.keywords') != '[]'"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let keywords_json: String = row.get(1)?;
                        Ok((page_url, keywords_json))
                    })?;
                    
                    let mut keywords = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, keywords_json)) = row_res {
                            if let Ok(kws) = serde_json::from_str::<Value>(&keywords_json) {
                                keywords.push(serde_json::json!({
                                    "url": page_url,
                                    "keywords": kws
                                }));
                            }
                        }
                    }
                    Ok(Value::Array(keywords))
                }
                "redirects" => {
                    let mut stmt = conn.prepare(
                        "SELECT data FROM domain_crawl 
                         WHERE json_extract(data, '$.had_redirect') = 1 
                            OR json_extract(data, '$.had_redirect') = 'true'
                            OR CAST(json_extract(data, '$.status_code') AS INTEGER) >= 300 
                           AND CAST(json_extract(data, '$.status_code') AS INTEGER) < 400"
                    )?;
                    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                    
                    let mut redirects = Vec::new();
                    for row_res in rows {
                        if let Ok(data_json) = row_res {
                            if let Ok(data) = serde_json::from_str::<Value>(&data_json) {
                                redirects.push(data);
                            }
                        }
                    }
                    Ok(Value::Array(redirects))
                }
                "cwv" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_extract(data, '$.psi_results') 
                         FROM domain_crawl"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let psi_json: String = row.get(1)?;
                        Ok((page_url, psi_json))
                    })?;
                    
                    let mut cwv_data = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, psi_json)) = row_res {
                            if let Ok(psi) = serde_json::from_str::<Value>(&psi_json) {
                                cwv_data.push(serde_json::json!({
                                    "url": page_url,
                                    "psi_results": psi
                                }));
                            }
                        }
                    }
                    Ok(Value::Array(cwv_data))
                }
                "files" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_each.value 
                         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.internal')
                         UNION ALL
                         SELECT json_extract(data, '$.url'), json_each.value 
                         FROM domain_crawl, json_each(data, '$.inoutlinks_status_codes.external')"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let link_json: String = row.get(1)?;
                        Ok((page_url, link_json))
                    })?;
                    
                    let mut files = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, link_json)) = row_res {
                            if let Ok(link_obj) = serde_json::from_str::<Value>(&link_json) {
                                if let Some(url) = link_obj.get("url").and_then(|u| u.as_str()) {
                                    if has_file_extension(url) {
                                        let mut obj = link_obj.clone();
                                        if let Some(obj_map) = obj.as_object_mut() {
                                            obj_map.insert("found_at".to_string(), Value::String(page_url));
                                        }
                                        files.push(obj);
                                    }
                                }
                            }
                        }
                    }
                    Ok(Value::Array(files))
                }
                "hreflang" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_extract(data, '$.hreflangs')
                         FROM domain_crawl
                         WHERE json_extract(data, '$.hreflangs') IS NOT NULL
                           AND json_extract(data, '$.hreflangs') != '[]'
                           AND json_extract(data, '$.hreflangs') != 'null'"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let hreflangs_json: String = row.get(1)?;
                        Ok((page_url, hreflangs_json))
                    })?;

                    let mut hreflangs = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, hreflangs_json)) = row_res {
                            if let Ok(tags) = serde_json::from_str::<Value>(&hreflangs_json) {
                                hreflangs.push(serde_json::json!({
                                    "url": page_url,
                                    "hreflangs": tags
                                }));
                            }
                        }
                    }
                    Ok(Value::Array(hreflangs))
                }
                "schema_types" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_extract(data, '$.schema')
                         FROM domain_crawl
                         WHERE json_extract(data, '$.schema') IS NOT NULL
                           AND json_extract(data, '$.schema') != 'null'"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let schema_json: String = row.get(1)?;
                        Ok((page_url, schema_json))
                    })?;

                    let mut schemas = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, schema_json)) = row_res {
                            schemas.push(serde_json::json!({
                                "url": page_url,
                                "schema": schema_json
                            }));
                        }
                    }
                    Ok(Value::Array(schemas))
                }
                "custom_search" => {
                    let mut stmt = conn.prepare(
                        "SELECT json_extract(data, '$.url'), json_extract(data, '$.custom_search')
                         FROM domain_crawl
                         WHERE json_extract(data, '$.custom_search') IS NOT NULL
                           AND json_extract(data, '$.custom_search') != '[]'
                           AND json_extract(data, '$.custom_search') != 'null'"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        let page_url: String = row.get(0)?;
                        let matches_json: String = row.get(1)?;
                        Ok((page_url, matches_json))
                    })?;

                    let mut results = Vec::new();
                    for row_res in rows {
                        if let Ok((page_url, matches_json)) = row_res {
                            if let Ok(matches) = serde_json::from_str::<Value>(&matches_json) {
                                results.push(serde_json::json!({
                                    "url": page_url,
                                    "matches": matches
                                }));
                            }
                        }
                    }
                    Ok(Value::Array(results))
                }
                "page_inventory" => {
                    // Compact per-page summary for the whole crawl, straight from
                    // SQLite — unlike the frontend's `crawlData` store (a JS-heap
                    // ring buffer capped at `max_urls_stored` for large crawls),
                    // this always covers every crawled page.
                    let mut stmt = conn.prepare(
                        "SELECT
                            json_extract(data, '$.url'),
                            CAST(json_extract(data, '$.status_code') AS INTEGER),
                            COALESCE(
                                CAST(json_extract(data, '$.title[0].title_len') AS INTEGER),
                                LENGTH(json_extract(data, '$.title[0].title')),
                                0
                            ),
                            COALESCE(LENGTH(json_extract(data, '$.description')), 0),
                            COALESCE(json_array_length(data, '$.headings.h1'), 0),
                            COALESCE(CAST(json_extract(data, '$.word_count') AS INTEGER), 0),
                            COALESCE(CAST(json_extract(data, '$.indexability.indexability') AS REAL), 0),
                            CASE WHEN COALESCE(json_array_length(data, '$.canonicals'), 0) > 0 THEN 1 ELSE 0 END
                         FROM domain_crawl"
                    )?;
                    let rows = stmt.query_map([], |row| {
                        Ok(serde_json::json!({
                            "url": row.get::<_, Option<String>>(0)?,
                            "status_code": row.get::<_, i64>(1).unwrap_or(0),
                            "title_len": row.get::<_, i64>(2).unwrap_or(0),
                            "desc_len": row.get::<_, i64>(3).unwrap_or(0),
                            "h1_count": row.get::<_, i64>(4).unwrap_or(0),
                            "word_count": row.get::<_, i64>(5).unwrap_or(0),
                            "indexability": row.get::<_, f64>(6).unwrap_or(0.0),
                            "has_canonical": row.get::<_, i64>(7).unwrap_or(0) == 1,
                        }))
                    })?;

                    let mut inventory = Vec::new();
                    for row_res in rows {
                        if let Ok(row) = row_res {
                            inventory.push(row);
                        }
                    }
                    Ok(Value::Array(inventory))
                }
                _ => Ok(Value::Null),
            }
        })
        .await?
    }

    /// Fetch a page of internal or external links with LIMIT/OFFSET.
    /// `limit = 0` is reserved for explicit full-data consumers such as reports.
    pub async fn get_links_page(
        &self,
        data_type: String,
        limit: i64,
        offset: i64,
    ) -> Result<Value, DatabaseError> {
        let effective_limit = validate_links_page_bounds(limit, offset)?;
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            ensure_link_score_column(&conn)?;

            let json_path = match data_type.as_str() {
                "internal_links" => "$.inoutlinks_status_codes.internal",
                "external_links" => "$.inoutlinks_status_codes.external",
                _ => return Err(DatabaseError::QueryError(format!("Unknown link type: {}", data_type))),
            };

            // The correlated subquery looks up the Link Score of the linked-to (target) URL,
            // so the Links tab can show how strong the destination page is.
            let sql = format!(
                "SELECT json_extract(data, '$.url'), json_each.value, \
                    (SELECT link_score FROM domain_crawl AS target \
                     WHERE target.url = json_extract(json_each.value, '$.url')) \
                 FROM domain_crawl, json_each(data, '{}') \
                 LIMIT {} OFFSET {}",
                json_path, effective_limit, offset
            );

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |row| {
                let page_url: String = row.get(0)?;
                let link_json: String = row.get(1)?;
                let link_score: Option<i64> = row.get(2)?;
                Ok((page_url, link_json, link_score))
            })?;

            let mut links = Vec::new();
            for row_res in rows {
                if let Ok((page_url, link_json, link_score)) = row_res {
                    if let Ok(mut link_obj) = serde_json::from_str::<Value>(&link_json) {
                        if let Some(obj_map) = link_obj.as_object_mut() {
                            obj_map.insert("page".to_string(), Value::String(page_url));
                            obj_map.insert(
                                "link_score".to_string(),
                                link_score.map(Value::from).unwrap_or(Value::Null),
                            );
                        }
                        links.push(link_obj);
                    }
                }
            }
            Ok(Value::Array(links))
        })
        .await?
    }

    pub async fn get_incoming_links(&self, target_url: String) -> Result<Value, DatabaseError> {
        let pool = self.pool.clone();

        let normalized_target = normalize_url(&target_url);
        let like_pattern = format!("%{}%", normalized_target);

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;

            // Extract only the 4 scalar fields we need — never fetch full page blobs.
            // LIKE pre-filters candidates; exact normalization match happens in Rust below.
            let mut stmt = conn.prepare(
                "SELECT
                    json_extract(domain_crawl.data, '$.url')          AS source_url,
                    json_extract(json_each.value,   '$.url')          AS link_url,
                    json_extract(json_each.value,   '$.anchor_text')  AS anchor_text,
                    json_extract(json_each.value,   '$.status')       AS status
                 FROM domain_crawl, json_each(domain_crawl.data, '$.inoutlinks_status_codes.internal')
                 WHERE json_extract(json_each.value, '$.url') LIKE ?1
                 LIMIT 50000",
            )?;

            let rows = stmt.query_map(params![like_pattern], |row| {
                let source_url: Option<String> = row.get(0).ok();
                let link_url: Option<String> = row.get(1).ok();
                let anchor_text: Option<String> = row.get(2).ok();
                let status: Option<i64> = row.get(3).ok();
                Ok((source_url, link_url, anchor_text, status))
            })?;

            // Group by source page, exact-normalisation match, dedup anchor texts.
            let mut page_links: std::collections::HashMap<String, (Vec<String>, Option<i64>)> =
                std::collections::HashMap::new();

            for row_result in rows {
                let (source_url, link_url, anchor_text, status) = row_result?;
                let source = source_url.unwrap_or_default();
                let link = link_url.unwrap_or_default();

                if source.is_empty() || normalize_url(&link) != normalized_target {
                    continue;
                }

                let entry = page_links.entry(source).or_insert_with(|| (Vec::new(), None));
                if let Some(text) = anchor_text {
                    if !text.is_empty() && !entry.0.contains(&text) {
                        entry.0.push(text);
                    }
                }
                if entry.1.is_none() {
                    entry.1 = status;
                }
            }

            let results: Vec<Value> = page_links
                .into_iter()
                .take(1000)
                .map(|(url, (anchors, status))| {
                    serde_json::json!({
                        "url": url,
                        "anchor_text": anchors.join(", "),
                        "status": status
                    })
                })
                .collect();

            Ok(Value::Array(results))
        })
        .await?
    }

    /// Paginated table query — returns a page of LightCrawlResult-shaped rows from the DB.
    /// `limit` is the page size, `offset` is the starting row (0-based).
    /// Only extracts the fields needed by TableCrawl to keep IPC payloads small.
    pub async fn get_crawl_page(&self, limit: i64, offset: i64, search: Option<String>) -> Result<Value, DatabaseError> {
        let capacity = validate_crawl_page_bounds(limit, offset)?;
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            ensure_link_score_column(&conn)?;

            let like_pattern = search.map(|s| format!("%{}%", s.to_lowercase()));
            let mut results = Vec::with_capacity(capacity);

            if let Some(ref pattern) = like_pattern {
                let mut stmt = conn.prepare(
                    "SELECT data, link_score FROM domain_crawl
                     WHERE LOWER(data) LIKE ?1 LIMIT ?2 OFFSET ?3",
                )?;
                let rows = stmt.query_map(params![pattern, limit, offset], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                })?;
                for row in rows {
                    let (data_json, link_score) = row?;
                    if let Some(light) = to_light_crawl_result(&data_json, link_score) {
                        results.push(light);
                    }
                }
            } else {
                let mut stmt =
                    conn.prepare("SELECT data, link_score FROM domain_crawl LIMIT ?1 OFFSET ?2")?;
                let rows = stmt.query_map(params![limit, offset], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                })?;
                for row in rows {
                    let (data_json, link_score) = row?;
                    if let Some(light) = to_light_crawl_result(&data_json, link_score) {
                        results.push(light);
                    }
                }
            }

            Ok(Value::Array(results))
        })
        .await?
    }

    pub async fn get_all_crawl_data(&self) -> Result<Vec<Value>, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            ensure_link_score_column(&conn)?;
            let mut stmt = conn.prepare("SELECT data, link_score FROM domain_crawl")?;

            let mut results = Vec::new();
            let rows = stmt.query_map([], |row| {
                let data_json: String = row.get(0)?;
                let link_score: Option<i64> = row.get(1)?;
                Ok((data_json, link_score))
            })?;

            for row in rows {
                if let Ok((data_json, link_score)) = row {
                    if let Ok(mut data) = serde_json::from_str::<Value>(&data_json) {
                        if let (Some(score), Value::Object(map)) = (link_score, &mut data) {
                            map.insert("link_score".to_string(), Value::from(score));
                        }
                        results.push(data);
                    }
                }
            }

            Ok(results)
        })
        .await?
    }

    /// Return only the graph fields consumed by `compute_link_scores`.
    /// Large page payloads (HTML-derived metadata, images, headers, PSI data, etc.)
    /// never cross the SQLite boundary, substantially reducing end-of-crawl memory.
    pub async fn get_link_score_inputs(&self) -> Result<Vec<Value>, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT
                    json_extract(data, '$.url'),
                    CAST(COALESCE(json_extract(data, '$.status_code'), 0) AS INTEGER),
                    json_extract(data, '$.original_url'),
                    json_extract(data, '$.canonicals'),
                    json_extract(data, '$.redirect_chain'),
                    COALESCE(
                        (
                            SELECT json_group_array(
                                json_object(
                                    'url', json_extract(link.value, '$.url'),
                                    'rel', json_extract(link.value, '$.rel')
                                )
                            )
                            FROM json_each(
                                domain_crawl.data,
                                '$.inoutlinks_status_codes.internal'
                            ) AS link
                        ),
                        '[]'
                    )
                 FROM domain_crawl",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?;

            let mut inputs = Vec::new();
            for row in rows {
                let (url, status_code, original_url, canonicals, redirect_chain, internal) = row?;
                let Some(url) = url else {
                    continue;
                };
                let parse_json = |raw: Option<String>, fallback: Value| {
                    raw.and_then(|value| serde_json::from_str(&value).ok())
                        .unwrap_or(fallback)
                };
                let internal = serde_json::from_str::<Value>(&internal)
                    .unwrap_or_else(|_| Value::Array(Vec::new()));
                inputs.push(serde_json::json!({
                    "url": url,
                    "status_code": status_code,
                    "original_url": original_url,
                    "canonicals": parse_json(canonicals, Value::Null),
                    "redirect_chain": parse_json(redirect_chain, Value::Null),
                    "inoutlinks_status_codes": { "internal": internal },
                }));
            }
            Ok(inputs)
        })
        .await?
    }

    /// Returns the total row count (with optional search filter) for pagination controls.
    pub async fn get_crawl_total_count(&self, search: Option<String>) -> Result<i64, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            let count: i64 = if let Some(s) = search {
                let pattern = format!("%{}%", s.to_lowercase());
                conn.query_row(
                    "SELECT COUNT(*) FROM domain_crawl WHERE LOWER(data) LIKE ?1",
                    params![pattern],
                    |row| row.get(0),
                )?
            } else {
                conn.query_row("SELECT COUNT(*) FROM domain_crawl", [], |row| row.get(0))?
            };
            Ok(count)
        })
        .await?
    }

    /// Fill deferred internal-link statuses from the authoritative primary crawl.
    ///
    /// Internal links are intentionally not pre-fetched with HEAD while their source
    /// page is being parsed. Once all target rows have been persisted, this method
    /// reconciles the embedded LinkStatus objects in bounded batches. Only a small
    /// page batch is deserialized at a time; the target-status index contains scalar
    /// values only and may spill to SQLite's temporary store for very large crawls.
    pub async fn reconcile_internal_link_statuses(&self) -> Result<usize, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|error| {
                DatabaseError::ConnectionError(format!(
                    "Failed to get connection for internal-link reconciliation: {}",
                    error
                ))
            })?;
            reconcile_internal_link_statuses_on_connection(
                &mut conn,
                INTERNAL_LINK_RECONCILE_BATCH_SIZE,
            )
        })
        .await?
    }

    /// Persists computed Link Score values (1-100) back onto their crawled page rows,
    /// keyed by URL. Adds the `link_score` column on first use if it isn't there yet.
    pub async fn store_link_scores(&self, scores: HashMap<String, u32>) -> Result<(), DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            ensure_link_score_column(&conn)?;

            let tx = conn.transaction()?;
            {
                let mut stmt = tx.prepare("UPDATE domain_crawl SET link_score = ?1 WHERE url = ?2")?;
                for (url, score) in &scores {
                    stmt.execute(params![score, url])?;
                }
            }
            tx.commit()?;
            Ok(())
        })
        .await?
    }

    /// Returns the persisted Link Score for every URL that has one, keyed by URL.
    /// Used by the frontend to pull already-computed scores into the live tables
    /// after a crawl finishes, without recomputing them.
    pub async fn get_link_scores(&self) -> Result<HashMap<String, u32>, DatabaseError> {
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            ensure_link_score_column(&conn)?;

            let mut stmt = conn
                .prepare("SELECT url, link_score FROM domain_crawl WHERE link_score IS NOT NULL")?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })?;

            let mut scores = HashMap::new();
            for row_res in rows {
                if let Ok((url, score)) = row_res {
                    scores.insert(url, score);
                }
            }
            Ok(scores)
        })
        .await?
    }

    /// Returns persisted Link Scores only for the bounded URL set currently held
    /// by the frontend. Queries are chunked below SQLite's parameter ceiling so a
    /// routine completion refresh never materializes the whole crawl.
    pub async fn get_link_scores_for_urls(
        &self,
        mut urls: Vec<String>,
    ) -> Result<HashMap<String, u32>, DatabaseError> {
        validate_link_score_url_count(urls.len())?;
        if urls.is_empty() {
            return Ok(HashMap::new());
        }

        urls.sort_unstable();
        urls.dedup();
        let pool = self.pool.clone();

        tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            ensure_link_score_column(&conn)?;
            let mut scores = HashMap::with_capacity(urls.len());

            for chunk in urls.chunks(LINK_SCORE_QUERY_CHUNK_SIZE) {
                let placeholders = std::iter::repeat("?")
                    .take(chunk.len())
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql = format!(
                    "SELECT url, link_score FROM domain_crawl
                     WHERE link_score IS NOT NULL AND url IN ({})",
                    placeholders
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
                })?;

                for row in rows {
                    let (url, score) = row?;
                    scores.insert(url, score);
                }
            }

            Ok(scores)
        })
        .await?
    }
}

/// Reconcile internal-link status objects in bounded page batches. This helper
/// takes a raw connection so its correctness can be tested with an in-memory DB.
fn reconcile_internal_link_statuses_on_connection(
    conn: &mut Connection,
    requested_batch_size: usize,
) -> Result<usize, DatabaseError> {
    let batch_size = requested_batch_size.clamp(1, 10_000);

    // The lookup table contains only normalized URL + status + error scalars. It
    // avoids retaining every page JSON document in Rust while making per-link
    // resolution indexed and deterministic.
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.internal_target_status;
         CREATE TEMP TABLE internal_target_status (
             url_key TEXT PRIMARY KEY,
             status_code INTEGER NOT NULL,
             crawl_error TEXT
         );",
    )?;

    let mut last_target_id = 0_i64;
    loop {
        let targets: Vec<(i64, String, i64, Option<String>)> = {
            let mut stmt = conn.prepare(
                "SELECT id,
                        url,
                        CAST(COALESCE(json_extract(data, '$.status_code'), 0) AS INTEGER),
                        json_extract(data, '$.crawl_error')
                 FROM domain_crawl
                 WHERE id > ?1
                 ORDER BY id
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![last_target_id, batch_size as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        if targets.is_empty() {
            break;
        }
        last_target_id = targets.last().map(|row| row.0).unwrap_or(last_target_id);

        let tx = conn.transaction()?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR REPLACE INTO temp.internal_target_status
                    (url_key, status_code, crawl_error)
                 VALUES (?1, ?2, ?3)",
            )?;
            for (_, url, status_code, crawl_error) in targets {
                insert.execute(params![normalize_url(&url), status_code, crawl_error])?;
            }
        }
        tx.commit()?;
    }

    let mut last_source_id = 0_i64;
    let mut updated_links = 0_usize;
    loop {
        // At most `batch_size` full JSON blobs exist in Rust at any point.
        let pages: Vec<(i64, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, data
                 FROM domain_crawl
                 WHERE id > ?1
                   AND json_valid(data)
                   AND COALESCE(
                       json_array_length(data, '$.inoutlinks_status_codes.internal'),
                       0
                   ) > 0
                 ORDER BY id
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![last_source_id, batch_size as i64], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        if pages.is_empty() {
            break;
        }
        last_source_id = pages.last().map(|row| row.0).unwrap_or(last_source_id);

        let tx = conn.transaction()?;
        {
            let mut lookup = tx.prepare_cached(
                "SELECT status_code, crawl_error
                 FROM temp.internal_target_status
                 WHERE url_key = ?1",
            )?;
            let mut update = tx.prepare_cached("UPDATE domain_crawl SET data = ?1 WHERE id = ?2")?;

            for (page_id, data_json) in pages {
                let mut data: Value = match serde_json::from_str(&data_json) {
                    Ok(data) => data,
                    Err(error) => {
                        tracing::warn!(
                            "Skipping malformed crawl row {} during link reconciliation: {}",
                            page_id,
                            error
                        );
                        continue;
                    }
                };
                let Some(internal_links) = data
                    .get_mut("inoutlinks_status_codes")
                    .and_then(|links| links.get_mut("internal"))
                    .and_then(Value::as_array_mut)
                else {
                    continue;
                };

                let mut page_changed = false;
                for link in internal_links {
                    let Some(link_object) = link.as_object_mut() else {
                        continue;
                    };
                    let Some(link_url) = link_object.get("url").and_then(Value::as_str) else {
                        continue;
                    };
                    let status_row = lookup
                        .query_row(params![normalize_url(link_url)], |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, Option<String>>(1)?,
                            ))
                        })
                        .optional()?;
                    let Some((status_code, crawl_error)) = status_row else {
                        // Excluded, robots-blocked, out-of-scope, or unfinished targets
                        // remain unresolved rather than receiving a fabricated status.
                        continue;
                    };

                    let status_value = if (100..=599).contains(&status_code) {
                        Value::from(status_code)
                    } else {
                        Value::Null
                    };
                    let error_value = if status_code == 0 {
                        Value::String(
                            crawl_error
                                .filter(|error| !error.trim().is_empty())
                                .unwrap_or_else(|| {
                                    "Crawl failed without an HTTP response".to_string()
                                }),
                        )
                    } else if status_code >= 400 {
                        Value::String(format!("HTTP Error: {}", status_code))
                    } else {
                        Value::Null
                    };

                    let changed = link_object.get("status") != Some(&status_value)
                        || link_object.get("error") != Some(&error_value);
                    if changed {
                        link_object.insert("status".to_string(), status_value);
                        link_object.insert("error".to_string(), error_value);
                        page_changed = true;
                        updated_links += 1;
                    }
                }

                if page_changed {
                    update.execute(params![serde_json::to_string(&data)?, page_id])?;
                }
            }
        }
        tx.commit()?;
    }

    conn.execute_batch("DROP TABLE IF EXISTS temp.internal_target_status;")?;
    Ok(updated_links)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inlink_counts_invert_the_graph_and_fold_equivalent_spellings() {
        let conn = Connection::open_in_memory().unwrap();
        create_crawl_table(&conn);
        // Two pages both link to /target, and one of them does it twice — once
        // with a fragment, once with a trailing slash. That is three link
        // instances from two distinct sources.
        insert_page(&conn, "https://e.com/a", serde_json::json!({
            "url": "https://e.com/a",
            "inoutlinks_status_codes": { "internal": [
                { "url": "https://e.com/target" },
                { "url": "https://e.com/target/#section" },
            ]},
        }));
        insert_page(&conn, "https://e.com/b", serde_json::json!({
            "url": "https://e.com/b",
            "inoutlinks_status_codes": { "internal": [
                { "url": "https://e.com/target/" },
            ]},
        }));

        let counts = inlink_counts_from(&conn).unwrap();
        let target = &counts["https://e.com/target"];

        assert_eq!(target["inlinks"], 3, "every link instance counts");
        assert_eq!(target["unique"], 2, "but only two pages did the linking");
    }

    #[test]
    fn broken_links_group_by_destination_and_count_the_pages_carrying_them() {
        let conn = Connection::open_in_memory().unwrap();
        create_crawl_table(&conn);
        // The footer case: the same dead domain on every page, plus one link
        // that is perfectly fine and must not be reported.
        for page in ["https://e.com/a", "https://e.com/b", "https://e.com/c"] {
            insert_page(&conn, page, serde_json::json!({
                "url": page,
                "inoutlinks_status_codes": { "external": [
                    { "url": "https://dead.test/", "status": null, "error": "dns failure" },
                    { "url": "https://fine.test/", "status": 200, "error": null },
                ]},
            }));
        }

        let broken = broken_links_from(&conn).unwrap();

        assert_eq!(broken["https://dead.test/"]["pages"], 3);
        assert_eq!(broken["https://dead.test/"]["reason"], "dns failure");
        assert!(broken.get("https://fine.test/").is_none(), "a 200 is not broken");
    }

    #[test]
    fn a_link_with_no_recorded_status_is_not_called_broken() {
        let conn = Connection::open_in_memory().unwrap();
        create_crawl_table(&conn);
        insert_page(&conn, "https://e.com/a", serde_json::json!({
            "url": "https://e.com/a",
            "inoutlinks_status_codes": { "external": [
                { "url": "https://unchecked.test/", "status": null, "error": null },
            ]},
        }));
        assert_eq!(broken_links_from(&conn).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn a_crawl_with_no_links_yields_an_empty_map_not_an_error() {
        let conn = Connection::open_in_memory().unwrap();
        create_crawl_table(&conn);
        insert_page(&conn, "https://e.com/", serde_json::json!({ "url": "https://e.com/" }));

        assert_eq!(inlink_counts_from(&conn).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn light_row_carries_the_link_counts_the_table_needs() {
        // The paged query drops the link arrays, so a table fed by it can only
        // report outlinks if the totals ride along. Two of the three internal
        // links here point at the same page once the fragment is dropped.
        let data = serde_json::json!({
            "url": "https://example.com/",
            "inoutlinks_status_codes": {
                "internal": [
                    { "url": "https://example.com/a" },
                    { "url": "https://example.com/a#section" },
                    { "url": "https://example.com/b" },
                ],
                "external": [{ "url": "https://other.test/x" }],
            },
        });

        let light = to_light_crawl_result(&data.to_string(), None).unwrap();

        assert_eq!(light["internal_links_count"], 3);
        assert_eq!(light["unique_internal_links_count"], 2);
        assert_eq!(light["external_links_count"], 1);
        assert_eq!(light["unique_external_links_count"], 1);
    }

    #[test]
    fn light_row_reports_zero_links_rather_than_omitting_them() {
        let data = serde_json::json!({ "url": "https://example.com/" });
        let light = to_light_crawl_result(&data.to_string(), None).unwrap();

        assert_eq!(light["internal_links_count"], 0);
        assert_eq!(light["unique_internal_links_count"], 0);
    }

    fn create_crawl_table(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE domain_crawl (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL UNIQUE,
                data TEXT NOT NULL
            );",
        )
        .unwrap();
    }

    fn insert_page(conn: &Connection, url: &str, data: Value) {
        conn.execute(
            "INSERT INTO domain_crawl (url, data) VALUES (?1, ?2)",
            params![url, serde_json::to_string(&data).unwrap()],
        )
        .unwrap();
    }

    fn internal_link(url: &str) -> Value {
        serde_json::json!({
            "base_url": "https://example.com/",
            "url": url,
            "relative_path": null,
            "status": null,
            "error": null,
            "anchor_text": "test",
            "rel": null,
            "title": null,
            "target": null
        })
    }

    #[test]
    fn crawl_page_bounds_reject_negative_limit() {
        assert!(matches!(
            validate_crawl_page_bounds(-1, 0),
            Err(DatabaseError::QueryError(_))
        ));
    }

    #[test]
    fn crawl_page_bounds_reject_zero_limit() {
        assert!(matches!(
            validate_crawl_page_bounds(0, 0),
            Err(DatabaseError::QueryError(_))
        ));
    }

    #[test]
    fn crawl_page_bounds_reject_extreme_limit() {
        assert!(matches!(
            validate_crawl_page_bounds(i64::MAX, 0),
            Err(DatabaseError::QueryError(_))
        ));
    }

    #[test]
    fn crawl_page_bounds_reject_negative_offset() {
        assert!(matches!(
            validate_crawl_page_bounds(1, -1),
            Err(DatabaseError::QueryError(_))
        ));
    }

    #[test]
    fn crawl_page_bounds_accept_maximum_page() {
        assert_eq!(
            validate_crawl_page_bounds(MAX_IPC_PAGE_SIZE, 0).unwrap(),
            MAX_IPC_PAGE_SIZE as usize
        );
    }

    #[test]
    fn links_page_bounds_preserve_explicit_full_fetch_and_reject_invalid_pages() {
        assert_eq!(validate_links_page_bounds(0, 0).unwrap(), -1);
        assert_eq!(
            validate_links_page_bounds(MAX_IPC_PAGE_SIZE, 0).unwrap(),
            MAX_IPC_PAGE_SIZE
        );
        assert!(matches!(
            validate_links_page_bounds(-1, 0),
            Err(DatabaseError::QueryError(_))
        ));
        assert!(matches!(
            validate_links_page_bounds(MAX_IPC_PAGE_SIZE + 1, 0),
            Err(DatabaseError::QueryError(_))
        ));
        assert!(matches!(
            validate_links_page_bounds(1, -1),
            Err(DatabaseError::QueryError(_))
        ));
    }

    #[tokio::test]
    async fn repeated_single_and_bulk_upserts_preserve_row_identity() {
        let manager = SqliteConnectionManager::memory();
        let pool = Arc::new(
            Pool::builder()
                .max_size(1)
                .build(manager)
                .expect("in-memory pool"),
        );
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE domain_crawl (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL UNIQUE,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT 'original'
                );",
            )
            .unwrap();
        }

        let url = "https://example.com/repeated";
        insert_crawl_data(
            pool.clone(),
            DatabaseResults {
                url: url.to_string(),
                data: serde_json::json!({"version": 1}),
            },
        )
        .await
        .unwrap();
        let original_id: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT id FROM domain_crawl WHERE url = ?1",
                [url],
                |row| row.get(0),
            )
            .unwrap();
        pool.get()
            .unwrap()
            .execute(
                "UPDATE domain_crawl SET created_at = 'preserved' WHERE url = ?1",
                [url],
            )
            .unwrap();

        insert_crawl_data(
            pool.clone(),
            DatabaseResults {
                url: url.to_string(),
                data: serde_json::json!({"version": 2}),
            },
        )
        .await
        .unwrap();

        insert_bulk_crawl_data(
            pool.clone(),
            vec![
                DatabaseResults {
                    url: url.to_string(),
                    data: serde_json::json!({"version": 3}),
                },
                DatabaseResults {
                    url: url.to_string(),
                    data: serde_json::json!({"version": 4}),
                },
            ],
        )
        .await
        .unwrap();

        let conn = pool.get().unwrap();
        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM domain_crawl", [], |row| row.get(0))
            .unwrap();
        let (final_id, data_json, created_at): (i64, String, String) = conn
            .query_row(
                "SELECT id, data, created_at FROM domain_crawl WHERE url = ?1",
                [url],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(row_count, 1);
        assert_eq!(final_id, original_id);
        assert_eq!(created_at, "preserved");
        assert_eq!(
            serde_json::from_str::<Value>(&data_json).unwrap(),
            serde_json::json!({"version": 4})
        );
    }

    #[test]
    fn reconciliation_is_batched_fragment_insensitive_and_query_preserving() {
        let mut conn = Connection::open_in_memory().unwrap();
        create_crawl_table(&conn);

        insert_page(
            &conn,
            "https://example.com/Case?q=1",
            serde_json::json!({"url":"https://example.com/Case?q=1","status_code":404}),
        );
        insert_page(
            &conn,
            "https://example.com/Case?q=2",
            serde_json::json!({"url":"https://example.com/Case?q=2","status_code":200}),
        );
        insert_page(
            &conn,
            "https://example.com/failed",
            serde_json::json!({
                "url":"https://example.com/failed",
                "status_code":0,
                "crawl_error":"connection timed out"
            }),
        );
        insert_page(
            &conn,
            "https://example.com/source-1",
            serde_json::json!({
                "url":"https://example.com/source-1",
                "status_code":200,
                "inoutlinks_status_codes":{"internal":[
                    internal_link("https://example.com/Case?q=1#first"),
                    internal_link("https://example.com/Case?q=2#second"),
                    internal_link("https://example.com/missing#section")
                ]}
            }),
        );
        insert_page(
            &conn,
            "https://example.com/source-2",
            serde_json::json!({
                "url":"https://example.com/source-2",
                "status_code":200,
                "inoutlinks_status_codes":{"internal":[
                    internal_link("https://example.com/failed#details")
                ]}
            }),
        );

        // Batch size 1 exercises both target-index and page-update pagination.
        assert_eq!(
            reconcile_internal_link_statuses_on_connection(&mut conn, 1).unwrap(),
            3
        );

        let source_1_json: String = conn
            .query_row(
                "SELECT data FROM domain_crawl WHERE url = ?1",
                ["https://example.com/source-1"],
                |row| row.get(0),
            )
            .unwrap();
        let source_1: Value = serde_json::from_str(&source_1_json).unwrap();
        let links = source_1["inoutlinks_status_codes"]["internal"]
            .as_array()
            .unwrap();
        assert_eq!(links[0]["status"], 404);
        assert_eq!(links[0]["error"], "HTTP Error: 404");
        assert_eq!(links[1]["status"], 200);
        assert!(links[1]["error"].is_null());
        assert!(links[2]["status"].is_null());
        assert!(links[2]["error"].is_null());

        let source_2_json: String = conn
            .query_row(
                "SELECT data FROM domain_crawl WHERE url = ?1",
                ["https://example.com/source-2"],
                |row| row.get(0),
            )
            .unwrap();
        let source_2: Value = serde_json::from_str(&source_2_json).unwrap();
        let failed = &source_2["inoutlinks_status_codes"]["internal"][0];
        assert!(failed["status"].is_null());
        assert_eq!(failed["error"], "connection timed out");

        // Reconciliation is idempotent and does not rewrite already-correct links.
        assert_eq!(
            reconcile_internal_link_statuses_on_connection(&mut conn, 2).unwrap(),
            0
        );
    }

    #[test]
    fn incoming_link_normalization_preserves_resource_semantics() {
        assert_eq!(
            normalize_url("https://EXAMPLE.com:443/Path/?q=One#first"),
            normalize_url("https://example.com/Path/?q=One#second")
        );
        assert_ne!(
            normalize_url("https://example.com/Path/?q=One"),
            normalize_url("https://example.com/path/?q=One")
        );
        assert_ne!(
            normalize_url("https://example.com/Path/?q=One"),
            normalize_url("https://example.com/Path/?q=Two")
        );
        assert_ne!(
            normalize_url("https://example.com/Path"),
            normalize_url("https://example.com/Path/")
        );
    }
}

/// Ensures the `domain_crawl` table has a `link_score` column, adding it if missing.
/// No-op (rather than an error) if the table doesn't exist yet, since that's the
/// normal state before any crawl has run.
fn ensure_link_score_column(conn: &Connection) -> Result<(), DatabaseError> {
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='domain_crawl'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);

    if !table_exists {
        return Ok(());
    }

    let mut stmt = conn.prepare("PRAGMA table_info(domain_crawl)")?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == "link_score");
    drop(stmt);

    if !has_column {
        conn.execute("ALTER TABLE domain_crawl ADD COLUMN link_score INTEGER", [])?;
    }

    Ok(())
}

// Helper for file extension check. Deliberately an allowlist of known
// downloadable-document/media/archive extensions, scoped to only the final
// path segment (not the whole URL) — the previous denylist approach matched
// the last '.' anywhere in the string, so a bare "https://example.com/" was
// misread as a file with extension "com" (short, not in the denylist).
// Images/CSS/JS are intentionally excluded here since they're already
// reported separately (Images, CSS, Javascript sections).
fn has_file_extension(url: &str) -> bool {
    const FILE_EXTENSIONS: &[&str] = &[
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "rtf", "odt", "ods",
        "odp", "zip", "rar", "7z", "tar", "gz", "mp3", "mp4", "wav", "avi", "mov", "wmv",
    ];
    let path = url.split('?').next().unwrap_or(url).split('#').next().unwrap_or(url);
    let last_segment = path.rsplit('/').next().unwrap_or(path);
    match last_segment.rfind('.') {
        Some(idx) if idx < last_segment.len() - 1 => {
            let ext = last_segment[idx + 1..].to_lowercase();
            FILE_EXTENSIONS.contains(&ext.as_str())
        }
        _ => false,
    }
}

pub async fn insert_crawl_data(
    pool: Arc<Pool<SqliteConnectionManager>>,
    data: DatabaseResults,
) -> Result<(), DatabaseError> {
    let data_json = serde_json::to_string(&data.data)?;
    let url = data.url.clone();

    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| {
            DatabaseError::ConnectionError(format!("Failed to get connection for insert: {}", e))
        })?;
        let mut stmt = conn.prepare_cached(
            "INSERT INTO domain_crawl (url, data) VALUES (?1, ?2)
             ON CONFLICT(url) DO UPDATE SET data = excluded.data",
        )?;
        let rows = stmt.execute(params![url, data_json])?;
        println!("Inserted data for URL: {}, rows affected: {}", url, rows);
        Ok(())
    })
    .await?
}

pub async fn insert_bulk_crawl_data(
    pool: Arc<Pool<SqliteConnectionManager>>,
    data: Vec<DatabaseResults>,
) -> Result<(), DatabaseError> {
    if data.is_empty() {
        return Ok(());
    }

    // Use a reasonable default chunk size to avoid opening the settings file on every batch.
    // The caller (domain_crawler) already reads settings once at startup.
    let db_batch_size: usize = 100;

    let data_len = data.len(); // Only keep the length
    let result = tokio::task::spawn_blocking(move || -> Result<usize, DatabaseError> {
        let mut conn = pool.get().map_err(|e| {
            DatabaseError::ConnectionError(format!(
                "Failed to get connection for bulk insert: {}",
                e
            ))
        })?;

        let tx = conn.transaction().map_err(|e| {
            DatabaseError::TransactionError(format!("Failed to start transaction: {}", e))
        })?;

        let mut total_rows = 0;

        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO domain_crawl (url, data) VALUES (?1, ?2)
                     ON CONFLICT(url) DO UPDATE SET data = excluded.data",
                )
                .map_err(|e| {
                    DatabaseError::QueryError(format!("Failed to prepare statement: {}", e))
                })?;

            for chunk in data.chunks(db_batch_size) {
                let mut chunk_entries = Vec::with_capacity(chunk.len());

                for item in chunk {
                    let json = serde_json::to_string(&item.data)
                        .map_err(|e| DatabaseError::SerializationError(e.to_string()))?;
                    chunk_entries.push((item.url.clone(), json));
                }

                for (url, data_json) in &chunk_entries {
                    let rows = stmt
                        .execute(params![url, data_json])
                        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
                    total_rows += rows;
                }
            }
        }

        tx.commit().map_err(|e| {
            DatabaseError::TransactionError(format!("Failed to commit transaction: {}", e))
        })?;

        Ok(total_rows)
    })
    .await??;

    println!(
        "Bulk insert completed: {} entries total, {} rows affected",
        data_len, result
    );

    Ok(())
}

pub fn create_diff_tables() -> Result<(), DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;

    let data_dir = project_dirs.data_dir();
    let db_dir = data_dir.join("db");

    fs::create_dir_all(&db_dir).map_err(|e| {
        DatabaseError::DirectoryError(format!("Failed to create db directory: {}", e))
    })?;

    let conn = Connection::open(db_dir.join("diff.db"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS previous_crawl (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS current_crawl (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )?;

    println!("Tables created successfully");
    Ok(())
}

pub async fn clone_batched_crawl_into_persistent_db() -> Result<(), DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;

    let data_dir = project_dirs.data_dir();
    let db_dir = data_dir.join("db");

    let db = Database::initialize_db(&db_dir.join("deep_crawl_batches.db")).await?;
    let urls = db.get_urls().await?;

    tokio::task::spawn_blocking(move || {
        let mut conn = Connection::open(db_dir.join("diff.db"))?;
        let tx = conn.transaction()?;

        tx.execute("DELETE FROM previous_crawl", [])?;
        tx.execute(
            "INSERT INTO previous_crawl (url) SELECT url FROM current_crawl",
            [],
        )?;

        tx.execute("DELETE FROM current_crawl", [])?;

        for url in &urls {
            tx.execute("INSERT INTO current_crawl (url) VALUES (?1)", params![url])?;
        }

        tx.commit()?;
        Ok(())
    })
    .await?
}

fn ensure_crawl_snapshot_schema(conn: &Connection) -> Result<(), DatabaseError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS crawl_snapshots (
            session_id INTEGER PRIMARY KEY,
            domain TEXT NOT NULL,
            created_at TEXT NOT NULL,
            page_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS crawl_snapshot_pages (
            session_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT,
            PRIMARY KEY (session_id, url)
        );
        CREATE INDEX IF NOT EXISTS idx_crawl_snapshot_pages_session
            ON crawl_snapshot_pages(session_id);
        "#,
    )?;
    Ok(())
}

/// Persist the complete active crawl under its history row id. This keeps all
/// crawl columns as their original JSON and avoids the previous 5,000-row UI
/// cap and "latest crawl only" history limitation.
pub async fn create_crawl_snapshot(
    session_id: i64,
    domain: String,
    created_at: String,
) -> Result<usize, DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;
    let db_path = project_dirs.data_dir().join("db").join("deep_crawl_batches.db");

    tokio::task::spawn_blocking(move || {
        let mut conn = Connection::open(db_path)?;
        ensure_crawl_snapshot_schema(&conn)?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM crawl_snapshot_pages WHERE session_id = ?1",
            params![session_id],
        )?;
        let page_count = tx.execute(
            "INSERT INTO crawl_snapshot_pages (session_id, url, data, created_at)
             SELECT ?1, url, data, created_at FROM domain_crawl",
            params![session_id],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO crawl_snapshots (session_id, domain, created_at, page_count)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_id, domain, created_at, page_count as i64],
        )?;
        tx.commit()?;
        Ok(page_count)
    })
    .await?
}

/// Make an archived crawl the active dataset so all existing DB-backed tables,
/// exports and issue views can reuse their normal query paths.
pub async fn restore_crawl_snapshot(session_id: i64) -> Result<usize, DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;
    let db_path = project_dirs.data_dir().join("db").join("deep_crawl_batches.db");

    tokio::task::spawn_blocking(move || {
        let mut conn = Connection::open(db_path)?;
        ensure_crawl_snapshot_schema(&conn)?;
        let page_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM crawl_snapshot_pages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        if page_count == 0 {
            return Err(DatabaseError::NotFound(format!(
                "No full snapshot is available for crawl {}",
                session_id
            )));
        }

        let tx = conn.transaction()?;
        tx.execute("DELETE FROM domain_crawl", [])?;
        tx.execute(
            "INSERT INTO domain_crawl (url, data, created_at)
             SELECT url, data, COALESCE(created_at, CURRENT_TIMESTAMP)
             FROM crawl_snapshot_pages WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.commit()?;
        Ok(page_count as usize)
    })
    .await?
}

pub fn delete_crawl_snapshots(session_ids: &[i32]) -> Result<(), DatabaseError> {
    if session_ids.is_empty() {
        return Ok(());
    }
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;
    let db_path = project_dirs.data_dir().join("db").join("deep_crawl_batches.db");
    let mut conn = Connection::open(db_path)?;
    ensure_crawl_snapshot_schema(&conn)?;
    let tx = conn.transaction()?;
    for session_id in session_ids {
        tx.execute(
            "DELETE FROM crawl_snapshot_pages WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.execute(
            "DELETE FROM crawl_snapshots WHERE session_id = ?1",
            params![session_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

const CRAWL_FILE_VERSION: i64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlFileInfo {
    pub version: i64,
    pub saved_at: String,
    pub domain: String,
    pub page_count: i64,
}

/// Save the complete active SQLite crawl without routing it through the
/// frontend's bounded in-memory table store.
pub async fn save_crawl_file(path: String) -> Result<CrawlFileInfo, DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;
    let source_path = project_dirs.data_dir().join("db").join("deep_crawl_batches.db");

    tokio::task::spawn_blocking(move || {
        let destination = std::path::PathBuf::from(path);
        let parent = destination.parent().ok_or_else(|| {
            DatabaseError::DirectoryError("Invalid crawl file destination".to_string())
        })?;
        fs::create_dir_all(parent)?;

        let source = Connection::open(source_path)?;
        ensure_link_score_column(&source)?;
        let page_count: i64 =
            source.query_row("SELECT COUNT(*) FROM domain_crawl", [], |row| row.get(0))?;
        if page_count == 0 {
            return Err(DatabaseError::NotFound("No crawl is available to save".to_string()));
        }
        let first_url: String = source.query_row(
            "SELECT url FROM domain_crawl ORDER BY id LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        let domain = Url::parse(&first_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string());
        let saved_at = chrono::Utc::now().to_rfc3339();
        let info = CrawlFileInfo {
            version: CRAWL_FILE_VERSION,
            saved_at: saved_at.clone(),
            domain: domain.clone(),
            page_count,
        };

        let temp_path = destination.with_extension(format!(
            "onwebscrawl.tmp-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_file(&temp_path);
        source.execute(
            "ATTACH DATABASE ?1 AS crawl_export",
            params![temp_path.to_string_lossy().to_string()],
        )?;

        let export_result = (|| -> Result<(), DatabaseError> {
            source.execute_batch(
                r#"
                CREATE TABLE crawl_export.crawl_manifest (
                    version INTEGER NOT NULL,
                    saved_at TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    page_count INTEGER NOT NULL
                );
                CREATE TABLE crawl_export.domain_crawl (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL UNIQUE,
                    data TEXT NOT NULL,
                    created_at TEXT,
                    link_score INTEGER
                );
                CREATE INDEX crawl_export.idx_domain_crawl_url ON domain_crawl(url);
                "#,
            )?;
            source.execute(
                "INSERT INTO crawl_export.crawl_manifest
                 (version, saved_at, domain, page_count) VALUES (?1, ?2, ?3, ?4)",
                params![CRAWL_FILE_VERSION, saved_at, domain, page_count],
            )?;
            source.execute(
                "INSERT INTO crawl_export.domain_crawl
                 (url, data, created_at, link_score)
                 SELECT url, data, created_at, link_score FROM main.domain_crawl",
                [],
            )?;
            Ok(())
        })();
        let _ = source.execute("DETACH DATABASE crawl_export", []);
        if let Err(error) = export_result {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }

        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        fs::rename(&temp_path, &destination)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o600))?;
        }
        Ok(info)
    })
    .await?
}

/// Open a native SQLite crawl file and make it the active dataset. JSON files
/// from version 1 are intentionally handled by the existing frontend fallback.
pub async fn open_crawl_file(path: String) -> Result<CrawlFileInfo, DatabaseError> {
    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;
    let active_path = project_dirs.data_dir().join("db").join("deep_crawl_batches.db");

    tokio::task::spawn_blocking(move || {
        let import_path = std::path::PathBuf::from(path);
        if !import_path.is_file() {
            return Err(DatabaseError::NotFound("Crawl file does not exist".to_string()));
        }

        let mut active = Connection::open(active_path)?;
        ensure_link_score_column(&active)?;
        active.execute(
            "ATTACH DATABASE ?1 AS crawl_import",
            params![import_path.to_string_lossy().to_string()],
        )?;

        let import_result = (|| -> Result<CrawlFileInfo, DatabaseError> {
            let info = active.query_row(
                "SELECT version, saved_at, domain, page_count
                 FROM crawl_import.crawl_manifest LIMIT 1",
                [],
                |row| {
                    Ok(CrawlFileInfo {
                        version: row.get(0)?,
                        saved_at: row.get(1)?,
                        domain: row.get(2)?,
                        page_count: row.get(3)?,
                    })
                },
            )?;
            if info.version > CRAWL_FILE_VERSION {
                return Err(DatabaseError::SerializationError(format!(
                    "Crawl file version {} is newer than supported version {}",
                    info.version, CRAWL_FILE_VERSION
                )));
            }

            let tx = active.transaction()?;
            tx.execute("DELETE FROM domain_crawl", [])?;
            tx.execute(
                "INSERT INTO domain_crawl (url, data, created_at, link_score)
                 SELECT url, data, created_at, link_score
                 FROM crawl_import.domain_crawl",
                [],
            )?;
            tx.commit()?;
            Ok(info)
        })();
        let _ = active.execute("DETACH DATABASE crawl_import", []);
        import_result
    })
    .await?
}

#[derive(Serialize, Debug, Deserialize)]
pub struct DiffAnalysis {
    added: Differential,
    removed: Differential,
}

#[derive(Serialize, Debug, Deserialize)]
pub struct Differential {
    url: Option<String>, // Use Option to handle cases where there is no URL
    pages: Vec<String>,
    number_of_pages: usize,
    timestamp: Option<String>,
    first_url: Option<String>,
    last_url: Option<String>,
}

//NOTE: This is the function that analyses the diffs

// Helper function to compare the fisr and last elemets of the tables
// it ensures that the domain is the same and if it isnt then use a specific one.
pub async fn check_diff_domains(_urls: Vec<String>) -> Result<(), String> {
    Ok(())
}

pub async fn analyse_diffs() -> Result<DiffAnalysis, DatabaseError> {
    println!("Analyzing diffs");

    let project_dirs = ProjectDirs::from("", "", "rustyseo").ok_or_else(|| {
        DatabaseError::DirectoryError("Failed to get project directories".to_string())
    })?;

    let db_dir = project_dirs.data_dir().join("db");
    let db_path = db_dir.join("diff.db");

    if !db_path.exists() {
        return Err(DatabaseError::NotFound(
            "Database file not found".to_string(),
        ));
    }

    tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&db_path).map_err(|e| {
            DatabaseError::ConnectionError(format!("Failed to open database: {}", e))
        })?;

        // Check if tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;

        if !tables.contains(&"current_crawl".to_string())
            || !tables.contains(&"previous_crawl".to_string())
        {
            return Err(DatabaseError::NotFound(
                "Required tables not found in database".to_string(),
            ));
        }

        #[derive(Debug)]
        struct UrlRecord {
            url: String,
            timestamp: Option<String>,
        }

        // Get first and last entries from current_crawl (clone them immediately)
        let (current_first, current_last) = {
            let (first, last) = conn.query_row(
                "SELECT 
                    (SELECT url FROM current_crawl LIMIT 1),
                    (SELECT url FROM current_crawl ORDER BY timestamp DESC LIMIT 1)",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )?;
            (first.clone(), last.clone())
        };

        // Get first and last entries from previous_crawl (clone them immediately)
        let (previous_first, previous_last) = {
            let (first, last) = conn.query_row(
                "SELECT 
                    (SELECT url FROM previous_crawl LIMIT 1),
                    (SELECT url FROM previous_crawl ORDER BY timestamp DESC LIMIT 1)",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )?;
            (first.clone(), last.clone())
        };

        println!(
            "Current crawl - First: {:?}, Last: {:?}",
            current_first, current_last
        );
        println!(
            "Previous crawl - First: {:?}, Last: {:?}",
            previous_first, previous_last
        );

        // Get added URLs with timestamps
        let mut added_records = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT url, timestamp FROM current_crawl
                 WHERE url NOT IN (SELECT url FROM previous_crawl)",
        )?;

        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            added_records.push(UrlRecord {
                url: row.get(0)?,
                timestamp: row.get(1)?,
            });
        }

        // Get removed URLs with timestamps
        let mut removed_records = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT url, timestamp FROM previous_crawl
                 WHERE url NOT IN (SELECT url FROM current_crawl)",
        )?;

        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            removed_records.push(UrlRecord {
                url: row.get(0)?,
                timestamp: row.get(1)?,
            });
        }

        // Get most recent timestamp from added records
        let added_timestamp = added_records
            .iter()
            .filter_map(|r| r.timestamp.as_ref())
            .max()
            .cloned();

        // Get most recent timestamp from removed records
        let removed_timestamp = removed_records
            .iter()
            .filter_map(|r| r.timestamp.as_ref())
            .max()
            .cloned();

        // Create differentials with first/last entries included
        let added_differential = Differential {
            url: added_records
                .first()
                .map(|r| r.url.clone())
                .or_else(|| current_first.clone())
                .or_else(|| previous_first.clone()),
            pages: {
                let mut pages: Vec<String> = added_records.iter().map(|r| r.url.clone()).collect();
                if let Some(ref first) = current_first {
                    if !pages.contains(first) {
                        pages.push(first.clone());
                    }
                }
                if let Some(ref last) = current_last {
                    if !pages.contains(last) {
                        pages.push(last.clone());
                    }
                }
                pages
            },
            number_of_pages: added_records.len(),
            timestamp: added_timestamp,
            first_url: current_first.clone(),
            last_url: current_last.clone(),
        };

        let removed_differential = Differential {
            url: removed_records
                .first()
                .map(|r| r.url.clone())
                .or_else(|| previous_first.clone())
                .or_else(|| current_first.clone()),
            pages: {
                let mut pages: Vec<String> =
                    removed_records.iter().map(|r| r.url.clone()).collect();
                if let Some(ref first) = previous_first {
                    if !pages.contains(first) {
                        pages.push(first.clone());
                    }
                }
                if let Some(ref last) = previous_last {
                    if !pages.contains(last) {
                        pages.push(last.clone());
                    }
                }
                pages
            },
            number_of_pages: removed_records.len(),
            timestamp: removed_timestamp,
            first_url: previous_first.clone(),
            last_url: previous_last.clone(),
        };

        Ok(DiffAnalysis {
            added: added_differential,
            removed: removed_differential,
        })
    })
    .await?
}
