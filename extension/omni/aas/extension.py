"""
AAS Extension - Main entry point
"""
import omni.ext
import omni.ui as ui
import omni.usd
import omni.kit.commands
from pxr import Usd, UsdGeom

from .aas_client import AASClient
from .ui_panel import AASPanel


class AASExtension(omni.ext.IExt):
    """Asset Administration Shell Integration Extension"""
    
    WINDOW_NAME = "AAS Panel"
    MENU_PATH = "Window/Digital Twin/AAS Panel"
    
    def __init__(self):
        super().__init__()
        self._window = None
        self._panel = None
        self._aas_client = None
        self._selection_sub = None
        
    def on_startup(self, ext_id):
        print("[AAS] Extension starting up...")
        
        # Initialize AAS client
        self._aas_client = AASClient()
        
        # Create menu item
        self._menu = omni.kit.ui.get_editor_menu().add_item(
            self.MENU_PATH,
            self._on_menu_click,
            toggle=True,
            value=False
        )
        
        # Subscribe to selection changes
        self._setup_selection_listener()
        
        print("[AAS] Extension started successfully")
    
    def on_shutdown(self):
        print("[AAS] Extension shutting down...")
        
        if self._selection_sub:
            self._selection_sub = None
            
        if self._window:
            self._window.destroy()
            self._window = None
            
        if self._menu:
            omni.kit.ui.get_editor_menu().remove_item(self._menu)
            self._menu = None
            
        print("[AAS] Extension shutdown complete")
    
    def _on_menu_click(self, menu, toggled):
        """Handle menu click"""
        if toggled:
            self._show_window()
        else:
            self._hide_window()
    
    def _show_window(self):
        """Show the AAS panel window"""
        if self._window is None:
            self._window = ui.Window(
                self.WINDOW_NAME,
                width=400,
                height=600,
                dockPreference=ui.DockPreference.RIGHT_BOTTOM
            )
            self._panel = AASPanel(self._window, self._aas_client)
        
        self._window.visible = True
    
    def _hide_window(self):
        """Hide the AAS panel window"""
        if self._window:
            self._window.visible = False
    
    def _setup_selection_listener(self):
        """Setup listener for USD selection changes"""
        usd_context = omni.usd.get_context()
        
        def on_selection_changed():
            selection = usd_context.get_selection()
            paths = selection.get_selected_prim_paths()
            
            if paths and self._panel:
                prim_path = paths[0]
                self._on_prim_selected(prim_path)
        
        # Subscribe to selection changes
        self._selection_sub = usd_context.get_stage_event_stream().create_subscription_to_pop(
            lambda e: on_selection_changed() if e.type == int(omni.usd.StageEventType.SELECTION_CHANGED) else None
        )
    
    def _on_prim_selected(self, prim_path: str):
        """Handle prim selection - fetch AAS data"""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return
            
        prim = stage.GetPrimAtPath(prim_path)
        if not prim.IsValid():
            return
        
        # Extract equipment ID from prim name or custom attribute
        equipment_id = self._extract_equipment_id(prim)
        
        if equipment_id and self._panel:
            self._panel.show_equipment(equipment_id, prim_path)
    
    def _extract_equipment_id(self, prim) -> str:
        """Extract equipment ID from prim"""
        # Check for custom AAS attribute
        if prim.HasAttribute("aas:equipmentId"):
            return prim.GetAttribute("aas:equipmentId").Get()
        
        # Check for semantic label
        if prim.HasAttribute("semantics:label"):
            return prim.GetAttribute("semantics:label").Get()
        
        # Fallback: use prim name with pattern matching
        name = prim.GetName()
        
        # Common equipment patterns
        patterns = [
            "ROBOT", "CONVEYOR", "DRILL", "GANTRY", 
            "SPRING", "CONTROL", "PANEL", "RELEASE"
        ]
        
        for pattern in patterns:
            if pattern in name.upper():
                return name.upper().replace(" ", "_")
        
        return None
