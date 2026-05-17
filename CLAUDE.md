# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-binary Rust/Axum web service that serves a Three.js 3D viewer of 현대정밀's RSpring assembly line, consumes PLC data from per-line Kafka topics, proxies a sibling AAS (Asset Administration Shell) server, and manages MELSEC-PLC bridge configurations. Default port is **3050**; the AAS server it proxies defaults to `http://localhost:8080` (`AAS_SERVER_URL`); Kafka topics are synthesized as `{KAFKA_TOPIC_PREFIX}-{line}` for each line in `KAFKA_LINES` (defaults: prefix `melsec-plc-data`, lines `1,2`, brokers `localhost:9092`, group `rspring-viewer`).

UI strings, log messages, and code comments are in **Korean** — keep them Korean when editing.

## Build & run

```bash
cargo run                                    # debug, listens on :3050
cargo build --release && ./target/release/rspring-viewer
PORT=3060 AAS_SERVER_URL=http://host:8080 KAFKA_BROKERS=10.0.0.5:9092 cargo run
docker build -t rspring-viewer . && docker run -p 3050:3050 rspring-viewer
```

`rdkafka` is statically linked via the bundled `librdkafka` build, so the host needs `cmake`, `build-essential`, `pkg-config`, `libssl-dev`, `libsasl2-dev`, `zlib1g-dev` installed — the Dockerfile already does this; bare-metal build hosts must too.

There is no Rust test suite. There is no JS bundler — `static/` is served as-is and Three.js r128 is pulled from CDN at runtime.

`models/RSpring_opt.glb` (~70 MB) is the production asset and is **gitignored** (`models/*.glb`); it must be present at runtime or the viewer loads nothing. Don't accidentally commit the bare `models/RSpring.glb` either.

## Architecture

**Backend is a single file: `src/main.rs`.** Routes, handlers, state struct, PLC TOML serializer, and the Kafka consumer all live there. State is purely in-memory (`Arc<RwLock<...>>`) — there is no database. Restarts wipe sensor/equipment data; only files written under `config/` survive.

Three on-disk persistence sites the server writes:
- `config/equipment_positions.json` — viewer drag-to-move offsets, loaded at startup, rewritten by `POST /api/equipment/positions/save`.
- `config/plc/{equipment_id}.json` — canonical PLC bridge config (read on every list).
- `config/plc/{equipment_id}.toml` — generated **alongside** the JSON every save, by `generate_toml()` in `main.rs`. Intended to be readable by an external MELSEC bridge (no in-tree consumer reads it today); if you add/rename fields on `PlcMapping`, update `generate_toml()` in lockstep so the JSON and TOML stay in sync.

**`PlcConfig` / `PlcMapping` schema** (`src/main.rs`): top-level `line: u8` (default `1`) decides which Kafka topic this equipment listens on. `mapping.device` is the PLC address (e.g. `D1016`); `mapping.sensor_name` is the viewer's equipment-data slot key — when set, the Kafka consumer routes `(line, device) → sensors[sensor_name]`, scaled by `scale`/`offset`. `aas_submodel`/`aas_property` are independent and used by external AAS bridges only. All non-`equipment_id`/`plc`/`aas` fields default so older configs (pre-`line`, pre-`sensor_name`) deserialize cleanly and are upgraded on next save.

**PLC data path (Kafka → equipment_data):**
- One `tokio::spawn`'d consumer in `run_kafka_consumer()` subscribes to **all** `{KAFKA_TOPIC_PREFIX}-{line}` topics (lines from `KAFKA_LINES`, comma-separated, default `1,2`). Messages are parsed as `RawPlcMessage { timestamp, word_data: [{address, value, ...}] }`; anything else (e.g. RSpring/'s mock `PlcData { line1, line2 }` payload) is silently skipped.
- The line number is derived per-message from the **topic suffix** — `melsec-plc-data-2` → line `2`. Configs without a matching `line` simply aren't routed.
- Each `WordData` is looked up in `AppState.address_map` (`HashMap<(line, address), MappingEntry>`), built at startup by `build_address_map()` scanning `config/plc/*.json`. Every `PlcMapping` with a non-empty `sensor_name` is indexed at key `(cfg.line, mapping.device)`. The map is **rebuilt in-place** whenever `save_plc_config` / `delete_plc_config` runs, so UI edits take effect without restart.
- Matched words are batched per equipment and applied via `apply_raw_plc(line, raw)`: `value * scale + offset` written into `equipment_data[equipment_id].sensors[sensor_name]`, then `detect_alerts()` re-runs against the merged sensor map.
- Same PLC address can appear on multiple lines with different meanings — the `(line, address)` key keeps them isolated. Equipment-to-line assignment is **free**: any equipment can be put on any line via the settings UI; nothing is hardcoded.
- Connection failure at startup logs a warning and disables the consumer task; the rest of the service still runs. No automatic reconnect — restart the service if Kafka comes up later.

**Route groups** (all under `/api/`):
- `data/*`, `equipment/*` — sensor + equipment ingest/query, plus `simulate` which fakes data for the 15 hardcoded equipment IDs listed in `simulate_data()`.
- `plc/configs[/:id]`, `plc/test` — CRUD for PLC bridge configs; `test` does a raw 3-second TCP connect, no MELSEC handshake.
- `aas/shells/...` — **thin proxy** to `AAS_SERVER_URL`. These handlers don't transform anything; they forward and surface upstream as 502 on failure. If you need a new AAS endpoint, add a proxy handler here, don't have the frontend hit the AAS server directly (CORS + URL coupling).

**Frontend** (`static/`):
- `index.html` + `js/viewer.js` (~1650 lines) — Three.js r128 scene. Polls `/api/data/latest` and `/api/equipment/status`. Equipment is matched to GLB mesh subtrees by `equipment_groups[usd_path]`, loaded from `config/equipment_mapping.json` via `GET /api/equipment/mapping`.
- `js/aas-integration.js` — matches selected equipment to an AAS shell by fuzzy `id_short` substring (both directions), then renders submodels in the overlay.
- `settings.html` + `js/plc-settings.js` — PLC config CRUD UI.
- `css/style.css` — viewport uses CSS grid (`280px 1fr 320px`). Resizing the right/left sidebars requires touching the grid template.

**Equipment ID conventions** — there are three places the 15-machine list lives in sync:
1. `simulate_data()` in `src/main.rs` (the synthetic-data generator).
2. `scripts/register_aas.sh` (the AAS bootstrap).
3. `config/equipment_mapping.json` (the USD-path → equipment-id map the viewer uses).

Adding/removing an equipment requires editing all three. The AAS shell ID convention is `rspring-{id-lowercased-with-underscores-as-dashes}` (see `register_equipment` in the script).

## Model conversion pipeline

GLB is the runtime format; CAD originals are converted offline. Two paths exist:

- **STEP → GLB**: `node convert.mjs <input.stp> <output.glb>` — uses `occt-import-js` (OpenCASCADE WASM). Slow (1–2 min for big assemblies). Each STEP part becomes a separate node/mesh, named from the STEP part name.
- **USD → GLB**: `python3.11 usd2glb.py <input.usd> <output.glb>` — requires `pxr` (USD Python bindings) and `numpy`. **Critical**: it names meshes as `{equipment_group}::{mesh_name}`; the viewer splits on `::` to group meshes per equipment. If you write a new converter, preserve this naming or the per-equipment selection/coloring breaks.
- **Optimize**: `node optimize.mjs` (hardcoded `models/RSpring.glb` → `models/RSpring_opt.glb`) — runs gltf-transform `dedup → weld(0.001) → quantize → draco`. Re-run after any conversion.

`npm install` is needed once to pull the gltf-transform / occt-import / draco3dgltf deps.

## AAS bootstrap

`scripts/register_aas.sh` registers all 15 equipment as AAS shells with three submodels each (Nameplate, OperationalData, Maintenance) on the AAS server at `$AAS_SERVER` (default `http://localhost:8080`). It posts ~10 curl calls per equipment and is **idempotent-ish at the shell level only** (a re-run will fail shell creation but happily re-create submodels/elements as duplicates). Run it once after the AAS server boots.

## Cross-repo coupling

- **`RSpring/`** (sibling repo) is the MELSEC PLC data collector. It reads the TOML files this service writes under `config/plc/`. Schema drift breaks the bridge — keep `PlcConfig`/`generate_toml()` and RSpring's loader in sync.
- **AAS server** at `AAS_SERVER_URL` is owned by `AAS/` — see that workspace's `CLAUDE.md`. This service has no AAS persistence; everything flows through the proxy.
- The 15 equipment IDs and the `rspring-*` AAS naming convention are shared across this service, the bash registration script, and `RSpring/`'s producer. Renaming an equipment ripples.
