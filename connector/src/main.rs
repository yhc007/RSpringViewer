//! Nucleus AAS Connector
//! 
//! Bidirectional sync between Omniverse Nucleus and Asset Administration Shell
//! 
//! Features:
//! - USD file change detection → AAS metadata update
//! - AAS data change → USD custom attribute update
//! - SimReady metadata synchronization

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use anyhow::{Context, Result};
use clap::Parser;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{info, warn, error, debug};

mod aas_client;
mod nucleus_client;
mod sync_engine;

use aas_client::AASClient;
use nucleus_client::NucleusClient;
use sync_engine::SyncEngine;

#[derive(Parser, Debug)]
#[command(name = "nucleus-aas-connector")]
#[command(about = "Omniverse Nucleus ↔ AAS bidirectional sync")]
struct Args {
    /// AAS server URL
    #[arg(short, long, default_value = "http://localhost:8080")]
    aas_server: String,
    
    /// Nucleus server URL (or local path for file watching)
    #[arg(short, long, default_value = "omniverse://localhost")]
    nucleus_server: String,
    
    /// USD file or directory to watch
    #[arg(short, long)]
    watch_path: Option<PathBuf>,
    
    /// Sync interval in seconds
    #[arg(short, long, default_value = "5")]
    interval: u64,
    
    /// Enable bidirectional sync (AAS → USD)
    #[arg(long, default_value = "true")]
    bidirectional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub last_sync: chrono::DateTime<chrono::Utc>,
    pub synced_assets: Vec<SyncedAsset>,
    pub errors: Vec<SyncError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedAsset {
    pub usd_path: String,
    pub aas_id: String,
    pub equipment_id: String,
    pub last_update: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncError {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub asset: String,
    pub message: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("nucleus_aas_connector=debug,info")
        .init();
    
    let args = Args::parse();
    
    info!("🔗 Nucleus AAS Connector starting...");
    info!("  AAS Server: {}", args.aas_server);
    info!("  Nucleus: {}", args.nucleus_server);
    info!("  Sync interval: {}s", args.interval);
    
    // Initialize clients
    let aas_client = Arc::new(AASClient::new(&args.aas_server));
    let nucleus_client = Arc::new(NucleusClient::new(&args.nucleus_server));
    
    // Test connections
    if !aas_client.test_connection().await {
        warn!("⚠ AAS server not reachable, will retry...");
    } else {
        info!("✅ AAS server connected");
    }
    
    // Initialize sync engine
    let sync_engine = Arc::new(RwLock::new(SyncEngine::new(
        aas_client.clone(),
        nucleus_client.clone(),
    )));
    
    // Start file watcher if path provided
    if let Some(watch_path) = args.watch_path {
        let engine = sync_engine.clone();
        tokio::spawn(async move {
            if let Err(e) = watch_files(watch_path, engine).await {
                error!("File watcher error: {}", e);
            }
        });
    }
    
    // Main sync loop
    let mut interval = tokio::time::interval(Duration::from_secs(args.interval));
    
    loop {
        interval.tick().await;
        
        let mut engine = sync_engine.write().await;
        
        // Sync AAS → USD (if bidirectional)
        if args.bidirectional {
            if let Err(e) = engine.sync_aas_to_usd().await {
                warn!("AAS → USD sync error: {}", e);
            }
        }
        
        // Report status
        let state = engine.get_state();
        debug!(
            "Sync status: {} assets, {} errors",
            state.synced_assets.len(),
            state.errors.len()
        );
    }
}

async fn watch_files(path: PathBuf, engine: Arc<RwLock<SyncEngine>>) -> Result<()> {
    info!("👁 Watching for USD changes: {:?}", path);
    
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let _ = tx.blocking_send(event);
            }
        },
        Config::default(),
    )?;
    
    watcher.watch(&path, RecursiveMode::Recursive)?;
    
    while let Some(event) = rx.recv().await {
        // Filter for USD file changes
        for path in event.paths {
            if let Some(ext) = path.extension() {
                if ext == "usd" || ext == "usda" || ext == "usdc" {
                    info!("📝 USD file changed: {:?}", path);
                    
                    let mut engine = engine.write().await;
                    if let Err(e) = engine.on_usd_changed(&path).await {
                        warn!("Failed to sync USD change: {}", e);
                    }
                }
            }
        }
    }
    
    Ok(())
}
