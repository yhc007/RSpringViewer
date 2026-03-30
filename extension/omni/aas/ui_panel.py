"""
AAS UI Panel for Omniverse
"""
import omni.ui as ui
from typing import Optional, Dict, List
from .aas_client import AASClient


class AASPanel:
    """AAS Information Panel UI"""
    
    def __init__(self, window: ui.Window, aas_client: AASClient):
        self._window = window
        self._client = aas_client
        self._current_equipment = None
        self._server_url_field = None
        
        self._build_ui()
    
    def _build_ui(self):
        """Build the panel UI"""
        with self._window.frame:
            with ui.VStack(spacing=8):
                # Header
                self._build_header()
                
                # Server Settings
                self._build_server_settings()
                
                ui.Spacer(height=4)
                ui.Line(style={"color": 0xFF333333})
                ui.Spacer(height=4)
                
                # Equipment Info
                self._build_equipment_section()
                
                # Submodels
                self._build_submodels_section()
    
    def _build_header(self):
        """Build header section"""
        with ui.HStack(height=30):
            ui.Label(
                "🏭 Asset Administration Shell",
                style={"font_size": 18, "color": 0xFF00D4FF}
            )
            ui.Spacer()
            ui.Button(
                "↻ Refresh",
                width=80,
                clicked_fn=self._on_refresh
            )
    
    def _build_server_settings(self):
        """Build server settings section"""
        with ui.CollapsableFrame("Server Settings", collapsed=True):
            with ui.VStack(spacing=4):
                with ui.HStack(height=24):
                    ui.Label("URL:", width=40)
                    self._server_url_field = ui.StringField()
                    self._server_url_field.model.set_value(self._client.server_url)
                
                with ui.HStack(height=24):
                    ui.Spacer()
                    self._connection_status = ui.Label(
                        "● Checking...",
                        style={"color": 0xFFFFAA00}
                    )
                    ui.Button(
                        "Connect",
                        width=80,
                        clicked_fn=self._on_connect
                    )
                
                self._check_connection()
    
    def _build_equipment_section(self):
        """Build equipment info section"""
        with ui.CollapsableFrame("Selected Equipment", collapsed=False):
            with ui.VStack(spacing=4):
                self._equipment_frame = ui.VStack()
                with self._equipment_frame:
                    ui.Label(
                        "Select a prim to view AAS data",
                        style={"color": 0xFF888888}
                    )
    
    def _build_submodels_section(self):
        """Build submodels section"""
        with ui.CollapsableFrame("Submodels", collapsed=False):
            with ui.ScrollingFrame(height=300):
                self._submodels_frame = ui.VStack(spacing=4)
                with self._submodels_frame:
                    ui.Label(
                        "No submodels loaded",
                        style={"color": 0xFF888888}
                    )
    
    def _on_connect(self):
        """Handle connect button click"""
        url = self._server_url_field.model.get_value_as_string()
        self._client.set_server_url(url)
        self._check_connection()
    
    def _on_refresh(self):
        """Handle refresh button click"""
        if self._current_equipment:
            self.show_equipment(self._current_equipment["id"], self._current_equipment.get("path"))
    
    def _check_connection(self):
        """Check AAS server connection"""
        if self._client.test_connection():
            self._connection_status.text = "● Connected"
            self._connection_status.style = {"color": 0xFF00FF88}
        else:
            self._connection_status.text = "● Disconnected"
            self._connection_status.style = {"color": 0xFFFF4444}
    
    def show_equipment(self, equipment_id: str, prim_path: str = None):
        """Show AAS data for equipment"""
        self._current_equipment = {"id": equipment_id, "path": prim_path}
        
        # Get AAS data
        data = self._client.get_equipment_data(equipment_id)
        
        # Update equipment section
        self._equipment_frame.clear()
        with self._equipment_frame:
            if data.get("error"):
                ui.Label(
                    f"⚠ {data['error']}",
                    style={"color": 0xFFFFAA00}
                )
            else:
                shell = data.get("shell", {})
                self._render_shell_info(shell, prim_path)
        
        # Update submodels section
        self._submodels_frame.clear()
        with self._submodels_frame:
            submodels = data.get("submodels", [])
            if submodels:
                for sm in submodels:
                    self._render_submodel(sm)
            else:
                ui.Label(
                    "No submodels found",
                    style={"color": 0xFF888888}
                )
    
    def _render_shell_info(self, shell: Dict, prim_path: str = None):
        """Render AAS shell information"""
        with ui.VStack(spacing=2):
            # Equipment ID
            ui.Label(
                shell.get("id_short", "Unknown"),
                style={"font_size": 16, "color": 0xFF00D4FF}
            )
            
            # AAS ID
            with ui.HStack(height=20):
                ui.Label("AAS ID:", width=80, style={"color": 0xFF888888})
                ui.Label(shell.get("id", "-"))
            
            # Global Asset ID
            if shell.get("global_asset_id"):
                with ui.HStack(height=20):
                    ui.Label("Asset:", width=80, style={"color": 0xFF888888})
                    ui.Label(shell.get("global_asset_id"))
            
            # USD Path
            if prim_path:
                with ui.HStack(height=20):
                    ui.Label("USD Path:", width=80, style={"color": 0xFF888888})
                    ui.Label(prim_path, style={"color": 0xFFAAFFAA})
    
    def _render_submodel(self, submodel: Dict):
        """Render a submodel"""
        sm_name = submodel.get("id_short") or submodel.get("id", "Submodel")
        
        with ui.CollapsableFrame(f"📋 {sm_name}", collapsed=True):
            with ui.VStack(spacing=2):
                # Semantic ID
                if submodel.get("semantic_id"):
                    ui.Label(
                        f"Semantic: {submodel['semantic_id']}",
                        style={"color": 0xFF666666, "font_size": 10}
                    )
                
                ui.Spacer(height=4)
                
                # Elements
                elements = submodel.get("elements", [])
                if elements:
                    for elem in elements:
                        self._render_element(elem)
                else:
                    ui.Label(
                        "No elements",
                        style={"color": 0xFF888888}
                    )
    
    def _render_element(self, element: Dict):
        """Render a submodel element"""
        with ui.HStack(height=22):
            # Name
            id_short = element.get("id_short") or element.get("idShort", "?")
            ui.Label(id_short, width=140, style={"color": 0xFFCCCCCC})
            
            # Value
            value = element.get("value", "-")
            value_type = element.get("value_type", "")
            
            # Format based on type
            if "double" in value_type or "float" in value_type:
                try:
                    value = f"{float(value):.2f}"
                except:
                    pass
            
            ui.Label(
                str(value),
                style={"color": 0xFFFFFFFF}
            )
            
            # Unit hint based on name
            unit = self._get_unit_hint(id_short)
            if unit:
                ui.Label(unit, width=40, style={"color": 0xFF888888})
    
    def _get_unit_hint(self, name: str) -> str:
        """Get unit hint based on element name"""
        name_lower = name.lower()
        if "temperature" in name_lower or "temp" in name_lower:
            return "°C"
        elif "speed" in name_lower or "rpm" in name_lower:
            return "RPM"
        elif "current" in name_lower:
            return "A"
        elif "hours" in name_lower:
            return "h"
        elif "torque" in name_lower:
            return "Nm"
        elif "vibration" in name_lower:
            return "mm/s"
        return ""
