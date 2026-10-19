#!/usr/bin/env bash
# Baut eine eigenständige Linux-App und packt sie als .tar.gz.
# MUSS auf Linux laufen (am besten auf einer möglichst alten Distribution,
# damit die glibc kompatibel bleibt).  Voraussetzung: python3 (Qt kommt über PySide6 mit).
#
#   ./packaging/build_linux.sh
#
set -e
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
VERSION="1.0.0"
WORK="build/linux"                       # eigener Arbeitsordner – dist/ bleibt unangetastet
OUT="dist/Mindmap-Editor-${VERSION}-linux-x86_64.tar.gz"

echo "==> virtuelle Umgebung + Abhängigkeiten"
"$PYTHON" -m venv .build-venv
source .build-venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt pyinstaller

echo "==> App bauen"
# Achtung: dist/ enthält ggf. die macOS-Pakete aus einem früheren Build und
# wird deshalb NICHT geleert. PyInstaller arbeitet in build/linux/.
rm -rf "$WORK"
mkdir -p "$WORK" dist
pyinstaller mindmap_editor.spec --distpath "$WORK/dist" --workpath "$WORK/work" --noconfirm

echo "==> tar.gz erzeugen"
# Startskript beilegen
cat > "$WORK/dist/Mindmap-Editor/starten.sh" <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
exec ./Mindmap-Editor "$@"
EOF
chmod +x "$WORK/dist/Mindmap-Editor/starten.sh"
rm -f "$OUT"
tar -czf "$OUT" -C "$WORK/dist" Mindmap-Editor

deactivate
echo "==> Fertig:  $OUT"
echo "    Entpacken und  ./Mindmap-Editor/starten.sh  ausführen."
echo "    Für die Web-App:  cp $OUT web/static/downloads/Mindmap-Editor-linux-x86_64.tar.gz"
