// =============================================================================
// AAS INTEGRATION - Asset Administration Shell 연동
// =============================================================================

// AAS 상태
let aasShells = [];
let currentAasShell = null;
let aasSubmodels = [];

// AAS 셸 목록 로드
async function loadAasShells() {
    try {
        const response = await fetch('/api/aas/shells');
        if (response.ok) {
            aasShells = await response.json();
            console.log('AAS Shells loaded:', aasShells.length);
            updateAasSidebar();
        }
    } catch (error) {
        console.error('Failed to load AAS shells:', error);
    }
}

// 장비 선택 시 AAS 정보 조회
async function fetchAasForEquipment(equipmentId) {
    // 장비 ID로 AAS 찾기 (id_short 매칭)
    const matchingShell = aasShells.find(shell => 
        shell.id_short && (
            shell.id_short.toLowerCase().includes(equipmentId.toLowerCase()) ||
            equipmentId.toLowerCase().includes(shell.id_short.toLowerCase())
        )
    );
    
    if (matchingShell) {
        currentAasShell = matchingShell;
        await loadAasSubmodels(matchingShell.id);
        updateAasOverlay(matchingShell);
    } else {
        // AAS가 없으면 기본 정보만 표시
        currentAasShell = null;
        aasSubmodels = [];
        updateAasOverlay(null);
    }
}

// AAS Submodel 로드
async function loadAasSubmodels(aasId) {
    try {
        const response = await fetch(`/api/aas/shells/${aasId}/submodels`);
        if (response.ok) {
            aasSubmodels = await response.json();
            console.log('Submodels loaded:', aasSubmodels.length);
        }
    } catch (error) {
        console.error('Failed to load submodels:', error);
        aasSubmodels = [];
    }
}

// AAS 오버레이 업데이트
function updateAasOverlay(shell) {
    const aasSection = document.getElementById('overlay-aas');
    if (!aasSection) return;
    
    if (!shell) {
        aasSection.innerHTML = '<div style="color:#666;font-size:11px;">AAS 정보 없음</div>';
        return;
    }
    
    let html = `
        <div style="border-top:1px solid #333;margin-top:8px;padding-top:8px;">
            <div style="color:#00d4ff;font-size:11px;font-weight:bold;margin-bottom:6px;">
                🏭 AAS: ${shell.id_short || shell.id}
            </div>
    `;
    
    if (aasSubmodels && aasSubmodels.length > 0) {
        html += '<div style="font-size:11px;">';
        aasSubmodels.forEach(sm => {
            const smName = sm.id_short || sm.idShort || sm.id || 'Submodel';
            html += `<div style="color:#aaa;padding:2px 0;">📋 ${smName}</div>`;
        });
        html += '</div>';
    }
    
    // AAS 상세 보기 버튼
    html += `
        <button onclick="showAasDetails('${shell.id}')" 
            style="margin-top:6px;padding:4px 8px;font-size:10px;background:#00d4ff22;border:1px solid #00d4ff;color:#00d4ff;border-radius:4px;cursor:pointer;">
            상세 보기
        </button>
    </div>`;
    
    aasSection.innerHTML = html;
}

// AAS 상세 정보 모달
async function showAasDetails(aasId) {
    try {
        const [shellResp, submodelsResp] = await Promise.all([
            fetch(`/api/aas/shells/${aasId}`),
            fetch(`/api/aas/shells/${aasId}/submodels`)
        ]);
        
        const shell = await shellResp.json();
        const submodels = await submodelsResp.json();
        
        // 모달 생성
        const modal = document.createElement('div');
        modal.id = 'aas-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;';
        
        let content = `
            <div style="background:#1a1a2e;border:1px solid #00d4ff;border-radius:12px;padding:20px;max-width:600px;max-height:80vh;overflow-y:auto;color:#eee;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;color:#00d4ff;">🏭 ${shell.id_short || shell.id}</h3>
                    <button onclick="closeAasModal()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">✕</button>
                </div>
                
                <div style="margin-bottom:12px;">
                    <div style="color:#888;font-size:11px;">ID</div>
                    <div style="font-size:12px;">${shell.id}</div>
                </div>
        `;
        
        if (submodels && submodels.length > 0) {
            content += '<div style="margin-top:16px;"><div style="color:#00d4ff;font-weight:bold;margin-bottom:8px;">📋 Submodels</div>';
            
            for (const sm of submodels) {
                const smName = sm.id_short || sm.idShort || sm.id || 'Submodel';
                content += `
                    <div style="background:#0d0d1a;border:1px solid #333;border-radius:6px;padding:10px;margin-bottom:8px;">
                        <div style="color:#00d4ff;font-size:13px;margin-bottom:6px;">${smName}</div>
                `;
                
                // SubmodelElements 표시
                if (sm.submodelElements || sm.submodel_elements) {
                    const elements = sm.submodelElements || sm.submodel_elements || [];
                    elements.slice(0, 5).forEach(el => {
                        const elName = el.idShort || el.id_short || 'Element';
                        const elValue = el.value !== undefined ? el.value : '-';
                        content += `<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;padding:2px 0;">
                            <span>${elName}</span><span style="color:#fff;">${elValue}</span>
                        </div>`;
                    });
                    if (elements.length > 5) {
                        content += `<div style="color:#666;font-size:10px;">... +${elements.length - 5} more</div>`;
                    }
                }
                
                content += '</div>';
            }
            content += '</div>';
        }
        
        content += '</div>';
        modal.innerHTML = content;
        document.body.appendChild(modal);
        
        // 모달 외부 클릭 시 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAasModal();
        });
        
    } catch (error) {
        console.error('Failed to load AAS details:', error);
    }
}

function closeAasModal() {
    const modal = document.getElementById('aas-modal');
    if (modal) modal.remove();
}

// AAS 사이드바 업데이트
function updateAasSidebar() {
    const sidebar = document.getElementById('aas-list');
    if (!sidebar) return;
    
    if (aasShells.length === 0) {
        sidebar.innerHTML = '<div style="color:#666;font-size:11px;padding:8px;">AAS 없음</div>';
        return;
    }
    
    let html = '';
    aasShells.forEach(shell => {
        const name = shell.id_short || shell.id;
        html += `
            <div class="aas-item" onclick="selectAasShell('${shell.id}')" 
                 style="padding:6px 8px;cursor:pointer;border-bottom:1px solid #222;font-size:12px;">
                <span style="color:#00d4ff;">🏭</span> ${name}
            </div>
        `;
    });
    sidebar.innerHTML = html;
}

// AAS 셸 선택
async function selectAasShell(aasId) {
    const shell = aasShells.find(s => s.id === aasId);
    if (shell) {
        currentAasShell = shell;
        await loadAasSubmodels(aasId);
        showAasDetails(aasId);
    }
}

// 초기화 시 AAS 로드
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadAasShells, 1000);
});

console.log('AAS Integration loaded');
