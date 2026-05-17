// PLC Settings Management

let currentConfig = {
    equipmentId: '',
    line: 1,
    plc: {
        ip: '',
        port: 4999,
        network: 0,
        pc: 255,
        interval_ms: 1000
    },
    aas: {
        server: 'http://localhost:8080'
    },
    mappings: []
};

// 페이지 로드 시 장비 목록 불러오기
document.addEventListener('DOMContentLoaded', () => {
    loadEquipmentList();
});

// 장비 목록 로드
async function loadEquipmentList() {
    try {
        const response = await fetch('/api/plc/configs');
        if (response.ok) {
            const configs = await response.json();
            const select = document.getElementById('equipmentSelect');
            select.innerHTML = '<option value="">-- 장비를 선택하세요 --</option>';

            // 라인별 <optgroup>으로 묶어 표시
            const byLine = new Map();
            configs.forEach(c => {
                const line = c.line ?? 1;
                if (!byLine.has(line)) byLine.set(line, []);
                byLine.get(line).push(c);
            });
            [...byLine.keys()].sort((a, b) => a - b).forEach(line => {
                const og = document.createElement('optgroup');
                og.label = `Line ${line}`;
                byLine.get(line).forEach(config => {
                    const option = document.createElement('option');
                    option.value = config.equipment_id;
                    option.textContent = `${config.equipment_id} (${config.plc.ip})`;
                    og.appendChild(option);
                });
                select.appendChild(og);
            });
        }
    } catch (error) {
        console.error('Failed to load equipment list:', error);
    }
}

// 선택한 장비 설정 불러오기
async function loadEquipmentConfig() {
    const equipmentId = document.getElementById('equipmentSelect').value;
    if (!equipmentId) {
        showToast('장비를 선택하세요', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/plc/configs/${equipmentId}`);
        if (response.ok) {
            currentConfig = await response.json();
            populateForm(currentConfig);
            showToast('설정을 불러왔습니다', 'success');
        } else {
            showToast('설정을 찾을 수 없습니다', 'error');
        }
    } catch (error) {
        showToast('불러오기 실패: ' + error.message, 'error');
    }
}

// 새 장비 설정 생성
function createNewConfig() {
    currentConfig = {
        equipmentId: '',
        line: 1,
        plc: {
            ip: '',
            port: 4999,
            network: 0,
            pc: 255,
            interval_ms: 1000
        },
        aas: {
            server: 'http://localhost:8080'
        },
        mappings: []
    };
    populateForm(currentConfig);
    document.getElementById('equipmentSelect').value = '';
    showToast('새 설정이 준비되었습니다', 'success');
}

// 폼에 값 채우기
function populateForm(config) {
    document.getElementById('equipmentId').value = config.equipment_id || config.equipmentId || '';
    document.getElementById('line').value = String(config.line ?? 1);
    document.getElementById('plcIp').value = config.plc?.ip || '';
    document.getElementById('plcPort').value = config.plc?.port || 4999;
    document.getElementById('pollInterval').value = config.plc?.interval_ms || 1000;
    document.getElementById('network').value = config.plc?.network || 0;
    document.getElementById('pcNumber').value = config.plc?.pc || 255;
    document.getElementById('aasServer').value = config.aas?.server || 'http://localhost:8080';

    // 매핑 테이블 채우기
    const tbody = document.getElementById('mappingBody');
    tbody.innerHTML = '';
    
    (config.mappings || []).forEach((mapping, index) => {
        addMappingRow(mapping);
    });
}

// 매핑 행 추가
function addMappingRow(mapping = null) {
    const tbody = document.getElementById('mappingBody');
    const row = document.createElement('tr');
    
    row.innerHTML = `
        <td><input type="text" class="mapping-device" placeholder="D1000" value="${mapping?.device || ''}"></td>
        <td><input type="text" class="mapping-sensor" placeholder="spindle_rpm" value="${mapping?.sensor_name || ''}"></td>
        <td>
            <select class="mapping-type">
                <option value="int16" ${mapping?.data_type === 'int16' ? 'selected' : ''}>int16</option>
                <option value="uint16" ${mapping?.data_type === 'uint16' ? 'selected' : ''}>uint16</option>
                <option value="int32" ${mapping?.data_type === 'int32' ? 'selected' : ''}>int32</option>
                <option value="uint32" ${mapping?.data_type === 'uint32' ? 'selected' : ''}>uint32</option>
                <option value="float32" ${mapping?.data_type === 'float32' ? 'selected' : ''}>float32</option>
                <option value="bool" ${mapping?.data_type === 'bool' ? 'selected' : ''}>bool</option>
            </select>
        </td>
        <td><input type="text" class="mapping-submodel" placeholder="OperationalData" value="${mapping?.aas_submodel || ''}"></td>
        <td><input type="text" class="mapping-property" placeholder="CycleTime" value="${mapping?.aas_property || ''}"></td>
        <td><input type="number" class="mapping-scale" step="0.001" value="${mapping?.scale || 1}"></td>
        <td><input type="number" class="mapping-offset" step="0.001" value="${mapping?.offset || 0}"></td>
        <td><button class="btn btn-danger" onclick="this.closest('tr').remove()">삭제</button></td>
    `;
    
    tbody.appendChild(row);
}

// 폼에서 설정 수집
function collectFormData() {
    const mappings = [];
    document.querySelectorAll('#mappingBody tr').forEach(row => {
        const device = row.querySelector('.mapping-device').value.trim();
        if (device) {
            mappings.push({
                device: device,
                sensor_name: row.querySelector('.mapping-sensor').value.trim(),
                data_type: row.querySelector('.mapping-type').value,
                aas_submodel: row.querySelector('.mapping-submodel').value.trim(),
                aas_property: row.querySelector('.mapping-property').value.trim(),
                scale: parseFloat(row.querySelector('.mapping-scale').value) || 1,
                offset: parseFloat(row.querySelector('.mapping-offset').value) || 0,
                count: row.querySelector('.mapping-type').value.includes('32') ? 2 : 1
            });
        }
    });

    return {
        equipment_id: document.getElementById('equipmentId').value.trim(),
        line: parseInt(document.getElementById('line').value) || 1,
        plc: {
            ip: document.getElementById('plcIp').value.trim(),
            port: parseInt(document.getElementById('plcPort').value) || 4999,
            network: parseInt(document.getElementById('network').value) || 0,
            pc: parseInt(document.getElementById('pcNumber').value) || 255,
            interval_ms: parseInt(document.getElementById('pollInterval').value) || 1000
        },
        aas: {
            server: document.getElementById('aasServer').value.trim()
        },
        mappings: mappings
    };
}

// 설정 저장
async function saveConfig() {
    const config = collectFormData();
    
    if (!config.equipment_id) {
        showToast('장비 ID를 입력하세요', 'error');
        return;
    }
    if (!config.plc.ip) {
        showToast('PLC IP 주소를 입력하세요', 'error');
        return;
    }

    try {
        const response = await fetch('/api/plc/configs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            showToast('설정이 저장되었습니다', 'success');
            loadEquipmentList();
        } else {
            const error = await response.text();
            showToast('저장 실패: ' + error, 'error');
        }
    } catch (error) {
        showToast('저장 실패: ' + error.message, 'error');
    }
}

// 연결 테스트
async function testConnection() {
    const config = collectFormData();
    
    if (!config.plc.ip) {
        showToast('PLC IP 주소를 입력하세요', 'error');
        return;
    }

    showToast('연결 테스트 중...', 'success');
    
    try {
        const response = await fetch('/api/plc/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config.plc)
        });

        const result = await response.json();
        
        if (result.success) {
            document.getElementById('connectionStatus').className = 'status-badge status-connected'; document.getElementById('connectionStatus').innerHTML = '<span class="dot"></span>연결됨';
            document.getElementById('connectionStatus').textContent = '연결됨';
            showToast('PLC 연결 성공!', 'success');
        } else {
            document.getElementById('connectionStatus').className = 'status-badge status-disconnected'; document.getElementById('connectionStatus').innerHTML = '<span class="dot"></span>연결 실패';
            document.getElementById('connectionStatus').textContent = '연결 실패';
            showToast('연결 실패: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('테스트 실패: ' + error.message, 'error');
    }
}

// TOML 내보내기
function exportConfig() {
    const config = collectFormData();
    
    let toml = `# PLC → AAS Bridge 설정
# 장비: ${config.equipment_id}
line = ${config.line}

[plc]
ip = "${config.plc.ip}"
port = ${config.plc.port}
network = ${config.plc.network}
pc = ${config.plc.pc}
interval_ms = ${config.plc.interval_ms}

[aas]
server = "${config.aas.server}"

`;

    config.mappings.forEach(m => {
        toml += `[[mappings]]
device = "${m.device}"
sensor_name = "${m.sensor_name || ''}"
aas_submodel = "${m.aas_submodel}"
aas_property = "${m.aas_property}"
data_type = "${m.data_type}"
scale = ${m.scale}
offset = ${m.offset}
${m.count > 1 ? 'count = ' + m.count : ''}

`;
    });

    // 다운로드
    const blob = new Blob([toml], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.equipment_id || 'plc'}_config.toml`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('TOML 파일이 다운로드되었습니다', 'success');
}

// 토스트 메시지
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}
