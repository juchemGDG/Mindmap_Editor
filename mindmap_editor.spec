# PyInstaller-Spezifikation für den Mindmap Editor (Desktop-Version)
# Baut eine eigenständige GUI-App (ohne Konsolenfenster).
# Aufruf:  pyinstaller mindmap_editor.spec
import os
import sys

block_cipher = None

# Die komplette Web-Oberfläche wird mitgepackt – die Desktop-App zeigt sie an.
# Nicht mit: Server-Teile (PHP-Ablage, Downloads der Pakete).
datas = []
for root, dirs, files in os.walk("web/static"):
    dirs[:] = [d for d in dirs if d not in ("downloads", "data")]
    for name in files:
        if name.endswith(".php") or name.startswith("."):
            continue
        datas.append((os.path.join(root, name), root))
if os.path.isfile("assets/icon.png"):
    datas.append(("assets/icon.png", "assets"))

_default_icon = "assets/icon.icns" if sys.platform == "darwin" else "assets/icon.ico"
APP_ICON = os.environ.get("MINDMAP_ICON") or (_default_icon if os.path.isfile(_default_icon) else None)

hiddenimports = ["webview"]
if sys.platform.startswith("linux"):
    hiddenimports += ["webview.platforms.qt", "qtpy"]

a = Analysis(
    ["mindmap_editor.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "flask"],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Mindmap-Editor",
    debug=False,
    strip=False,
    upx=False,
    console=False,          # GUI-App, kein Terminalfenster
    icon=APP_ICON,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Mindmap-Editor",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Mindmap-Editor.app",
        icon=APP_ICON,
        bundle_identifier="de.gdg-stuttgart.mindmapeditor",
        info_plist={
            "CFBundleName": "Mindmap Editor",
            "CFBundleDisplayName": "Mindmap Editor",
            "CFBundleShortVersionString": "1.0.0",
            "NSHighResolutionCapable": True,
            # lokaler Server auf 127.0.0.1 (http) für die Oberfläche
            "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        },
    )
