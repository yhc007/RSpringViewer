//! Sync Engine - Bidirectional sync between Nucleus and AAS

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use tracing::{info, warn, debug};

use crate::aas_client::AASClient;
use crate::nucleus_client::NucleusClient;
use crate::{SyncState, SyncedAsset, SyncError};

pub struct SyncEngine {
    aas_client: Arc<AASClient>,
    nucleus_client: Arc<NucleusClient>,
    state: SyncState,
    equipment_mapping: HashMap<String, String>, // equipment_id -> aas_id
}

impl SyncEngine {
    pub fn new(aas_client: Arc<AASClient>, nucleus_client: Arc<NucleusClient>) -> Self {
        Self {
            aas_client,
            nucleus_client,
            state: SyncState {
                last_sync: Utc::now(),
                synced_assets: Vec::new(),
                errors: Vec::new(),
            },
            equipment_mapping: HashMap::new(),
        }
    }
    
    pub fn get_state(&self) -> &SyncState {
        &self.state
    }
    
    /// Handle USD file change - sync to AAS
    pub async fn on_usd_changed(&mut self, usd_path: &Path) -> Result<()> {
        info!("🔄 Syncing USD → AAS: {:?}", usd_path);
        
        let path_str = usd_path.to_string_lossy().to_string();
        
        // Find equipment prims in the USD file
        let equipment = self.nucleus_client.find_equipment_prims(&path_str).await?;
        
        for (prim_path, equipment_id) in equipment {
            // Find or create AAS for this equipment
            if let Some(shell) = self.aas_client.find_by_equipment_id(&equipment_id).await? {
                let aas_id = shell.id.clone();
                
                // Update mapping
                self.equipment_mapping.insert(equipment_id.clone(), aas_id.clone());
                
                // Record sync
                self.state.synced_assets.push(SyncedAsset {
                    usd_path: prim_path.clone(),
                    aas_id: aas_id.clone(),
                    equipment_id: equipment_id.clone(),
                    last_update: Utc::now(),
                });
                
                debug!("Mapped {} → {}", equipment_id, aas_id);
            } else {
                warn!("No AAS found for equipment: {}", equipment_id);
            }
        }
        
        self.state.last_sync = Utc::now();
        Ok(())
    }
    
    /// Sync AAS operational data to USD attributes
    pub async fn sync_aas_to_usd(&mut self) -> Result<()> {
        debug!("🔄 Syncing AAS → USD");
        
        // Get all AAS shells
        let shells = self.aas_client.get_shells().await?;
        
        for shell in shells {
            let aas_id = &shell.id;
            let equipment_id = shell.id_short.as_deref().unwrap_or(&shell.id);
            
            // Get operational data
            let op_data = self.aas_client.get_operational_data(aas_id).await?;
            
            if op_data.is_empty() {
                continue;
            }
            
            // Find corresponding USD prim
            if let Some(synced) = self.state.synced_assets.iter().find(|a| a.equipment_id == equipment_id) {
                // Update USD attributes with AAS data
                for (key, value) in &op_data {
                    let attr_name = format!("aas:{}", key);
                    
                    // In production, this would actually write to USD
                    debug!("Would update USD {} : {} = {}", synced.usd_path, attr_name, value);
                }
            }
        }
        
        Ok(())
    }
    
    /// Sync PLC/sensor data to both AAS and USD
    pub async fn sync_sensor_data(&mut self, equipment_id: &str, data: HashMap<String, f64>) -> Result<()> {
        info!("📊 Syncing sensor data for {}", equipment_id);
        
        // Find AAS
        if let Some(aas_id) = self.equipment_mapping.get(equipment_id) {
            // Get OperationalData submodel
            let submodels = self.aas_client.get_submodels(aas_id).await?;
            
            for sm in submodels {
                let id_short = sm.id_short.as_deref().unwrap_or("");
                if id_short.contains("Operational") || id_short.contains("opdata") {
                    // Update each sensor value
                    for (sensor_name, value) in &data {
                        if let Err(e) = self.aas_client.update_element(
                            aas_id,
                            &sm.id,
                            sensor_name,
                            &value.to_string(),
                        ).await {
                            warn!("Failed to update AAS element: {}", e);
                        }
                    }
                    break;
                }
            }
        }
        
        // Update USD (would trigger LiveSync in Omniverse)
        if let Some(synced) = self.state.synced_assets.iter().find(|a| a.equipment_id == equipment_id) {
            for (sensor_name, value) in &data {
                let attr_name = format!("sensor:{}", sensor_name);
                
                if let Err(e) = self.nucleus_client.write_usd_attribute(
                    &synced.usd_path,
                    &synced.usd_path, // prim path
                    &attr_name,
                    &value.to_string(),
                ).await {
                    warn!("Failed to update USD attribute: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Build initial mapping from USD to AAS
    pub async fn build_mapping(&mut self, usd_paths: Vec<String>) -> Result<()> {
        info!("🔧 Building equipment mapping...");
        
        for usd_path in usd_paths {
            let equipment = self.nucleus_client.find_equipment_prims(&usd_path).await?;
            
            for (prim_path, equipment_id) in equipment {
                if let Some(shell) = self.aas_client.find_by_equipment_id(&equipment_id).await? {
                    self.equipment_mapping.insert(equipment_id.clone(), shell.id.clone());
                    
                    self.state.synced_assets.push(SyncedAsset {
                        usd_path: prim_path,
                        aas_id: shell.id,
                        equipment_id,
                        last_update: Utc::now(),
                    });
                }
            }
        }
        
        info!("✅ Mapped {} equipment items", self.equipment_mapping.len());
        Ok(())
    }
    
    /// Add error to state
    pub fn add_error(&mut self, asset: &str, message: &str) {
        self.state.errors.push(SyncError {
            timestamp: Utc::now(),
            asset: asset.to_string(),
            message: message.to_string(),
        });
        
        // Keep only last 100 errors
        if self.state.errors.len() > 100 {
            self.state.errors.remove(0);
        }
    }
}
