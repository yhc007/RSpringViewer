//! Omniverse Nucleus Client
//! 
//! Handles communication with Nucleus server for USD file operations

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NucleusAsset {
    pub path: String,
    pub name: String,
    pub is_folder: bool,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USDPrim {
    pub path: String,
    pub name: String,
    pub type_name: String,
    pub attributes: Vec<USDAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USDAttribute {
    pub name: String,
    pub value: String,
    pub type_name: String,
}

pub struct NucleusClient {
    server_url: String,
    client: reqwest::Client,
    is_local: bool,
}

impl NucleusClient {
    pub fn new(server_url: &str) -> Self {
        let is_local = !server_url.starts_with("omniverse://");
        
        Self {
            server_url: server_url.to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
            is_local,
        }
    }
    
    pub async fn test_connection(&self) -> bool {
        if self.is_local {
            // Local path - just check if exists
            Path::new(&self.server_url).exists()
        } else {
            // Nucleus server - try to connect
            self.list_assets("/").await.is_ok()
        }
    }
    
    pub async fn list_assets(&self, path: &str) -> Result<Vec<NucleusAsset>> {
        if self.is_local {
            self.list_local_assets(path).await
        } else {
            self.list_nucleus_assets(path).await
        }
    }
    
    async fn list_local_assets(&self, path: &str) -> Result<Vec<NucleusAsset>> {
        let base = Path::new(&self.server_url);
        let full_path = if path == "/" { base.to_path_buf() } else { base.join(path.trim_start_matches('/')) };
        
        let mut assets = Vec::new();
        
        if full_path.is_dir() {
            for entry in std::fs::read_dir(&full_path)? {
                let entry = entry?;
                let meta = entry.metadata()?;
                
                assets.push(NucleusAsset {
                    path: entry.path().to_string_lossy().to_string(),
                    name: entry.file_name().to_string_lossy().to_string(),
                    is_folder: meta.is_dir(),
                    size: meta.len(),
                    modified: None,
                });
            }
        }
        
        Ok(assets)
    }
    
    async fn list_nucleus_assets(&self, path: &str) -> Result<Vec<NucleusAsset>> {
        // Nucleus REST API call
        // Note: Actual Nucleus API requires authentication
        let url = format!("{}/omni/api/assets{}", 
            self.server_url.replace("omniverse://", "http://"),
            path
        );
        
        let resp = self.client.get(&url).send().await?;
        let assets: Vec<NucleusAsset> = resp.json().await?;
        Ok(assets)
    }
    
    pub async fn read_usd_metadata(&self, usd_path: &str) -> Result<Vec<USDPrim>> {
        // For local files, we'd use pxr (OpenUSD Python bindings)
        // For now, return empty - actual implementation would parse USD
        
        tracing::debug!("Reading USD metadata from: {}", usd_path);
        
        // Placeholder - in production, use USD SDK
        Ok(Vec::new())
    }
    
    pub async fn write_usd_attribute(
        &self,
        usd_path: &str,
        prim_path: &str,
        attr_name: &str,
        value: &str,
    ) -> Result<()> {
        tracing::debug!(
            "Writing USD attribute: {} -> {}:{} = {}",
            usd_path, prim_path, attr_name, value
        );
        
        // Placeholder - in production, use USD SDK
        // Would need to:
        // 1. Open USD stage
        // 2. Get prim at prim_path
        // 3. Set attribute value
        // 4. Save stage
        
        Ok(())
    }
    
    pub async fn add_aas_reference(
        &self,
        usd_path: &str,
        prim_path: &str,
        aas_id: &str,
        equipment_id: &str,
    ) -> Result<()> {
        // Add custom AAS attributes to USD prim
        self.write_usd_attribute(usd_path, prim_path, "aas:id", aas_id).await?;
        self.write_usd_attribute(usd_path, prim_path, "aas:equipmentId", equipment_id).await?;
        
        Ok(())
    }
    
    pub async fn find_equipment_prims(&self, usd_path: &str) -> Result<Vec<(String, String)>> {
        // Find prims that match equipment patterns
        let prims = self.read_usd_metadata(usd_path).await?;
        
        let mut equipment = Vec::new();
        
        for prim in prims {
            // Check for AAS attribute
            for attr in &prim.attributes {
                if attr.name == "aas:equipmentId" {
                    equipment.push((prim.path.clone(), attr.value.clone()));
                    break;
                }
            }
            
            // Check name patterns
            let patterns = ["ROBOT", "CONVEYOR", "DRILL", "GANTRY", "CONTROL"];
            for pattern in patterns {
                if prim.name.to_uppercase().contains(pattern) {
                    equipment.push((prim.path.clone(), prim.name.clone()));
                    break;
                }
            }
        }
        
        Ok(equipment)
    }
}
