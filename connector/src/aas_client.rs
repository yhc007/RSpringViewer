//! AAS REST API Client

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AASShell {
    pub id: String,
    pub id_short: Option<String>,
    pub asset_kind: Option<String>,
    pub global_asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Submodel {
    pub id: String,
    pub id_short: Option<String>,
    pub semantic_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmodelElement {
    pub id_short: String,
    pub value: Option<String>,
    pub value_type: Option<String>,
}

pub struct AASClient {
    base_url: String,
    client: reqwest::Client,
}

impl AASClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }
    
    pub async fn test_connection(&self) -> bool {
        self.get_shells().await.is_ok()
    }
    
    pub async fn get_shells(&self) -> Result<Vec<AASShell>> {
        let url = format!("{}/api/aas", self.base_url);
        let resp = self.client.get(&url).send().await?;
        let shells: Vec<AASShell> = resp.json().await?;
        Ok(shells)
    }
    
    pub async fn get_shell(&self, aas_id: &str) -> Result<AASShell> {
        let url = format!("{}/shells/{}", self.base_url, aas_id);
        let resp = self.client.get(&url).send().await?;
        let shell: AASShell = resp.json().await?;
        Ok(shell)
    }
    
    pub async fn get_submodels(&self, aas_id: &str) -> Result<Vec<Submodel>> {
        let url = format!("{}/shells/{}/submodels", self.base_url, aas_id);
        let resp = self.client.get(&url).send().await?;
        let submodels: Vec<Submodel> = resp.json().await?;
        Ok(submodels)
    }
    
    pub async fn get_submodel_elements(&self, aas_id: &str, sm_id: &str) -> Result<Vec<SubmodelElement>> {
        let url = format!("{}/shells/{}/submodels/{}/submodel-elements", self.base_url, aas_id, sm_id);
        let resp = self.client.get(&url).send().await?;
        let elements: Vec<SubmodelElement> = resp.json().await?;
        Ok(elements)
    }
    
    pub async fn update_element(
        &self,
        aas_id: &str,
        sm_id: &str,
        elem_id: &str,
        value: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/shells/{}/submodels/{}/submodel-elements/{}",
            self.base_url, aas_id, sm_id, elem_id
        );
        
        let body = serde_json::json!({
            "id_short": elem_id,
            "value": value
        });
        
        self.client.put(&url)
            .json(&body)
            .send()
            .await?;
        
        Ok(())
    }
    
    pub async fn find_by_equipment_id(&self, equipment_id: &str) -> Result<Option<AASShell>> {
        let shells = self.get_shells().await?;
        
        // Exact match
        for shell in &shells {
            if shell.id_short.as_deref() == Some(equipment_id) {
                return Ok(Some(shell.clone()));
            }
        }
        
        // Partial match
        let eq_upper = equipment_id.to_uppercase();
        for shell in shells {
            if let Some(id_short) = &shell.id_short {
                if id_short.to_uppercase().contains(&eq_upper) {
                    return Ok(Some(shell));
                }
            }
        }
        
        Ok(None)
    }
    
    pub async fn get_operational_data(&self, aas_id: &str) -> Result<HashMap<String, String>> {
        let submodels = self.get_submodels(aas_id).await?;
        
        // Find OperationalData submodel
        for sm in submodels {
            let id_short = sm.id_short.as_deref().unwrap_or("");
            if id_short.contains("Operational") || id_short.contains("opdata") {
                let elements = self.get_submodel_elements(aas_id, &sm.id).await?;
                let mut data = HashMap::new();
                
                for elem in elements {
                    if let Some(value) = elem.value {
                        data.insert(elem.id_short, value);
                    }
                }
                
                return Ok(data);
            }
        }
        
        Ok(HashMap::new())
    }
}
