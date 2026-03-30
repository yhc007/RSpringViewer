"""
AAS REST API Client
"""
import json
import asyncio
from typing import Optional, Dict, List, Any
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


class AASClient:
    """Client for Asset Administration Shell REST API"""
    
    def __init__(self, server_url: str = "http://localhost:8080"):
        self.server_url = server_url.rstrip("/")
        self._cache = {}
        self._cache_ttl = 30  # seconds
    
    def set_server_url(self, url: str):
        """Update AAS server URL"""
        self.server_url = url.rstrip("/")
        self._cache.clear()
    
    def get_shells(self) -> List[Dict]:
        """Get all AAS shells"""
        try:
            data = self._request("GET", "/api/aas")
            return data if isinstance(data, list) else []
        except Exception as e:
            print(f"[AAS] Failed to get shells: {e}")
            return []
    
    def get_shell(self, aas_id: str) -> Optional[Dict]:
        """Get specific AAS shell by ID"""
        try:
            return self._request("GET", f"/shells/{aas_id}")
        except Exception as e:
            print(f"[AAS] Failed to get shell {aas_id}: {e}")
            return None
    
    def get_submodels(self, aas_id: str) -> List[Dict]:
        """Get submodels for an AAS"""
        try:
            data = self._request("GET", f"/shells/{aas_id}/submodels")
            return data if isinstance(data, list) else []
        except Exception as e:
            print(f"[AAS] Failed to get submodels for {aas_id}: {e}")
            return []
    
    def get_submodel(self, aas_id: str, submodel_id: str) -> Optional[Dict]:
        """Get specific submodel"""
        try:
            return self._request("GET", f"/shells/{aas_id}/submodels/{submodel_id}")
        except Exception as e:
            print(f"[AAS] Failed to get submodel {submodel_id}: {e}")
            return None
    
    def get_submodel_elements(self, aas_id: str, submodel_id: str) -> List[Dict]:
        """Get submodel elements"""
        try:
            data = self._request("GET", f"/shells/{aas_id}/submodels/{submodel_id}/submodel-elements")
            return data if isinstance(data, list) else []
        except Exception as e:
            print(f"[AAS] Failed to get elements: {e}")
            return []
    
    def find_shell_by_equipment_id(self, equipment_id: str) -> Optional[Dict]:
        """Find AAS shell by equipment ID (id_short match)"""
        shells = self.get_shells()
        
        # Exact match first
        for shell in shells:
            if shell.get("id_short") == equipment_id:
                return shell
        
        # Partial match
        equipment_upper = equipment_id.upper()
        for shell in shells:
            id_short = shell.get("id_short", "").upper()
            if equipment_upper in id_short or id_short in equipment_upper:
                return shell
        
        return None
    
    def get_equipment_data(self, equipment_id: str) -> Dict[str, Any]:
        """Get complete AAS data for equipment"""
        result = {
            "equipment_id": equipment_id,
            "shell": None,
            "submodels": [],
            "error": None
        }
        
        # Find shell
        shell = self.find_shell_by_equipment_id(equipment_id)
        if not shell:
            result["error"] = f"AAS not found for {equipment_id}"
            return result
        
        result["shell"] = shell
        aas_id = shell.get("id")
        
        # Get submodels
        submodels = self.get_submodels(aas_id)
        for sm in submodels:
            sm_id = sm.get("id")
            if sm_id:
                elements = self.get_submodel_elements(aas_id, sm_id)
                sm["elements"] = elements
            result["submodels"].append(sm)
        
        return result
    
    def update_element(self, aas_id: str, submodel_id: str, element_id: str, value: Any) -> bool:
        """Update a submodel element value"""
        try:
            self._request(
                "PUT",
                f"/shells/{aas_id}/submodels/{submodel_id}/submodel-elements/{element_id}",
                {"value": str(value)}
            )
            return True
        except Exception as e:
            print(f"[AAS] Failed to update element: {e}")
            return False
    
    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Any:
        """Make HTTP request to AAS server"""
        url = f"{self.server_url}{endpoint}"
        
        headers = {"Content-Type": "application/json"}
        
        if data:
            body = json.dumps(data).encode("utf-8")
            req = Request(url, data=body, headers=headers, method=method)
        else:
            req = Request(url, headers=headers, method=method)
        
        try:
            with urlopen(req, timeout=5) as response:
                content = response.read().decode("utf-8")
                if content:
                    return json.loads(content)
                return {}
        except HTTPError as e:
            raise Exception(f"HTTP {e.code}: {e.reason}")
        except URLError as e:
            raise Exception(f"Connection failed: {e.reason}")
    
    def test_connection(self) -> bool:
        """Test connection to AAS server"""
        try:
            shells = self.get_shells()
            return isinstance(shells, list)
        except:
            return False
