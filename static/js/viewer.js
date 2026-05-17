// =============================================================================
// RSPRING VIEWER - Three.js r128 Compatible 3D Visualization
// =============================================================================

// Global state
let scene, camera, renderer, controls;
let modelGroup = null;
let gridHelper = null;
let meshes = [];
let wireframeMode = false;
let explodeMode = false;
let simulationActive = false;
let clock;
let equipmentMapping = null;
let equipmentGroups = {};  // { usd_path: [mesh1, mesh2, ...] }
let equipmentLineMap = {}; // { equipment_id: line_number } — PLC 설정에서 가져온 라인 할당
let selectedEquipment = null;
let pollingInterval = null;
let sensorHistory = {};
let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 0;

// Equipment type colors
const TYPE_COLORS = {
    'robot': 0xff6644,
    'machine': 0x44aaff,
    'conveyor': 0x00ff88,
    'assembly': 0xcc44ff,
    'workstation': 0xffaa00,
    'gantry': 0x00d4ff,
    'control': 0x888888
};

// Store original mesh properties for state restoration
let meshOriginalState = new Map();
let modelCenter = new THREE.Vector3();
let modelRadius = 0;

// Equipment move mode
let transformControls = null;
let moveMode = false;
let equipmentPivots = {};  // { groupName: THREE.Group (pivot) }
let equipmentOffsets = {}; // { groupName: {x,y,z} } saved positions

// =============================================================================
// INITIALIZATION
// =============================================================================

function init() {
    updateLoading('Three.js 초기화 중...');
    const canvas = document.getElementById('three-canvas');
    const viewport = document.getElementById('viewport');
    
    if (!canvas || !viewport) {
        console.error('Required DOM elements not found');
        return;
    }
    
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d1a);
    
    // Camera setup - use viewport dimensions, not window
    const aspect = viewport.clientWidth / viewport.clientHeight;
    camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 100000);
    camera.position.set(15, 10, 15);
    
    // Renderer setup - r128 compatible
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas, 
        antialias: true, 
        powerPreference: 'high-performance' 
    });
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputEncoding = THREE.sRGBEncoding;  // r128 compatible (not LinearSRGBColorSpace)
    
    // Get renderer info
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
        const rendererName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        document.getElementById('footer-renderer').textContent = 'Renderer: ' + rendererName;
    }
    
    // OrbitControls - loaded via CDN
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.1;
    controls.maxDistance = 100000;
    controls.screenSpacePanning = true;
    
    // Initialize model group container
    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    
    setupLighting();
    setupHelpers();
    
    // TransformControls for equipment drag-move
    transformControls = new THREE.TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSize(0.8);
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value; // disable orbit while dragging
    });
    transformControls.addEventListener('objectChange', onEquipmentMoved);
    scene.add(transformControls);
    transformControls.visible = false;
    transformControls.enabled = false;
    
    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', onViewportClick);
    
    loadModelList();
    setConnectionStatus('active', '서버 연결됨');
    animate();
}

// =============================================================================
// LIGHTING & HELPERS
// =============================================================================

function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    // Directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    dirLight.castShadow = false;
    scene.add(dirLight);
    
    // Secondary light for fill
    const fillLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    fillLight.position.set(-10, 5, -10);
    scene.add(fillLight);
}

function setupHelpers() {
    // Grid helper
    gridHelper = new THREE.GridHelper(50, 50, 0x333344, 0x1a1a2e);
    gridHelper.position.y = 0;
    scene.add(gridHelper);
    
    // Axes helper with labels
    createLabeledAxes(8);
}

// Create labeled axes with RGB colors (X=Red, Y=Green, Z=Blue)
function createLabeledAxes(size) {
    const axesGroup = new THREE.Group();
    axesGroup.name = 'axesHelper';
    
    // Axis colors: X=Red, Y=Green, Z=Blue (RGB order)
    const colors = {
        x: 0xff0000,  // Red
        y: 0x00ff00,  // Green
        z: 0x0000ff   // Blue
    };
    
    // Create axis lines
    const createAxisLine = (dir, color) => {
        const material = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(dir.x * size, dir.y * size, dir.z * size)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    };
    
    // X axis (Red)
    axesGroup.add(createAxisLine({x: 1, y: 0, z: 0}, colors.x));
    // Y axis (Green)
    axesGroup.add(createAxisLine({x: 0, y: 1, z: 0}, colors.y));
    // Z axis (Blue)
    axesGroup.add(createAxisLine({x: 0, y: 0, z: 1}, colors.z));
    
    // Create arrow cones
    const createArrowCone = (position, rotation, color) => {
        const coneGeom = new THREE.ConeGeometry(0.15, 0.5, 8);
        const coneMat = new THREE.MeshBasicMaterial({ color: color });
        const cone = new THREE.Mesh(coneGeom, coneMat);
        cone.position.copy(position);
        cone.rotation.set(rotation.x, rotation.y, rotation.z);
        return cone;
    };
    
    // Arrow cones at axis ends
    axesGroup.add(createArrowCone(
        new THREE.Vector3(size, 0, 0), 
        {x: 0, y: 0, z: -Math.PI/2}, 
        colors.x
    ));
    axesGroup.add(createArrowCone(
        new THREE.Vector3(0, size, 0), 
        {x: 0, y: 0, z: 0}, 
        colors.y
    ));
    axesGroup.add(createArrowCone(
        new THREE.Vector3(0, 0, size), 
        {x: Math.PI/2, y: 0, z: 0}, 
        colors.z
    ));
    
    // Create text labels using sprites
    const createLabel = (text, position, color) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 64;
        canvas.height = 64;
        
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.font = 'bold 48px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ 
            map: texture, 
            transparent: true,
            depthTest: false
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.copy(position);
        sprite.scale.set(1.5, 1.5, 1);
        return sprite;
    };
    
    // Add labels
    axesGroup.add(createLabel('X', new THREE.Vector3(size + 1, 0, 0), colors.x));
    axesGroup.add(createLabel('Y', new THREE.Vector3(0, size + 1, 0), colors.y));
    axesGroup.add(createLabel('Z', new THREE.Vector3(0, 0, size + 1), colors.z));
    
    // Position in corner of scene
    axesGroup.position.set(-20, 0, -20);
    scene.add(axesGroup);
    
    console.log('✅ Labeled axes created (X=Red, Y=Green, Z=Blue)');
}

// =============================================================================
// WINDOW & CANVAS RESIZE
// =============================================================================

function onResize() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

// =============================================================================
// MODEL LOADING
// =============================================================================

function updateLoading(text) {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = text;
}

function setLoadingProgress(percent) {
    const progressBar = document.getElementById('loading-progress');
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function loadModelList() {
    updateLoading('모델 목록 가져오는 중...');
    
    fetch('/api/models')
        .then(res => res.json())
        .then(data => {
            const modelList = document.getElementById('model-list');
            modelList.innerHTML = '';
            
            // API returns { models: [...] }
            const models = data.models || data;
            
            // Prefer _opt.glb files
            const sortedModels = models.sort((a, b) => {
                const aIsOpt = (a.file || a.name || '').includes('_opt');
                const bIsOpt = (b.file || b.name || '').includes('_opt');
                return aIsOpt === bIsOpt ? 0 : aIsOpt ? -1 : 1;
            });
            
            sortedModels.forEach(model => {
                const li = document.createElement('li');
                li.textContent = model.name;
                li.onclick = () => loadGLBModel(model);
                modelList.appendChild(li);
            });
            
            // Auto-load first model
            if (sortedModels.length > 0) {
                loadGLBModel(sortedModels[0]);
            }
        })
        .catch(err => {
            console.error('Error loading model list:', err);
            updateLoading('모델 목록 로드 실패');
        });
}

function loadGLBModel(model) {
    updateLoading(`${model.name} 로드 중...`);
    setLoadingProgress(0);
    
    // Clear old model
    while (modelGroup.children.length > 0) {
        modelGroup.remove(modelGroup.children[0]);
    }
    meshes = [];
    equipmentGroups = {};
    meshOriginalState.clear();
    selectedEquipment = null;
    
    // Setup loaders
    const loader = new THREE.GLTFLoader();
    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
    
    // Use callback-based load (r128 compatible - NOT loadAsync)
    loader.load(
        model.file_path || `/models/${model.file || model.name}`,
        (gltf) => {
            // Load successful
            const modelScene = gltf.scene;
            modelGroup.add(modelScene);
            
            // Extract and configure meshes
            modelScene.traverse((node) => {
                if (node instanceof THREE.Mesh) {
                    meshes.push(node);
                    
                    // Store original state
                    meshOriginalState.set(node, {
                        material: node.material.clone(),
                        originalColor: node.material.color.getHex(),
                        originalEmissive: node.material.emissive.getHex(),
                        originalOpacity: node.material.opacity
                    });
                    
                    // Configure material
                    node.material = new THREE.MeshPhongMaterial({
                        color: node.material.color.getHex(),
                        side: THREE.DoubleSide,
                        wireframe: false
                    });
                    
                    // Store original position for explode
                    node.userData.originalPosition = node.position.clone();
                }
            });
            
            // Calculate bounding box and center model
            const box = new THREE.Box3().setFromObject(modelGroup);
            modelCenter = box.getCenter(new THREE.Vector3());
            modelRadius = box.getSize(new THREE.Vector3()).length() / 2;
            
            // Position model to origin
            modelGroup.position.set(-modelCenter.x, -box.min.y, -box.min.z);
            
            // Update grid
            const gridSize = Math.max(modelRadius * 2, 50);
            scene.remove(gridHelper);
            gridHelper = new THREE.GridHelper(gridSize, 50, 0x333344, 0x1a1a2e);
            scene.add(gridHelper);
            
            // Load equipment mapping FIRST, then group meshes by prefix
            loadEquipmentMapping()
                .then(() => {
                    groupMeshesByEquipment();
                    updateLoading('모델 최적화 중...');
                    fitAll();
                    hideLoadingOverlay();
                    updateStats();
                    loadSavedPositions();
                })
                .catch(err => {
                    console.error('Error loading equipment mapping:', err);
                    groupMeshesByEquipment(); // fallback without mapping
                    fitAll();
                    hideLoadingOverlay();
                    updateStats();
                });
        },
        (progressEvent) => {
            // Progress callback
            if (progressEvent.lengthComputable) {
                const percentComplete = (progressEvent.loaded / progressEvent.total) * 100;
                setLoadingProgress(percentComplete);
            }
        },
        (error) => {
            // Error callback
            console.error('Error loading model:', error);
            updateLoading('모델 로드 실패: ' + error.message);
        }
    );
}

// Equipment group prefix cache (built from mapping)
let equipmentPrefixes = []; // [{prefix, usd_path}, ...] sorted longest-first

function buildEquipmentPrefixes() {
    equipmentPrefixes = [];
    if (equipmentMapping && equipmentMapping.equipment) {
        equipmentMapping.equipment.forEach(equip => {
            equipmentPrefixes.push({
                prefix: equip.usd_path,
                usd_path: equip.usd_path
            });
        });
        // Sort longest prefix first for greedy matching
        equipmentPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);
    }
}

function getEquipmentGroupName(mesh) {
    const name = mesh.name || '';
    
    // GLTFLoader strips :: from names, so match by prefix
    for (const ep of equipmentPrefixes) {
        if (name.startsWith(ep.prefix)) {
            return ep.usd_path;
        }
    }
    return '_ungrouped';
}

function groupMeshesByEquipment() {
    equipmentGroups = {};
    equipmentPivots = {};
    
    buildEquipmentPrefixes();
    
    if (equipmentPrefixes.length > 0) {
    }
    if (meshes.length > 0) {
    }
    
    meshes.forEach(mesh => {
        let groupName = getEquipmentGroupName(mesh);
        
        if (!equipmentGroups[groupName]) {
            equipmentGroups[groupName] = [];
        }
        
        equipmentGroups[groupName].push(mesh);
    });
    
    // Create pivot objects for each equipment group (for TransformControls)
    Object.keys(equipmentGroups).forEach(groupName => {
        const groupMeshes = equipmentGroups[groupName];
        
        // Calculate group bounding box center
        const box = new THREE.Box3();
        groupMeshes.forEach(m => box.expandByObject(m));
        const center = box.getCenter(new THREE.Vector3());
        
        // Create pivot Group at the center
        const pivot = new THREE.Group();
        pivot.position.copy(center);
        pivot.userData.equipmentGroup = groupName;
        pivot.userData.originalPosition = center.clone();
        pivot.userData.meshOffsets = [];
        
        // Store each mesh's offset relative to pivot center
        groupMeshes.forEach(m => {
            const worldPos = new THREE.Vector3();
            m.getWorldPosition(worldPos);
            pivot.userData.meshOffsets.push({
                mesh: m,
                offset: worldPos.clone().sub(center)
            });
        });
        
        scene.add(pivot);
        equipmentPivots[groupName] = pivot;
    });
    
    console.log('Equipment groups:', Object.keys(equipmentGroups).length, 'pivots created');
    
    // Robot FK setup for ROBOT_02 (270F) which has explicit joint naming
    setupRobotFK();
    
    // 기본 상태에서 장비 타입별 색상 적용
    applyDefaultTypeColors();
}

function applyDefaultTypeColors() {
    if (!equipmentMapping || !equipmentMapping.equipment) return;
    
    // Build a map: usd_path → type
    const typeMap = {};
    equipmentMapping.equipment.forEach(equip => {
        typeMap[equip.usd_path] = equip.type;
    });
    
    Object.keys(equipmentGroups).forEach(groupName => {
        const type = typeMap[groupName];
        if (!type) return; // _ungrouped 등은 스킵
        
        const baseColor = TYPE_COLORS[type] || 0x888888;
        const groupMeshes = equipmentGroups[groupName];
        
        groupMeshes.forEach(mesh => {
            if (!mesh.material) return;
            mesh.material.color.setHex(baseColor);
            mesh.material.emissive.setHex(baseColor);
            mesh.material.emissiveIntensity = 0.15;
            mesh.material.needsUpdate = true;
            
            // meshOriginalState도 업데이트해서 선택 해제 시 타입 색상으로 복원
            const orig = meshOriginalState.get(mesh);
            if (orig) {
                orig.originalColor = baseColor;
            }
        });
    });
}

function loadEquipmentMapping() {
    return Promise.all([
        fetch('/api/equipment/mapping').then(res => res.json()).catch(() => ({ equipment: [] })),
        fetch('/api/plc/configs').then(res => res.json()).catch(() => [])
    ]).then(([mapping, plcConfigs]) => {
        equipmentMapping = mapping;

        // PLC 설정의 line을 장비 ID 별로 인덱싱
        equipmentLineMap = {};
        (plcConfigs || []).forEach(c => {
            if (c.equipment_id) equipmentLineMap[c.equipment_id] = c.line ?? 1;
        });

        populateEquipmentList();

        const ecEl = document.getElementById('equipment-count') || document.getElementById('equip-count');
        if (ecEl) ecEl.textContent = '(' + (mapping.equipment || []).length + ')';
        const vecEl = document.getElementById('val-equip-count');
        if (vecEl) vecEl.textContent = (mapping.equipment || []).length;

        return mapping;
    });
}

function populateEquipmentList() {
    const equipmentList = document.getElementById('equipment-list');
    equipmentList.innerHTML = '';

    if (!equipmentMapping || !equipmentMapping.equipment) return;

    // 장비를 라인별로 그룹핑. 매핑 없는 장비는 0(미지정)으로.
    const byLine = new Map();
    equipmentMapping.equipment.forEach(equip => {
        const line = equipmentLineMap[equip.id] ?? 0;
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(equip);
    });

    // 정렬: 미지정(0)은 가장 아래
    const lineKeys = [...byLine.keys()].sort((a, b) => {
        if (a === 0) return 1;
        if (b === 0) return -1;
        return a - b;
    });

    lineKeys.forEach(line => {
        const items = byLine.get(line);

        // 섹션 헤더
        const header = document.createElement('div');
        header.className = 'line-section-header';
        const labelText = line === 0 ? '미지정' : `LINE ${String(line).padStart(2, '0')}`;
        const badgeText = line === 0 ? '–' : String(line).padStart(2, '0');
        header.innerHTML = `
            <span class="line-badge${line === 0 ? ' line-badge-muted' : ''}">${badgeText}</span>
            <span class="line-label">${labelText}</span>
            <span class="line-count">${items.length}</span>
        `;
        equipmentList.appendChild(header);

        // 항목들
        items.forEach(equip => {
            const div = document.createElement('div');
            div.className = 'equipment-item';
            div.dataset.equipId = equip.id;

            const meshCount = equipmentGroups[equip.usd_path]
                ? equipmentGroups[equip.usd_path].length
                : 0;

            const typeColor = TYPE_COLORS[equip.type] || 0x888888;
            const colorHex = '#' + typeColor.toString(16).padStart(6, '0');

            div.innerHTML = `
                <span class="equip-dot" style="background-color: ${colorHex};"></span>
                <span class="equip-name">${equip.name}</span>
                <span class="equip-count">${meshCount}</span>
            `;

            div.onclick = () => selectEquipment(equip);
            equipmentList.appendChild(div);
        });
    });
}

// =============================================================================
// EQUIPMENT SELECTION
// =============================================================================

// Selection highlight colors per equipment type
const SELECT_COLORS = {
    'robot':       { color: 0xffcc00, emissive: 0xaa8800, moveColor: 0xffdd44, moveEmissive: 0xbbaa00 },
    'machine':     { color: 0x44aaff, emissive: 0x225588, moveColor: 0x66ccff, moveEmissive: 0x3388aa },
    'conveyor':    { color: 0x00ff88, emissive: 0x008844, moveColor: 0x44ffaa, moveEmissive: 0x22aa66 },
    'assembly':    { color: 0xcc66ff, emissive: 0x663388, moveColor: 0xdd88ff, moveEmissive: 0x8844aa },
    'workstation': { color: 0xffaa33, emissive: 0x886622, moveColor: 0xffbb55, moveEmissive: 0xaa8833 },
    'gantry':      { color: 0x00d4ff, emissive: 0x006688, moveColor: 0x44eeff, moveEmissive: 0x2299aa },
    'control':     { color: 0xaaaaaa, emissive: 0x555555, moveColor: 0xcccccc, moveEmissive: 0x777777 },
};
const DEFAULT_SELECT = { color: 0x00bbff, emissive: 0x005588, moveColor: 0x00ffcc, moveEmissive: 0x00aa88 };

function selectEquipment(equipConfig) {
    selectedEquipment = equipConfig;
    
    // Get meshes for this equipment
    const equipMeshes = equipmentGroups[equipConfig.usd_path] || [];
    
    // Type-based highlight color (로봇 = 노란색 계열)
    const sc = SELECT_COLORS[equipConfig.type] || DEFAULT_SELECT;
    
    
    // Highlight selected, dim others
    meshes.forEach(mesh => {
        if (!mesh.material) return;
        if (equipMeshes.includes(mesh)) {
            // 선택된 장비: 타입별 색상으로 변경
            const col = moveMode ? sc.moveColor : sc.color;
            const emi = moveMode ? sc.moveEmissive : sc.emissive;
            mesh.material.color.setHex(col);
            mesh.material.emissive.setHex(emi);
            mesh.material.emissiveIntensity = moveMode ? 0.7 : 0.5;
            mesh.material.opacity = 1.0;
            mesh.material.transparent = false;
            mesh.material.needsUpdate = true;
        } else {
            // 비선택 장비: 타입 색상 유지하되 반투명하게
            const orig = meshOriginalState.get(mesh);
            if (orig) {
                mesh.material.color.setHex(orig.originalColor);
                mesh.material.emissive.setHex(orig.originalColor);
            } else {
                mesh.material.emissive.setHex(0x000000);
            }
            mesh.material.emissiveIntensity = 0.08;
            mesh.material.opacity = 0.15;
            mesh.material.transparent = true;
            mesh.material.needsUpdate = true;
        }
    });
    
    // Show equipment overlay
    showEquipmentOverlay(equipConfig, equipMeshes);
    
    // Attach TransformControls if in move mode
    if (moveMode) {
        attachTransformToEquipment(equipConfig);
    }
    
    // Show current position offset
    const offset = equipmentOffsets[equipConfig.usd_path] || {x:0, y:0, z:0};
    updatePositionDisplay(new THREE.Vector3(offset.x, offset.y, offset.z));
    
    // Fetch and display equipment data
    fetchEquipmentData(equipConfig.id);
    
    // AAS 정보 조회
    if (typeof fetchAasForEquipment === "function") {
        fetchAasForEquipment(equipConfig.id);
    }
}

function clearEquipmentSelection() {
    selectedEquipment = null;
    
    // Detach transform controls
    if (transformControls) {
        transformControls.detach();
        transformControls.visible = false;
        transformControls.enabled = false;
    }
    
    // Restore all meshes to type colors
    meshes.forEach(mesh => {
        const originalState = meshOriginalState.get(mesh);
        if (originalState) {
            mesh.material.color.setHex(originalState.originalColor);
            mesh.material.emissive.setHex(originalState.originalColor);
            mesh.material.emissiveIntensity = 0.15;
            mesh.material.opacity = originalState.originalOpacity;
            mesh.material.transparent = (originalState.originalOpacity < 1.0);
        } else {
            mesh.material.emissive.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
            mesh.material.opacity = 1.0;
            mesh.material.transparent = false;
        }
        mesh.material.needsUpdate = true;
    });
    
    // Hide overlay
    const overlay = document.getElementById('equipment-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showEquipmentOverlay(equipConfig, meshes) {
    const overlay = document.getElementById('equipment-overlay');
    if (!overlay) return;
    
    document.getElementById('overlay-equip-name').textContent = equipConfig.name;
    document.getElementById('overlay-equip-type').textContent = equipConfig.type;
    document.getElementById('overlay-equip-status').textContent = '대기중...';
    
    overlay.style.display = 'block';
}

function fetchEquipmentData(equipId) {
    fetch(`/api/equipment/${equipId}/data`)
        .then(res => {
            if (!res.ok) return null; // 데이터 없으면 무시
            return res.json();
        })
        .then(data => {
            if (data) updateEquipmentOverlay(data);
        })
        .catch(() => {}); // 시뮬레이션 전에는 데이터 없을 수 있음
}

function updateEquipmentOverlay(data) {
    if (!document.getElementById('equipment-overlay') || 
        !document.getElementById('equipment-overlay').offsetParent) {
        return; // Overlay not visible
    }
    
    // Update status
    document.getElementById('overlay-equip-status').textContent = data.status || '알 수 없음';
    
    // Update sensors
    const sensorsDiv = document.getElementById('overlay-sensors');
    if (sensorsDiv && data.sensors) {
        sensorsDiv.innerHTML = '';
        Object.entries(data.sensors).forEach(([key, value]) => {
            const p = document.createElement('p');
            p.textContent = `${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`;
            sensorsDiv.appendChild(p);
        });
    }
    
    // Update alerts
    const alertsDiv = document.getElementById('overlay-alerts');
    if (alertsDiv && data.alerts) {
        alertsDiv.innerHTML = '';
        if (data.alerts.length === 0) {
            alertsDiv.textContent = '경고 없음';
        } else {
            data.alerts.forEach(alert => {
                const p = document.createElement('p');
                p.textContent = alert;
                alertsDiv.appendChild(p);
            });
        }
    }
}

// =============================================================================
// VIEWPORT INTERACTION
// =============================================================================

function onViewportClick(event) {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    
    const rect = viewport.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camera);
    
    const intersects = raycaster.intersectObjects(meshes);
    
    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        
        // Find equipment that owns this mesh
        let foundEquip = null;
        if (equipmentMapping && equipmentMapping.equipment) {
            for (const equip of equipmentMapping.equipment) {
                if (equipmentGroups[equip.usd_path] && 
                    equipmentGroups[equip.usd_path].includes(hitMesh)) {
                    foundEquip = equip;
                    break;
                }
            }
        }
        
        if (foundEquip) {
            selectEquipment(foundEquip);
        }
    } else {
        clearEquipmentSelection();
    }
}

// =============================================================================
// VIEW CONTROLS
// =============================================================================

function fitAll() {
    if (!modelGroup) return;
    
    const box = new THREE.Box3().setFromObject(modelGroup);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    
    cameraZ *= 1.5; // Add padding
    
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    
    camera.position.set(
        center.x + cameraZ * 0.7,
        center.y + cameraZ * 0.7,
        center.z + cameraZ * 0.7
    );
    
    camera.near = 0.1;
    camera.far = cameraZ * 10;
    camera.updateProjectionMatrix();
    
    controls.update();
}

function resetView() {
    fitAll();
    clearEquipmentSelection();
}

function setView(viewType) {
    if (!modelGroup || !controls) return;
    
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.2;
    
    controls.target.copy(center);
    
    switch (viewType) {
        case 'front':
            camera.position.set(center.x, center.y, center.z + distance);
            break;
        case 'top':
            camera.position.set(center.x, center.y + distance, center.z);
            break;
        case 'right':
            camera.position.set(center.x + distance, center.y, center.z);
            break;
        case 'iso':
            camera.position.set(
                center.x + distance * 0.7,
                center.y + distance * 0.7,
                center.z + distance * 0.7
            );
            break;
    }
    
    camera.updateProjectionMatrix();
    controls.update();
}

// =============================================================================
// WIREFRAME & EXPLODE
// =============================================================================

function toggleWireframe() {
    wireframeMode = !wireframeMode;
    meshes.forEach(mesh => {
        mesh.material.wireframe = wireframeMode;
    });
}

function toggleExplode() {
    explodeMode = !explodeMode;
    
    meshes.forEach(mesh => {
        if (explodeMode) {
            const originalPos = mesh.userData.originalPosition;
            const center = modelGroup.position;
            const direction = new THREE.Vector3().subVectors(originalPos, center).normalize();
            mesh.position.copy(originalPos).add(direction.multiplyScalar(2));
        } else {
            mesh.position.copy(mesh.userData.originalPosition);
        }
    });
}

// =============================================================================
// EQUIPMENT MOVE MODE
// =============================================================================

function toggleMoveMode() {
    moveMode = !moveMode;
    const btn = document.getElementById('btn-move');
    const moveCtrl = document.getElementById('move-controls');
    if (btn) {
        btn.textContent = moveMode ? '이동 모드 종료' : '장비 이동';
        btn.className = moveMode ? 'btn btn-danger' : 'btn';
    }
    if (moveCtrl) {
        moveCtrl.style.display = moveMode ? 'block' : 'none';
    }
    
    if (!moveMode) {
        // Detach transform controls
        transformControls.detach();
        transformControls.visible = false;
        transformControls.enabled = false;
    }
    
    // 이미 선택된 장비가 있으면 색상 + TransformControls 재적용
    if (selectedEquipment) {
        selectEquipment(selectedEquipment);
    }
}

function attachTransformToEquipment(equipConfig) {
    if (!moveMode || !transformControls) return;
    
    const pivot = equipmentPivots[equipConfig.usd_path];
    if (pivot) {
        transformControls.attach(pivot);
        transformControls.visible = true;
        transformControls.enabled = true;
    }
}

function onEquipmentMoved() {
    if (!transformControls.object) return;
    
    const pivot = transformControls.object;
    const groupName = pivot.userData.equipmentGroup;
    if (!groupName) return;
    
    // Move all meshes in the group based on pivot's new position
    const delta = new THREE.Vector3().subVectors(
        pivot.position, pivot.userData.originalPosition
    );
    
    pivot.userData.meshOffsets.forEach(entry => {
        const targetPos = pivot.userData.originalPosition.clone()
            .add(entry.offset)
            .add(delta);
        entry.mesh.position.copy(
            entry.mesh.parent.worldToLocal(targetPos)
        );
    });
    
    // Store offset for save
    equipmentOffsets[groupName] = {
        x: parseFloat(delta.x.toFixed(2)),
        y: parseFloat(delta.y.toFixed(2)),
        z: parseFloat(delta.z.toFixed(2))
    };
    
    // Update position display in overlay
    updatePositionDisplay(delta);
}

function updatePositionDisplay(delta) {
    const posEl = document.getElementById('overlay-position');
    if (posEl) {
        posEl.innerHTML = `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #333;">
                <div style="color:#00d4ff;font-size:11px;font-weight:bold;margin-bottom:4px;">위치 오프셋</div>
                <div style="font-family:monospace;font-size:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
                    <span style="color:#ff6644;">X: ${delta.x.toFixed(1)}</span>
                    <span style="color:#00ff88;">Y: ${delta.y.toFixed(1)}</span>
                    <span style="color:#44aaff;">Z: ${delta.z.toFixed(1)}</span>
                </div>
            </div>
        `;
    }
}

function resetEquipmentPosition() {
    if (!selectedEquipment) return;
    
    const groupName = selectedEquipment.usd_path;
    const pivot = equipmentPivots[groupName];
    if (!pivot) return;
    
    // Reset pivot to original
    pivot.position.copy(pivot.userData.originalPosition);
    
    // Reset all meshes
    pivot.userData.meshOffsets.forEach(entry => {
        const targetPos = pivot.userData.originalPosition.clone().add(entry.offset);
        entry.mesh.position.copy(
            entry.mesh.parent.worldToLocal(targetPos)
        );
    });
    
    // Clear stored offset
    delete equipmentOffsets[groupName];
    
    // Update display
    updatePositionDisplay(new THREE.Vector3(0, 0, 0));
    
    // Re-attach transform controls
    if (moveMode) {
        transformControls.attach(pivot);
    }
}

function resetAllPositions() {
    Object.keys(equipmentPivots).forEach(groupName => {
        const pivot = equipmentPivots[groupName];
        pivot.position.copy(pivot.userData.originalPosition);
        
        pivot.userData.meshOffsets.forEach(entry => {
            const targetPos = pivot.userData.originalPosition.clone().add(entry.offset);
            entry.mesh.position.copy(
                entry.mesh.parent.worldToLocal(targetPos)
            );
        });
    });
    
    equipmentOffsets = {};
    updatePositionDisplay(new THREE.Vector3(0, 0, 0));
}

function saveEquipmentPositions() {
    const data = {};
    Object.keys(equipmentOffsets).forEach(key => {
        if (equipmentOffsets[key].x !== 0 || equipmentOffsets[key].y !== 0 || equipmentOffsets[key].z !== 0) {
            data[key] = equipmentOffsets[key];
        }
    });
    
    fetch('/api/equipment/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (res.ok) {
            // Positions saved successfully
            alert('장비 위치가 저장되었습니다.');
        }
    })
    .catch(err => console.error('Save positions error:', err));
}

function loadSavedPositions() {
    fetch('/api/equipment/positions')
        .then(res => {
            if (!res.ok) return;
            return res.json();
        })
        .then(data => {
            if (!data) return;
            
            Object.entries(data).forEach(([groupName, offset]) => {
                const pivot = equipmentPivots[groupName];
                if (!pivot) return;
                
                const delta = new THREE.Vector3(offset.x, offset.y, offset.z);
                pivot.position.copy(pivot.userData.originalPosition.clone().add(delta));
                
                pivot.userData.meshOffsets.forEach(entry => {
                    const targetPos = pivot.userData.originalPosition.clone()
                        .add(entry.offset)
                        .add(delta);
                    entry.mesh.position.copy(
                        entry.mesh.parent.worldToLocal(targetPos)
                    );
                });
                
                equipmentOffsets[groupName] = offset;
            });
            
            console.log('Loaded saved positions:', Object.keys(data).length);
        })
        .catch(() => {}); // Silently fail if no saved positions
}

// =============================================================================
// SIMULATION
// =============================================================================

function startSimulation() {
    simulationActive = !simulationActive;
    
    const btn = document.getElementById('btn-simulate');
    if (btn) {
        btn.textContent = simulationActive ? '시뮬레이션 중지' : '시뮬레이션 시작';
    }
    
    if (simulationActive) {
        // Start simulation on server
        fetch('/api/data/simulate', { method: 'POST' })
            .then(res => res.json())
            .then(data => console.log('Simulation started:', data))
            .catch(err => console.error('Error starting simulation:', err));
        
        // Start polling
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(pollSimulationData, 2000);
    } else {
        // Stop polling
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }
}

function pollSimulationData() {
    fetch('/api/equipment/status')
        .then(res => res.json())
        .then(data => {
            updateEquipmentVisuals(data);
            
            if (selectedEquipment) {
                fetchEquipmentData(selectedEquipment.id);
            }
        })
        .catch(err => console.error('Error polling simulation data:', err));
}

function updateEquipmentVisuals(statusData) {
    if (!equipmentMapping || !equipmentMapping.equipment) return;
    
    equipmentMapping.equipment.forEach(equip => {
        const status = statusData[equip.id];
        if (!status) return;
        
        const meshesInGroup = equipmentGroups[equip.usd_path] || [];
        let glowColor = new THREE.Color(0xffaa00); // Default: idle
        let intensity = 0.5;
        
        if (status.status === 'running') {
            glowColor.setHex(0x00ff88);
            intensity = 0.8;
        } else if (status.status === 'error') {
            glowColor.setHex(0xff4444);
            intensity = 1.0;
        }
        
        meshesInGroup.forEach(mesh => {
            if (!selectedEquipment || selectedEquipment.id !== equip.id) {
                mesh.material.emissive.copy(glowColor);
                mesh.material.emissiveIntensity = intensity;
            }
        });
    });
}

// =============================================================================
// STATS & UI UPDATES
// =============================================================================

function updateStats() {
    document.getElementById('val-triangles').textContent = meshes.length;
    document.getElementById('val-equip-count').textContent = 
        Object.keys(equipmentGroups).length;
    document.getElementById('val-group-count').textContent = 
        Object.keys(equipmentGroups).length;
}

function setConnectionStatus(status, text) {
    const dot = document.getElementById('connection-dot');
    const textEl = document.getElementById('connection-text');
    
    if (dot) {
        dot.style.backgroundColor = status === 'active' ? '#00ff88' : '#ff4444';
    }
    if (textEl) {
        textEl.textContent = text;
    }
}

function setDataStatus(status, text) {
    const dot = document.getElementById('data-dot');
    const textEl = document.getElementById('data-text');
    
    if (dot) {
        dot.style.backgroundColor = status === 'active' ? '#00ff88' : '#cccccc';
    }
    if (textEl) {
        textEl.textContent = text;
    }
}

// =============================================================================
// ANIMATION LOOP
// =============================================================================

function animate() {
    requestAnimationFrame(animate);
    
    if (controls) {
        controls.update();
    }
    
    // FPS counter
    frameCount++;
    const now = performance.now();
    if (now - lastFrameTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFrameTime = now;
        document.getElementById('val-fps').textContent = fps;
    }
    
    // Memory info
    if (renderer.info && renderer.info.memory) {
        const mem = renderer.info.memory;
        document.getElementById('footer-memory').textContent = 
            'Memory: Geo=' + mem.geometries + ' Tex=' + mem.textures;
    }
    
    // Render
    renderer.render(scene, camera);
}

// =============================================================================
// ROBOT FK (Forward Kinematics) - FANUC R-2000iC 6-Axis
// Proper kinematic chain with geometry-derived axes and cumulative rotation
// =============================================================================

let robotFKData = {};

// Mesh name keywords → joint segment (which segment a part physically belongs to)
const JOINT_SEGMENT_KEYWORDS = {
    1: ['_J1_', '_J1Base', '_J2Base', 'MotorCover_J1', 'MotorCover_J2', 'stopper_J1', 'transport_equip_heavypayload_J1', '1337_H501_J1'],
    2: ['_J2Arm', 'transport_equip_270F_J2', 'BalancerCase', 'BalancerRod', 'MotorCover_J3'],
    3: ['_J3_', '_J3_heavypayload', '1337_H501_J3', 'MotorCover_J456'],
    4: ['_J4_'],
    5: ['_J5_'],
    6: ['_J6_']
};

function classifyMeshToJoint(meshSuffix) {
    if (meshSuffix.startsWith('A75_')) {
        if (meshSuffix.includes('ROBOT_ARM_1ST'))    return 2;
        if (meshSuffix.includes('ROBOT_ARM_SWING'))  return 1;
        if (meshSuffix.includes('GRIPPER') || meshSuffix.includes('FINGER')) return 6;
        if (meshSuffix.includes('P02_'))             return 5;
        return 6;
    }
    for (let j = 6; j >= 1; j--) {
        for (const kw of JOINT_SEGMENT_KEYWORDS[j]) {
            if (meshSuffix.includes(kw)) return j;
        }
    }
    if (meshSuffix.match(/^T\d/)) {
        const num = parseInt(meshSuffix.match(/^T(\d)/)[1]);
        if (num <= 2) return 1;
        if (num <= 3) return 2;
        if (num <= 4) return 3;
        return 4;
    }
    return 0;
}

/**
 * Compute local (home-position) rotation axes from pivot geometry.
 * 
 * FANUC R-2000iC 6축 관절 물리 구조:
 *   J1: 베이스 회전 — 수직(Y)축 중심, 전체 상체를 좌우로 회전
 *   J2: 숄더 — 하부 암을 앞뒤(상하)로 스윙. 축은 팔 평면에 수직인 수평축
 *   J3: 엘보 — 상부 암을 굽힘. 축은 J2와 평행
 *   J4: 손목 롤 — 전완(forearm) 길이 방향으로 회전
 *   J5: 손목 피치 — J4에 수직, 손목을 위아래로 굽힘
 *   J6: 플랜지 회전 — 공구/그리퍼를 회전. 홈 위치에서 J4와 동축
 */
function computeLocalAxes(pivots) {
    const axes = {};
    const Y_UP = new THREE.Vector3(0, 1, 0);
    
    // J1: always vertical rotation
    axes[1] = new THREE.Vector3(0, 1, 0);
    
    // Determine arm reach direction from base (J1) through shoulder (J2) to wrist (J4)
    // This defines the vertical plane in which the arm operates
    let armReachXZ;
    if (pivots[2] && pivots[4]) {
        // Use J2 → J4 direction projected onto XZ for arm reach
        const j2_to_j4 = new THREE.Vector3().subVectors(pivots[4], pivots[2]);
        armReachXZ = new THREE.Vector3(j2_to_j4.x, 0, j2_to_j4.z);
        if (armReachXZ.length() < 0.01) {
            // Fallback: J1 to J2
            const j1_to_j2 = new THREE.Vector3().subVectors(pivots[2], pivots[1]);
            armReachXZ = new THREE.Vector3(j1_to_j2.x, 0, j1_to_j2.z);
        }
        armReachXZ.normalize();
    } else {
        armReachXZ = new THREE.Vector3(1, 0, 0); // fallback
    }
    
    // J2 axis: horizontal, perpendicular to arm reach plane
    // cross(Y_UP, armReach) gives axis pointing "right" from the arm's perspective
    axes[2] = new THREE.Vector3().crossVectors(Y_UP, armReachXZ).normalize();
    
    // J3 axis: parallel to J2 (same rotation plane)
    axes[3] = axes[2].clone();
    
    // J4 axis: along the forearm direction (J3 → J5 or J3 → J4)
    if (pivots[3] && pivots[5]) {
        axes[4] = new THREE.Vector3().subVectors(pivots[5], pivots[3]).normalize();
    } else if (pivots[3] && pivots[4]) {
        axes[4] = new THREE.Vector3().subVectors(pivots[4], pivots[3]).normalize();
    } else {
        axes[4] = armReachXZ.clone(); // fallback: same as arm reach
    }
    
    // J5 axis: perpendicular to J4, in the arm's vertical plane
    // Use cross(J4, J2_axis) to get axis in the arm plane
    axes[5] = new THREE.Vector3().crossVectors(axes[4], axes[2]).normalize();
    if (axes[5].length() < 0.1) {
        // Fallback if J4 ∥ J2_axis
        axes[5] = new THREE.Vector3().crossVectors(axes[4], Y_UP).normalize();
    }
    
    // J6 axis: same direction as J4 (coaxial at home position)
    axes[6] = axes[4].clone();
    
    return axes;
}

function setupRobotFK() {
    if (!equipmentMapping || !equipmentMapping.equipment) return;
    
    const robots = equipmentMapping.equipment.filter(e => e.type === 'robot');
    
    robots.forEach(robot => {
        const robotMeshes = equipmentGroups[robot.usd_path] || [];
        if (robotMeshes.length === 0) return;
        
        const prefix = robot.usd_path;
        const jointMeshes = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        
        robotMeshes.forEach(mesh => {
            const suffix = mesh.name.substring(prefix.length);
            jointMeshes[classifyMeshToJoint(suffix)].push(mesh);
        });
        

        
        // Calculate pivot points
        const pivots = {};
        for (let j = 1; j <= 6; j++) {
            if (jointMeshes[j].length === 0) continue;
            const mainMesh = jointMeshes[j].find(m => {
                const s = m.name.substring(prefix.length);
                return s.includes(`_J${j}_`) || s.includes(`_J${j}Arm`);
            }) || jointMeshes[j][0];
            
            const box = new THREE.Box3().setFromObject(mainMesh);
            const center = box.getCenter(new THREE.Vector3());
            pivots[j] = (j === 1) ? new THREE.Vector3(center.x, box.min.y, center.z) : center.clone();
        }
        
        // Compute local axes from geometry
        const localAxes = computeLocalAxes(pivots);
        

        
        // Save original world transforms
        const origTransforms = new Map();
        robotMeshes.forEach(mesh => {
            mesh.updateMatrixWorld(true);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scl = new THREE.Vector3();
            mesh.matrixWorld.decompose(pos, quat, scl);
            origTransforms.set(mesh, { pos: pos.clone(), quat: quat.clone(), scl: scl.clone() });
        });
        
        // Affected meshes: Jn rotation affects Jn + all downstream segments
        const affectedMeshes = {};
        for (let j = 1; j <= 6; j++) {
            affectedMeshes[j] = [];
            for (let k = j; k <= 6; k++) affectedMeshes[j].push(...jointMeshes[k]);
        }
        
        const origPivots = {};
        for (let j = 1; j <= 6; j++) {
            if (pivots[j]) origPivots[j] = pivots[j].clone();
        }
        
        robotFKData[robot.usd_path] = {
            robot, jointMeshes, affectedMeshes, pivots, origPivots,
            localAxes, origTransforms,
            angles: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
        };
        
    });
    
    if (Object.keys(robotFKData).length > 0) createFKControls();
}

/**
 * Apply FK with proper cumulative rotation.
 * 
 * 핵심 원리: 각 관절의 회전축은 상위 관절들의 누적 회전에 의해 변환됨.
 *   - J1은 고정 Y축
 *   - J2의 실제 축 = J1 회전 적용 후의 J2 로컬 축
 *   - J3의 실제 축 = (J1*J2) 회전 적용 후의 J3 로컬 축
 *   - ...이하 동일
 */
function applyRobotFK(robotKey) {
    const fk = robotFKData[robotKey];
    if (!fk) return;
    
    // 1. 모든 메쉬를 원래 위치로 복원
    fk.origTransforms.forEach((orig, mesh) => {
        if (!mesh.parent) return;
        mesh.parent.updateMatrixWorld(true);
        const parentInv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
        const localPos = orig.pos.clone().applyMatrix4(parentInv);
        mesh.position.copy(localPos);
        
        const parentQuat = new THREE.Quaternion();
        mesh.parent.getWorldQuaternion(parentQuat);
        parentQuat.invert();
        mesh.quaternion.copy(orig.quat.clone().premultiply(parentQuat));
        mesh.scale.copy(orig.scl);
    });
    
    // 2. 피벗 위치 복사 (원본 유지)
    const curPivots = {};
    for (let j = 1; j <= 6; j++) {
        if (fk.origPivots[j]) curPivots[j] = fk.origPivots[j].clone();
    }
    
    // 3. 누적 프레임 쿼터니언: 로컬 축 → 월드 축 변환
    const frameQuat = new THREE.Quaternion(); // identity = home position
    
    for (let j = 1; j <= 6; j++) {
        const angleDeg = fk.angles[j];
        if (!curPivots[j] || !fk.localAxes[j]) continue;
        if (Math.abs(angleDeg) < 0.001) {
            // 각도가 0이면 축 변환만 업데이트 (회전 없음)
            // frameQuat은 변하지 않음
            continue;
        }
        
        // 현재 관절의 월드 축 = 누적 프레임으로 변환된 로컬 축
        const worldAxis = fk.localAxes[j].clone().applyQuaternion(frameQuat).normalize();
        const pivot = curPivots[j];
        const angleRad = THREE.MathUtils.degToRad(angleDeg);
        const rotQuat = new THREE.Quaternion().setFromAxisAngle(worldAxis, angleRad);
        
        // 영향받는 메쉬들을 피벗 중심으로 회전
        fk.affectedMeshes[j].forEach(mesh => {
            const wPos = new THREE.Vector3();
            mesh.getWorldPosition(wPos);
            
            // 피벗 중심 회전: P' = R * (P - pivot) + pivot
            wPos.sub(pivot).applyQuaternion(rotQuat).add(pivot);
            
            // 월드 → 로컬 좌표 변환
            if (mesh.parent) {
                mesh.parent.updateMatrixWorld(true);
                const pInv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
                mesh.position.copy(wPos.applyMatrix4(pInv));
            }
            
            // 메쉬 방향(쿼터니언)에도 회전 적용
            mesh.quaternion.premultiply(rotQuat);
        });
        
        // 하위 피벗 위치도 동일하게 회전
        for (let k = j + 1; k <= 6; k++) {
            if (curPivots[k]) {
                curPivots[k].sub(pivot).applyQuaternion(rotQuat).add(pivot);
            }
        }
        
        // 누적 프레임 업데이트: frameQuat = rotQuat * frameQuat
        frameQuat.premultiply(rotQuat);
    }
}

function setJointAngle(robotKey, jointIndex, angleDeg) {
    const fk = robotFKData[robotKey];
    if (!fk) return;
    fk.angles[jointIndex] = angleDeg;
    applyRobotFK(robotKey);
}

function createFKControls() {
    // Add FK panel to left sidebar
    const sidebar = document.getElementById('sidebar-left');
    if (!sidebar) return;
    
    // Title
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = '로봇 관절 제어';
    sidebar.appendChild(title);
    
    // Controls container
    const fkSection = document.createElement('div');
    fkSection.id = 'fk-controls';
    fkSection.style.cssText = 'padding: 6px 10px;';
    fkSection.innerHTML = `
        <select id="fk-robot-select" style="width:100%; margin-bottom:8px; background:#1a1a2e; color:#e0e0ff; border:1px solid #333366; padding:4px; border-radius:4px; font-size:11px;">
        </select>
        <div id="fk-sliders"></div>
        <div style="margin-top:8px; display:flex; gap:4px;">
            <button onclick="resetAllJoints()" style="flex:1; font-size:11px; padding:4px 8px; background:#2a2a4e; color:#e0e0ff; border:1px solid #333366; border-radius:4px; cursor:pointer;">전체 초기화</button>
            <button onclick="animateRobotDemo()" id="btn-demo" style="flex:1; font-size:11px; padding:4px 8px; background:#2a2a4e; color:#e0e0ff; border:1px solid #333366; border-radius:4px; cursor:pointer;">데모 동작</button>
        </div>
    `;
    sidebar.appendChild(fkSection);
    
    // Populate robot select
    const select = document.getElementById('fk-robot-select');
    Object.keys(robotFKData).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = robotFKData[key].robot.name;
        select.appendChild(opt);
    });
    
    select.addEventListener('change', () => updateFKSliders(select.value));
    
    // Show sliders for first robot
    if (Object.keys(robotFKData).length > 0) {
        updateFKSliders(Object.keys(robotFKData)[0]);
    }
}

function updateFKSliders(robotKey) {
    const fk = robotFKData[robotKey];
    if (!fk) return;
    
    const container = document.getElementById('fk-sliders');
    container.innerHTML = '';
    
    const jointNames = { 1: 'J1 베이스', 2: 'J2 숄더', 3: 'J3 엘보', 4: 'J4 손목회전', 5: 'J5 손목굽힘', 6: 'J6 플랜지' };
    // FANUC R-2000iC/165F actual joint limits (degrees) from datasheet
    const jointLimits = {
        1: [-370, 370], 2: [-136, 136], 3: [-312, 312],
        4: [-720, 720], 5: [-250, 250], 6: [-720, 720]
    };
    
    for (let j = 1; j <= 6; j++) {
        if (!fk.pivots[j]) continue;
        
        const limits = jointLimits[j];
        const currentAngle = fk.angles[j] || 0;
        
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:6px;';
        row.innerHTML = `
            <div style="display:flex; justify-content:space-between; font-size:11px; color:#8888aa; margin-bottom:2px;">
                <span>${jointNames[j]}</span>
                <span id="fk-val-${j}" style="color:#00d4ff; min-width:40px; text-align:right;">${currentAngle.toFixed(1)}°</span>
            </div>
            <input type="range" id="fk-slider-${j}" 
                min="${limits[0]}" max="${limits[1]}" step="0.5" value="${currentAngle}"
                style="width:100%; height:4px; accent-color:#00d4ff; cursor:pointer;"
                oninput="onFKSliderChange('${robotKey}', ${j}, this.value)">
        `;
        container.appendChild(row);
    }
}

function onFKSliderChange(robotKey, jointIndex, value) {
    const angle = parseFloat(value);
    setJointAngle(robotKey, jointIndex, angle);
    const valEl = document.getElementById(`fk-val-${jointIndex}`);
    if (valEl) valEl.textContent = angle.toFixed(1) + '°';
}

function resetAllJoints() {
    const select = document.getElementById('fk-robot-select');
    if (!select) return;
    const robotKey = select.value;
    const fk = robotFKData[robotKey];
    if (!fk) return;
    
    for (let j = 1; j <= 6; j++) {
        if (fk.pivots[j]) {
            setJointAngle(robotKey, j, 0);
            const slider = document.getElementById(`fk-slider-${j}`);
            if (slider) slider.value = 0;
            const valEl = document.getElementById(`fk-val-${j}`);
            if (valEl) valEl.textContent = '0.0°';
        }
    }
}

// Demo animation
let demoAnimating = false;
let demoAnimationId = null;

function animateRobotDemo() {
    if (demoAnimating) {
        demoAnimating = false;
        if (demoAnimationId) cancelAnimationFrame(demoAnimationId);
        return;
    }
    
    const select = document.getElementById('fk-robot-select');
    if (!select) return;
    const robotKey = select.value;
    const fk = robotFKData[robotKey];
    if (!fk) return;
    
    demoAnimating = true;
    const startTime = performance.now();
    
    function demoFrame() {
        if (!demoAnimating) return;
        
        const t = (performance.now() - startTime) / 1000; // seconds
        
        // Gentle wave motion on each joint
        const angles = {
            1: Math.sin(t * 0.5) * 30,
            2: Math.sin(t * 0.7 + 1) * 15,
            3: Math.sin(t * 0.9 + 2) * 20,
            4: Math.sin(t * 1.2 + 3) * 40,
            5: Math.sin(t * 0.8 + 4) * 25,
            6: Math.sin(t * 1.5 + 5) * 60
        };
        
        for (let j = 1; j <= 6; j++) {
            if (fk.pivots[j]) {
                setJointAngle(robotKey, j, angles[j]);
                const slider = document.getElementById(`fk-slider-${j}`);
                if (slider) slider.value = angles[j];
                const valEl = document.getElementById(`fk-val-${j}`);
                if (valEl) valEl.textContent = angles[j].toFixed(1) + '°';
            }
        }
        
        demoAnimationId = requestAnimationFrame(demoFrame);
    }
    
    demoFrame();
}

// =============================================================================
// STARTUP
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    init();
});
