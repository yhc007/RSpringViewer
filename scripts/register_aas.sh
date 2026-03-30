#!/bin/bash
# RSpring 장비 AAS 자동 등록 스크립트 v2

AAS_SERVER="http://localhost:8080"

echo "🏭 RSpring AAS 등록 시작..."

# 장비 정의 (id|name|type|manufacturer|model)
EQUIPMENT=(
    "ROBOT_01|로봇 #1|robot|FANUC|R-2000iC/165F"
    "ROBOT_02|로봇 #2|robot|FANUC|R-2000iC/210F"
    "DRILL_TAP|드릴탭 머신|machine|Brother|TC-22B-0"
    "CONVEYOR_01|컨베이어 #1|conveyor|Daifuku|STV-500"
    "CONVEYOR_02|컨베이어 #2|conveyor|Daifuku|STV-500"
    "RECOIL_SPRING|리코일 스프링 프레스|machine|AIDA|NC1-80"
    "SPRING_CONVEYOR|스프링 컨베이어|conveyor|Custom|SC-100"
    "YOKE_CONVEYOR|요크 컨베이어|conveyor|Custom|YC-100"
    "GANTRY|갠트리 로봇|gantry|IAI|IX-NNN5020"
    "STOPPER_NUT_CONV_01|스토퍼넛 컨베이어 #1|conveyor|Custom|SNC-100"
    "STOPPER_NUT_CONV_02|스토퍼넛 컨베이어 #2|conveyor|Custom|SNC-100"
    "NG_RELEASE_01|NG 배출 #1|assembly|Custom|NGR-100"
    "NG_RELEASE_02|NG 배출 #2|assembly|Custom|NGR-100"
    "CONTROL_BOX|제어반|control|LS Electric|XGT"
    "OPERATE_PANEL|조작반|control|Siemens|TP1500"
)

register_equipment() {
    local id=$1
    local name=$2
    local type=$3
    local manufacturer=$4
    local model=$5
    
    local aas_id="rspring-$(echo $id | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
    
    echo "  📦 $id ($name)..."
    
    # 1. AAS Shell 등록 (endpoints 포함)
    local result=$(curl -s -X POST "$AAS_SERVER/api/aas" \
        -H "Content-Type: application/json" \
        -d "{
            \"id\": \"$aas_id\",
            \"id_short\": \"$id\",
            \"asset_kind\": \"Instance\",
            \"global_asset_id\": \"urn:rspring:equipment:$id\",
            \"endpoints\": [{
                \"interface\": \"AAS-3.0\",
                \"protocol_information\": {
                    \"href\": \"http://localhost:8080/shells/$aas_id\",
                    \"endpoint_protocol\": \"HTTP\",
                    \"endpoint_protocol_version\": \"1.1\"
                }
            }]
        }")
    
    if [[ "$result" != *"created"* ]]; then
        echo "    ⚠️ Shell 등록 실패: $result"
        return
    fi
    
    # 2. Nameplate Submodel
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels" \
        -H "Content-Type: application/json" \
        -d "{
            \"id\": \"nameplate-$aas_id\",
            \"id_short\": \"Nameplate\",
            \"semantic_id\": \"https://admin-shell.io/zvei/nameplate/2/0/Nameplate\"
        }" > /dev/null 2>&1
    
    # Nameplate Elements
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/nameplate-$aas_id/submodel-elements" \
        -H "Content-Type: application/json" \
        -d "{\"id_short\": \"ManufacturerName\", \"value\": \"$manufacturer\", \"value_type\": \"xs:string\"}" > /dev/null 2>&1
    
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/nameplate-$aas_id/submodel-elements" \
        -H "Content-Type: application/json" \
        -d "{\"id_short\": \"ProductDesignation\", \"value\": \"$model\", \"value_type\": \"xs:string\"}" > /dev/null 2>&1
    
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/nameplate-$aas_id/submodel-elements" \
        -H "Content-Type: application/json" \
        -d "{\"id_short\": \"EquipmentType\", \"value\": \"$type\", \"value_type\": \"xs:string\"}" > /dev/null 2>&1
    
    # 3. OperationalData Submodel
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels" \
        -H "Content-Type: application/json" \
        -d "{
            \"id\": \"opdata-$aas_id\",
            \"id_short\": \"OperationalData\",
            \"semantic_id\": \"https://admin-shell.io/idta/OperationalData/1/0\"
        }" > /dev/null 2>&1
    
    # OperationalData Elements (타입별)
    case $type in
        robot)
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Temperature\", \"value\": \"65.0\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"SpeedRPM\", \"value\": \"1200\", \"value_type\": \"xs:int\"}" > /dev/null 2>&1
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Torque\", \"value\": \"45.0\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            ;;
        machine)
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Temperature\", \"value\": \"72.0\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"SpindleRPM\", \"value\": \"2000\", \"value_type\": \"xs:int\"}" > /dev/null 2>&1
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Vibration\", \"value\": \"2.5\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            ;;
        conveyor|gantry)
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Speed\", \"value\": \"0.8\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"MotorCurrent\", \"value\": \"12.0\", \"value_type\": \"xs:double\"}" > /dev/null 2>&1
            ;;
        *)
            curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/opdata-$aas_id/submodel-elements" \
                -H "Content-Type: application/json" \
                -d "{\"id_short\": \"Status\", \"value\": \"Active\", \"value_type\": \"xs:string\"}" > /dev/null 2>&1
            ;;
    esac
    
    # 4. Maintenance Submodel
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels" \
        -H "Content-Type: application/json" \
        -d "{
            \"id\": \"maint-$aas_id\",
            \"id_short\": \"Maintenance\",
            \"semantic_id\": \"https://admin-shell.io/idta/Maintenance/1/0\"
        }" > /dev/null 2>&1
    
    local runtime=$((RANDOM % 10000 + 1000))
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/maint-$aas_id/submodel-elements" \
        -H "Content-Type: application/json" \
        -d "{\"id_short\": \"OperatingHours\", \"value\": \"$runtime\", \"value_type\": \"xs:int\"}" > /dev/null 2>&1
    
    curl -s -X POST "$AAS_SERVER/shells/$aas_id/submodels/maint-$aas_id/submodel-elements" \
        -H "Content-Type: application/json" \
        -d "{\"id_short\": \"MaintenanceStatus\", \"value\": \"OK\", \"value_type\": \"xs:string\"}" > /dev/null 2>&1
    
    echo "    ✅ 완료"
}

# 메인 실행
for equip in "${EQUIPMENT[@]}"; do
    IFS='|' read -r id name type manufacturer model <<< "$equip"
    register_equipment "$id" "$name" "$type" "$manufacturer" "$model"
done

echo ""
echo "🎉 등록 완료!"
echo ""
echo "확인:"
curl -s "$AAS_SERVER/api/aas" | jq -r '.[] | .id_short' | grep -v "^Test\|^UMATI" | sort
