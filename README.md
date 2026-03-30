# Omniverse AAS Integration

NVIDIA Omniverse ↔ Asset Administration Shell 양방향 연동

## 구성요소

### 1. Kit Extension (`extension/`)

Omniverse 내에서 AAS 데이터를 표시하는 UI 패널

**기능:**
- USD prim 선택 시 AAS 정보 자동 조회
- Submodel/SubmodelElement 표시
- AAS 서버 연결 설정

**설치:**
```bash
# Omniverse Kit 확장 폴더에 복사
cp -r extension/omni ~/.local/share/ov/pkg/[kit-version]/exts/
# 또는 extension.toml에서 경로 지정
```

**사용:**
1. Omniverse에서 Window → Digital Twin → AAS Panel
2. AAS Server URL 설정 (기본: http://localhost:8080)
3. USD prim 선택 → AAS 정보 자동 표시

### 2. Nucleus Connector (`connector/`)

USD 파일과 AAS 서버 간 실시간 동기화

**기능:**
- USD 파일 변경 감지 → AAS 메타데이터 업데이트
- AAS 데이터 변경 → USD 커스텀 속성 업데이트
- PLC/센서 데이터 실시간 동기화

**빌드:**
```bash
cd connector
cargo build --release
```

**실행:**
```bash
# 기본 설정
./target/release/nucleus-aas-connector

# 옵션
./target/release/nucleus-aas-connector \
  --aas-server http://localhost:8080 \
  --nucleus-server omniverse://localhost \
  --watch-path /path/to/usd/files \
  --interval 5 \
  --bidirectional
```

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    NVIDIA Omniverse                         │
│  ┌─────────────┐    ┌─────────────────────────────────────┐ │
│  │ Kit Extension│    │              USD Stage              │ │
│  │  (AAS Panel) │←──→│  ┌─────────┐  ┌─────────┐         │ │
│  └─────────────┘    │  │ROBOT_01 │  │CONVEYOR │  ...     │ │
│                      │  │aas:id   │  │aas:id   │         │ │
│                      │  └─────────┘  └─────────┘         │ │
│                      └─────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Nucleus Connector     │
                    │  (Rust - 양방향 동기화)  │
                    └────────────┬────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────┐
│                      AAS Server                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                     │
│  │ROBOT_01 │  │CONVEYOR │  │DRILL_TAP│  ...                │
│  ├─────────┤  ├─────────┤  ├─────────┤                     │
│  │Nameplate│  │Nameplate│  │Nameplate│                     │
│  │OpData   │  │OpData   │  │OpData   │                     │
│  │Maint    │  │Maint    │  │Maint    │                     │
│  └─────────┘  └─────────┘  └─────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

## USD 커스텀 속성

장비 prim에 추가되는 AAS 관련 속성:

```usda
def Xform "ROBOT_01" {
    # AAS 연결 정보
    custom string aas:id = "rspring-robot-01"
    custom string aas:equipmentId = "ROBOT_01"
    
    # 실시간 센서 데이터 (Connector가 업데이트)
    custom double sensor:Temperature = 65.0
    custom int sensor:SpeedRPM = 1200
    custom double sensor:Torque = 45.0
}
```

## SimReady 통합

SimReady 스펙 준수를 위한 추가 속성:

```usda
def Xform "ROBOT_01" (
    prepend apiSchemas = ["PhysicsRigidBodyAPI", "SemanticLabelAPI"]
) {
    # SimReady 시맨틱 라벨
    custom string semantic:label = "industrial_robot"
    
    # AAS 연결
    custom string aas:id = "rspring-robot-01"
}
```

## 환경 변수

```bash
# AAS 서버
AAS_SERVER_URL=http://localhost:8080

# Nucleus 서버
NUCLEUS_SERVER=omniverse://localhost

# 로그 레벨
RUST_LOG=nucleus_aas_connector=debug
```

## 의존성

### Kit Extension
- Omniverse Kit 105.0+
- Python 3.10+

### Nucleus Connector
- Rust 1.70+
- OpenUSD (USD SDK) - 선택사항, 고급 기능용

## 라이선스

MIT
