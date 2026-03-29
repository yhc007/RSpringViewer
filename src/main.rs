use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorData {
    pub id: String,
    pub timestamp: String,
    pub sensor_type: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquipmentData {
    pub equipment_id: String,
    pub timestamp: String,
    pub status: String,  // running, idle, error, maintenance, offline
    pub sensors: HashMap<String, f64>,
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub level: String,  // warning, critical
    pub sensor: String,
    pub value: f64,
    pub threshold: f64,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct EquipmentStatusOverview {
    pub equipment: Vec<EquipmentStatusEntry>,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct EquipmentStatusEntry {
    pub id: String,
    pub status: String,
    pub sensor_count: usize,
    pub alert_count: usize,
}
/// 장비 위치 오프셋
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionOffset {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub sensor_data: Arc<RwLock<Vec<SensorData>>>,
    pub equipment_data: Arc<RwLock<HashMap<String, EquipmentData>>>,
    pub equipment_positions: Arc<RwLock<HashMap<String, PositionOffset>>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IngestPayload {
    pub sensor_type: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EquipmentIngestPayload {
    pub status: String,
    pub sensors: HashMap<String, f64>,
    #[serde(default)]
    pub alerts: Vec<Alert>,
}

#[tokio::main]
async fn main() {
    // Load saved positions from file if exists
    let saved_positions = std::fs::read_to_string("config/equipment_positions.json")
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, PositionOffset>>(&s).ok())
        .unwrap_or_default();

    let state = AppState {
        sensor_data: Arc::new(RwLock::new(Vec::new())),
        equipment_data: Arc::new(RwLock::new(HashMap::new())),
        equipment_positions: Arc::new(RwLock::new(saved_positions)),
    };

    let app = Router::new()
        // Existing sensor endpoints (backward compatibility)
        .route("/api/data/latest", get(get_latest_data))
        .route("/api/data/ingest", post(ingest_data))
        .route("/api/data/simulate", post(simulate_data))
        .route("/api/health", get(health_check))
        .route("/api/models", get(list_models))
        // New equipment endpoints
        .route("/api/equipment/mapping", get(get_equipment_mapping))
        .route("/api/equipment/:id/data", get(get_equipment_data))
        .route("/api/equipment/:id/data", post(ingest_equipment_data))
        .route("/api/equipment/status", get(get_equipment_status))
        .route("/api/equipment/positions", get(get_equipment_positions).post(save_equipment_positions))
        // Serve models, config, and static files
        .nest_service("/models", ServeDir::new("models"))
        .nest_service("/config", ServeDir::new("config"))
        .fallback_service(ServeDir::new("static"))
        .with_state(state);

    println!("🚀 RSpring Server starting at http://0.0.0.0:8080");
    println!("📁 Models: models/  Config: config/  Static: static/");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}
// Existing sensor data handlers (backward compatibility)
async fn get_latest_data(State(state): State<AppState>) -> impl IntoResponse {
    let data = state.sensor_data.read().await;
    
    if data.is_empty() {
        return Json(json!({
            "data": [],
            "timestamp": Utc::now().to_rfc3339(),
        }));
    }

    let latest: Vec<_> = data.iter().cloned().collect();
    Json(json!({
        "data": latest,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn ingest_data(
    State(state): State<AppState>,
    Json(payload): Json<IngestPayload>,
) -> impl IntoResponse {
    let sensor = SensorData {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now().to_rfc3339(),
        sensor_type: payload.sensor_type,
        value: payload.value,
        unit: payload.unit,
    };

    let mut data = state.sensor_data.write().await;
    data.push(sensor.clone());

    (StatusCode::CREATED, Json(sensor))
}

async fn simulate_data(State(state): State<AppState>) -> impl IntoResponse {
    let equipment_ids = vec![
        "ROBOT_01", "ROBOT_02", "DRILL_TAP", "CONVEYOR_01", "CONVEYOR_02",
        "RECOIL_SPRING", "SPRING_CONVEYOR", "YOKE_CONVEYOR", "GANTRY",
        "STOPPER_NUT_CONV_01", "STOPPER_NUT_CONV_02", "NG_RELEASE_01",
        "NG_RELEASE_02", "CONTROL_BOX", "OPERATE_PANEL",
    ];

    let mut equipment_data = state.equipment_data.write().await;

    for equipment_id in equipment_ids {
        let sensors = generate_sensor_data(equipment_id);
        let alerts = detect_alerts(&sensors);

        let eq_data = EquipmentData {
            equipment_id: equipment_id.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            status: "running".to_string(),
            sensors,
            alerts,
        };

        equipment_data.insert(equipment_id.to_string(), eq_data);
    }

    Json(json!({
        "status": "success",
        "message": "Simulation completed",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}
// Equipment-specific handlers
async fn get_equipment_mapping() -> impl IntoResponse {
    // Serve equipment_mapping.json from config directory
    match tokio::fs::read_to_string("/Volumes/T7/Work/rspring-viewer/config/equipment_mapping.json").await {
        Ok(content) => {
            match serde_json::from_str::<Value>(&content) {
                Ok(json) => Json(json).into_response(),
                Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Invalid JSON").into_response(),
            }
        }
        Err(_) => (StatusCode::NOT_FOUND, "Equipment mapping not found").into_response(),
    }
}

async fn get_equipment_data(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let equipment_data = state.equipment_data.read().await;
    
    match equipment_data.get(&id) {
        Some(data) => Json(data.clone()).into_response(),
        None => (StatusCode::NOT_FOUND, "Equipment not found").into_response(),
    }
}

async fn ingest_equipment_data(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<EquipmentIngestPayload>,
) -> impl IntoResponse {
    let eq_data = EquipmentData {
        equipment_id: id.clone(),
        timestamp: Utc::now().to_rfc3339(),
        status: payload.status,
        sensors: payload.sensors,
        alerts: payload.alerts,
    };

    let mut equipment_data = state.equipment_data.write().await;
    equipment_data.insert(id, eq_data.clone());

    (StatusCode::CREATED, Json(eq_data))
}

async fn get_equipment_status(State(state): State<AppState>) -> impl IntoResponse {
    let equipment_data = state.equipment_data.read().await;
    
    let equipment: Vec<EquipmentStatusEntry> = equipment_data
        .iter()
        .map(|(id, data)| EquipmentStatusEntry {
            id: id.clone(),
            status: data.status.clone(),
            sensor_count: data.sensors.len(),
            alert_count: data.alerts.len(),
        })
        .collect();

    Json(EquipmentStatusOverview {
        equipment,
        timestamp: Utc::now().to_rfc3339(),
    })
}
// Sensor data generation based on equipment type
fn generate_sensor_data(equipment_id: &str) -> HashMap<String, f64> {
    let mut sensors = HashMap::new();
    
    match equipment_id {
        "ROBOT_01" | "ROBOT_02" => {
            sensors.insert("speed_rpm".to_string(), 1200.0 + (rand_f64() * 100.0));
            sensors.insert("temperature".to_string(), 65.0 + (rand_f64() * 15.0));
            sensors.insert("torque".to_string(), 45.0 + (rand_f64() * 20.0));
            sensors.insert("cycle_count".to_string(), 15000.0 + (rand_f64() * 5000.0));
        }
        "DRILL_TAP" => {
            sensors.insert("spindle_rpm".to_string(), 2000.0 + (rand_f64() * 300.0));
            sensors.insert("feed_rate".to_string(), 0.5 + (rand_f64() * 0.2));
            sensors.insert("temperature".to_string(), 72.0 + (rand_f64() * 18.0));
            sensors.insert("vibration".to_string(), 2.5 + (rand_f64() * 1.0));
        }
        "CONVEYOR_01" | "CONVEYOR_02" => {
            sensors.insert("speed".to_string(), 0.8 + (rand_f64() * 0.3));
            sensors.insert("motor_current".to_string(), 12.0 + (rand_f64() * 5.0));
            sensors.insert("chain_tension".to_string(), 150.0 + (rand_f64() * 40.0));
        }
        "RECOIL_SPRING" => {
            sensors.insert("spring_force_n".to_string(), 500.0 + (rand_f64() * 100.0));
            sensors.insert("press_position".to_string(), 45.0 + (rand_f64() * 15.0));
            sensors.insert("cycle_count".to_string(), 8000.0 + (rand_f64() * 3000.0));
        }
        "SPRING_CONVEYOR" | "YOKE_CONVEYOR" => {
            sensors.insert("speed".to_string(), 0.6 + (rand_f64() * 0.2));
            sensors.insert("motor_current".to_string(), 10.0 + (rand_f64() * 4.0));
            sensors.insert("chain_tension".to_string(), 120.0 + (rand_f64() * 30.0));
        }
        "GANTRY" => {
            sensors.insert("x_position".to_string(), 100.0 + (rand_f64() * 50.0));
            sensors.insert("y_position".to_string(), 150.0 + (rand_f64() * 50.0));
            sensors.insert("z_position".to_string(), 80.0 + (rand_f64() * 30.0));
            sensors.insert("speed".to_string(), 0.5 + (rand_f64() * 0.2));
        }
        "STOPPER_NUT_CONV_01" | "STOPPER_NUT_CONV_02" => {
            sensors.insert("speed".to_string(), 0.7 + (rand_f64() * 0.25));
            sensors.insert("motor_current".to_string(), 11.0 + (rand_f64() * 4.5));
            sensors.insert("chain_tension".to_string(), 130.0 + (rand_f64() * 35.0));
        }
        "NG_RELEASE_01" | "NG_RELEASE_02" => {
            sensors.insert("cylinder_pressure".to_string(), 6.0 + (rand_f64() * 1.5));
            sensors.insert("ng_count".to_string(), (rand_f64() * 100.0));
        }
        "CONTROL_BOX" => {
            sensors.insert("cabinet_temp".to_string(), 35.0 + (rand_f64() * 10.0));
        }
        "OPERATE_PANEL" => {
            sensors.insert("cabinet_temp".to_string(), 32.0 + (rand_f64() * 8.0));
        }
        _ => {
            sensors.insert("generic_value".to_string(), rand_f64() * 100.0);
        }
    }
    
    sensors
}

fn detect_alerts(sensors: &HashMap<String, f64>) -> Vec<Alert> {
    let mut alerts = Vec::new();

    // Define thresholds for common sensors
    let thresholds = vec![
        ("temperature", 85.0, "warning"),
        ("vibration", 4.0, "warning"),
        ("motor_current", 20.0, "warning"),
        ("chain_tension", 200.0, "critical"),
        ("spindle_rpm", 3000.0, "warning"),
        ("spring_force_n", 700.0, "critical"),
        ("cabinet_temp", 50.0, "warning"),
    ];

    for (sensor_name, threshold, level) in thresholds {
        if let Some(&value) = sensors.get(sensor_name) {
            if value > threshold {
                alerts.push(Alert {
                    level: level.to_string(),
                    sensor: sensor_name.to_string(),
                    value,
                    threshold,
                    message: format!("{} exceeded threshold: {:.2} > {:.2}", sensor_name, value, threshold),
                });
            }
        }
    }

    alerts
}

fn rand_f64() -> f64 {
    // Simple deterministic pseudo-random for demo purposes
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    ((timestamp % 1000) as f64) / 1000.0
}

async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "rspring-viewer",
        "version": "0.2.0",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn list_models() -> impl IntoResponse {
    let models_dir = std::path::Path::new("models");
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if matches!(ext.as_str(), "glb" | "gltf" | "stl" | "obj") {
                if let Ok(meta) = entry.metadata() {
                    models.push(json!({
                        "id": Uuid::new_v4().to_string(),
                        "name": path.file_name().unwrap_or_default().to_string_lossy(),
                        "file_path": format!("/models/{}", path.file_name().unwrap_or_default().to_string_lossy()),
                        "file_size": meta.len()
                    }));
                }
            }
        }
    }
    Json(json!({ "models": models }))
}

/// 장비 위치 오프셋 조회
async fn get_equipment_positions(State(state): State<AppState>) -> impl IntoResponse {
    let positions = state.equipment_positions.read().await;
    Json(json!(*positions))
}

/// 장비 위치 오프셋 저장 (파일 + 메모리)
async fn save_equipment_positions(
    State(state): State<AppState>,
    Json(data): Json<HashMap<String, PositionOffset>>,
) -> impl IntoResponse {
    // Update in memory
    {
        let mut positions = state.equipment_positions.write().await;
        *positions = data.clone();
    }
    
    // Persist to file
    let json_str = serde_json::to_string_pretty(&data).unwrap_or_default();
    if let Err(e) = std::fs::write("config/equipment_positions.json", &json_str) {
        eprintln!("Failed to save positions: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "save failed"}))); 
    }
    
    println!("💾 Equipment positions saved: {} entries", data.len());
    (StatusCode::OK, Json(json!({"saved": data.len()})))
}
