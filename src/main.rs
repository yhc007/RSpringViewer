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
use tower_http::cors::{CorsLayer, Any};
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
    pub status: String,
    pub sensors: HashMap<String, f64>,
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub level: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionOffset {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone)]
pub struct AppState {
    pub sensor_data: Arc<RwLock<Vec<SensorData>>>,
    pub equipment_data: Arc<RwLock<HashMap<String, EquipmentData>>>,
    pub equipment_positions: Arc<RwLock<HashMap<String, PositionOffset>>>,
    pub aas_server_url: String,
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
    tracing_subscriber::fmt::init();

    let saved_positions = std::fs::read_to_string("config/equipment_positions.json")
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, PositionOffset>>(&s).ok())
        .unwrap_or_default();

    // AAS 서버 URL (같은 서버의 8080 포트)
    let aas_url = std::env::var("AAS_SERVER_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());

    let state = AppState {
        sensor_data: Arc::new(RwLock::new(Vec::new())),
        equipment_data: Arc::new(RwLock::new(HashMap::new())),
        equipment_positions: Arc::new(RwLock::new(saved_positions)),
        aas_server_url: aas_url.clone(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // 기존 센서 엔드포인트
        .route("/api/data/latest", get(get_latest_data))
        .route("/api/data/ingest", post(ingest_data))
        .route("/api/data/simulate", post(simulate_data))
        .route("/api/health", get(health_check))
        .route("/api/models", get(list_models))
        // 장비 엔드포인트
        .route("/api/equipment/mapping", get(get_equipment_mapping))
        .route("/api/equipment/:id/data", get(get_equipment_data))
        .route("/api/equipment/:id/ingest", post(ingest_equipment_data))
        .route("/api/equipment/status", get(get_equipment_status))
        .route("/api/equipment/positions", get(get_equipment_positions))
        .route("/api/equipment/positions/save", post(save_equipment_positions))
        // PLC 설정 엔드포인트
        .route("/api/plc/configs", get(get_plc_configs))
        .route("/api/plc/configs", post(save_plc_config))
        .route("/api/plc/configs/:id", get(get_plc_config))
        .route("/api/plc/configs/:id", axum::routing::delete(delete_plc_config))
        .route("/api/plc/test", post(test_plc_connection))
        // AAS 연동 엔드포인트 (프록시)
        .route("/api/aas/shells", get(get_aas_shells))
        .route("/api/aas/shells/:id", get(get_aas_shell))
        .route("/api/aas/shells/:id/submodels", get(get_aas_submodels))
        .route("/api/aas/shells/:id/submodels/:sm_id", get(get_aas_submodel))
        .route("/api/aas/shells/:id/submodels/:sm_id/elements", get(get_aas_submodel_elements))
        // 정적 파일 서빙
        .nest_service("/models", ServeDir::new("models"))
        .nest_service("/config", ServeDir::new("config"))
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3050);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    
    println!("🚀 RSpring Viewer v0.2.0 starting at http://0.0.0.0:{}", port);
    println!("📁 Models: models/  Config: config/  Static: static/");
    println!("🔗 AAS Server: {}", aas_url);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ============ AAS 연동 핸들러 ============

async fn get_aas_shells(State(state): State<AppState>) -> impl IntoResponse {
    let client = reqwest::Client::new();
    match client.get(format!("{}/api/aas", state.aas_server_url))
        .timeout(std::time::Duration::from_secs(5))
        .send().await 
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Json(data).into_response(),
            Err(e) => (StatusCode::BAD_GATEWAY, format!("Invalid AAS response: {}", e)).into_response(),
        },
        Err(e) => (StatusCode::BAD_GATEWAY, format!("AAS server unreachable: {}", e)).into_response(),
    }
}

async fn get_aas_shell(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let client = reqwest::Client::new();
    match client.get(format!("{}/shells/{}", state.aas_server_url, id))
        .timeout(std::time::Duration::from_secs(5))
        .send().await 
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Json(data).into_response(),
            Err(_) => (StatusCode::BAD_GATEWAY, "Invalid AAS response").into_response(),
        },
        Err(_) => (StatusCode::BAD_GATEWAY, "AAS server unreachable").into_response(),
    }
}

async fn get_aas_submodels(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let client = reqwest::Client::new();
    match client.get(format!("{}/shells/{}/submodels", state.aas_server_url, id))
        .timeout(std::time::Duration::from_secs(5))
        .send().await 
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Json(data).into_response(),
            Err(_) => (StatusCode::BAD_GATEWAY, "Invalid AAS response").into_response(),
        },
        Err(_) => (StatusCode::BAD_GATEWAY, "AAS server unreachable").into_response(),
    }
}

async fn get_aas_submodel(
    State(state): State<AppState>, 
    Path((id, sm_id)): Path<(String, String)>
) -> impl IntoResponse {
    let client = reqwest::Client::new();
    match client.get(format!("{}/shells/{}/submodels/{}", state.aas_server_url, id, sm_id))
        .timeout(std::time::Duration::from_secs(5))
        .send().await 
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Json(data).into_response(),
            Err(_) => (StatusCode::BAD_GATEWAY, "Invalid AAS response").into_response(),
        },
        Err(_) => (StatusCode::BAD_GATEWAY, "AAS server unreachable").into_response(),
    }
}

async fn get_aas_submodel_elements(
    State(state): State<AppState>, 
    Path((id, sm_id)): Path<(String, String)>
) -> impl IntoResponse {
    let client = reqwest::Client::new();
    match client.get(format!("{}/shells/{}/submodels/{}/submodel-elements", state.aas_server_url, id, sm_id))
        .timeout(std::time::Duration::from_secs(5))
        .send().await 
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Json(data).into_response(),
            Err(_) => (StatusCode::BAD_GATEWAY, "Invalid AAS response").into_response(),
        },
        Err(_) => (StatusCode::BAD_GATEWAY, "AAS server unreachable").into_response(),
    }
}

// ============ 기존 핸들러 ============

async fn get_latest_data(State(state): State<AppState>) -> impl IntoResponse {
    let data = state.sensor_data.read().await;
    Json(json!({
        "data": data.clone(),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn ingest_data(State(state): State<AppState>, Json(payload): Json<IngestPayload>) -> impl IntoResponse {
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
    for id in equipment_ids {
        let sensors = generate_sensor_data(id);
        let alerts = detect_alerts(&sensors);
        equipment_data.insert(id.to_string(), EquipmentData {
            equipment_id: id.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            status: "running".to_string(),
            sensors,
            alerts,
        });
    }
    Json(json!({"status": "success", "timestamp": Utc::now().to_rfc3339()}))
}

async fn get_equipment_mapping() -> impl IntoResponse {
    match tokio::fs::read_to_string("config/equipment_mapping.json").await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(json) => Json(json).into_response(),
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Invalid JSON").into_response(),
        },
        Err(_) => Json(json!({"equipment": []})).into_response(),
    }
}

async fn get_equipment_data(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let equipment_data = state.equipment_data.read().await;
    match equipment_data.get(&id) {
        Some(data) => Json(data.clone()).into_response(),
        None => (StatusCode::NOT_FOUND, "Equipment not found").into_response(),
    }
}

async fn ingest_equipment_data(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<EquipmentIngestPayload>) -> impl IntoResponse {
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
    let equipment: Vec<_> = equipment_data.iter().map(|(id, data)| EquipmentStatusEntry {
        id: id.clone(),
        status: data.status.clone(),
        sensor_count: data.sensors.len(),
        alert_count: data.alerts.len(),
    }).collect();
    Json(EquipmentStatusOverview { equipment, timestamp: Utc::now().to_rfc3339() })
}

async fn get_equipment_positions(State(state): State<AppState>) -> impl IntoResponse {
    let positions = state.equipment_positions.read().await;
    Json(json!(*positions))
}

async fn save_equipment_positions(State(state): State<AppState>, Json(data): Json<HashMap<String, PositionOffset>>) -> impl IntoResponse {
    *state.equipment_positions.write().await = data.clone();
    let _ = std::fs::create_dir_all("config");
    let _ = std::fs::write("config/equipment_positions.json", serde_json::to_string_pretty(&data).unwrap_or_default());
    println!("💾 Equipment positions saved: {} entries", data.len());
    Json(json!({"saved": data.len()}))
}

fn generate_sensor_data(equipment_id: &str) -> HashMap<String, f64> {
    let mut sensors = HashMap::new();
    let r = rand_f64();
    match equipment_id {
        "ROBOT_01" | "ROBOT_02" => {
            sensors.insert("speed_rpm".to_string(), 1200.0 + r * 100.0);
            sensors.insert("temperature".to_string(), 65.0 + r * 15.0);
            sensors.insert("torque".to_string(), 45.0 + r * 20.0);
        }
        "DRILL_TAP" => {
            sensors.insert("spindle_rpm".to_string(), 2000.0 + r * 300.0);
            sensors.insert("temperature".to_string(), 72.0 + r * 18.0);
            sensors.insert("vibration".to_string(), 2.5 + r * 1.0);
        }
        "CONVEYOR_01" | "CONVEYOR_02" | "SPRING_CONVEYOR" | "YOKE_CONVEYOR" => {
            sensors.insert("speed".to_string(), 0.8 + r * 0.3);
            sensors.insert("motor_current".to_string(), 12.0 + r * 5.0);
        }
        "GANTRY" => {
            sensors.insert("x_position".to_string(), 100.0 + r * 50.0);
            sensors.insert("y_position".to_string(), 150.0 + r * 50.0);
            sensors.insert("z_position".to_string(), 80.0 + r * 30.0);
        }
        _ => {
            sensors.insert("value".to_string(), r * 100.0);
        }
    }
    sensors
}

fn detect_alerts(sensors: &HashMap<String, f64>) -> Vec<Alert> {
    let mut alerts = Vec::new();
    if let Some(&t) = sensors.get("temperature") {
        if t > 85.0 {
            alerts.push(Alert {
                level: "warning".to_string(),
                sensor: "temperature".to_string(),
                value: t,
                threshold: 85.0,
                message: format!("Temperature exceeded: {:.1}°C", t),
            });
        }
    }
    if let Some(&v) = sensors.get("vibration") {
        if v > 4.0 {
            alerts.push(Alert {
                level: "critical".to_string(),
                sensor: "vibration".to_string(),
                value: v,
                threshold: 4.0,
                message: format!("High vibration: {:.2}", v),
            });
        }
    }
    alerts
}

fn rand_f64() -> f64 {
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    ((ts % 1000) as f64) / 1000.0
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
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir("models") {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if matches!(ext.as_str(), "glb" | "gltf") {
                if let Ok(meta) = entry.metadata() {
                    models.push(json!({
                        "name": path.file_name().unwrap_or_default().to_string_lossy(),
                        "file_path": format!("/models/{}", path.file_name().unwrap_or_default().to_string_lossy()),
                        "file_size": meta.len()
                    }));
                }
            }
        }
    }
    Json(json!({"models": models}))
}

// ============ PLC 설정 관리 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlcConfig {
    pub equipment_id: String,
    pub plc: PlcConnectionConfig,
    pub aas: AasConfig,
    #[serde(default)]
    pub mappings: Vec<PlcMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlcConnectionConfig {
    pub ip: String,
    pub port: u16,
    #[serde(default)]
    pub network: u8,
    #[serde(default = "default_pc")]
    pub pc: u8,
    #[serde(default = "default_interval")]
    pub interval_ms: u64,
}

fn default_pc() -> u8 { 255 }
fn default_interval() -> u64 { 1000 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AasConfig {
    pub server: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlcMapping {
    pub device: String,
    pub aas_submodel: String,
    pub aas_property: String,
    #[serde(default = "default_data_type")]
    pub data_type: String,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub offset: f64,
    #[serde(default = "default_count")]
    pub count: u16,
}

fn default_data_type() -> String { "int16".to_string() }
fn default_scale() -> f64 { 1.0 }
fn default_count() -> u16 { 1 }

// PLC 설정 목록 조회
async fn get_plc_configs() -> impl IntoResponse {
    let config_dir = std::path::Path::new("config/plc");
    let mut configs = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(config) = serde_json::from_str::<PlcConfig>(&content) {
                        configs.push(config);
                    }
                }
            }
        }
    }
    
    Json(configs)
}

// 특정 PLC 설정 조회
async fn get_plc_config(Path(id): Path<String>) -> impl IntoResponse {
    let path = format!("config/plc/{}.json", id);
    
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<PlcConfig>(&content) {
                Ok(config) => (StatusCode::OK, Json(json!(config))),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))),
            }
        }
        Err(_) => (StatusCode::NOT_FOUND, Json(json!({"error": "Config not found"}))),
    }
}

// PLC 설정 저장
async fn save_plc_config(Json(config): Json<PlcConfig>) -> impl IntoResponse {
    let _ = std::fs::create_dir_all("config/plc");
    let path = format!("config/plc/{}.json", config.equipment_id);
    
    match std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap_or_default()) {
        Ok(_) => {
            // TOML 파일도 생성
            let toml_path = format!("config/plc/{}.toml", config.equipment_id);
            let toml_content = generate_toml(&config);
            let _ = std::fs::write(&toml_path, toml_content);
            
            println!("💾 PLC config saved: {}", config.equipment_id);
            (StatusCode::OK, Json(json!({"success": true, "equipment_id": config.equipment_id})))
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()})))
        }
    }
}

// PLC 설정 삭제
async fn delete_plc_config(Path(id): Path<String>) -> impl IntoResponse {
    let json_path = format!("config/plc/{}.json", id);
    let toml_path = format!("config/plc/{}.toml", id);
    
    let json_deleted = std::fs::remove_file(&json_path).is_ok();
    let _ = std::fs::remove_file(&toml_path);
    
    if json_deleted {
        println!("🗑️ PLC config deleted: {}", id);
        Json(json!({"success": true}))
    } else {
        Json(json!({"error": "Config not found"}))
    }
}

// PLC 연결 테스트
async fn test_plc_connection(Json(plc): Json<PlcConnectionConfig>) -> impl IntoResponse {
    use std::net::TcpStream;
    use std::time::Duration;
    
    let addr = format!("{}:{}", plc.ip, plc.port);
    
    match TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap()),
        Duration::from_secs(3)
    ) {
        Ok(_) => {
            println!("✅ PLC connection test success: {}", addr);
            Json(json!({"success": true, "message": "Connection successful"}))
        }
        Err(e) => {
            println!("❌ PLC connection test failed: {} - {}", addr, e);
            Json(json!({"success": false, "error": e.to_string()}))
        }
    }
}

// TOML 생성
fn generate_toml(config: &PlcConfig) -> String {
    let mut toml = format!(r#"# PLC → AAS Bridge 설정
# 장비: {}

[plc]
ip = "{}"
port = {}
network = {}
pc = {}
interval_ms = {}

[aas]
server = "{}"

"#, 
        config.equipment_id,
        config.plc.ip,
        config.plc.port,
        config.plc.network,
        config.plc.pc,
        config.plc.interval_ms,
        config.aas.server
    );

    for m in &config.mappings {
        toml.push_str(&format!(r#"[[mappings]]
device = "{}"
aas_submodel = "{}"
aas_property = "{}"
data_type = "{}"
scale = {}
offset = {}
{}

"#,
            m.device,
            m.aas_submodel,
            m.aas_property,
            m.data_type,
            m.scale,
            m.offset,
            if m.count > 1 { format!("count = {}", m.count) } else { String::new() }
        ));
    }

    toml
}
