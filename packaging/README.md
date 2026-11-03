# Mindmap Editor – Pakete bauen

Die Desktop-Version ist ein Python-Programm (`mindmap_editor.py`), das die
Web-Oberfläche aus `web/static/` in einem eigenen Fenster zeigt
([pywebview](https://pywebview.flowrl.com)). Mit
[PyInstaller](https://pyinstaller.org) wird daraus pro Betriebssystem eine
eigenständige App, die **ohne installiertes Python** startet.

| System  | Anzeige der Oberfläche          | Hinweis |
|---------|---------------------------------|---------|
| macOS   | WebKit (Systembestandteil)      | – |
| Windows | Edge WebView2 (ab Windows 10 vorhanden) | auf sehr alten Systemen ggf. „WebView2 Runtime“ von Microsoft installieren |
| Linux   | Qt WebEngine (über PySide6 mitgeliefert) | Paket wird dadurch größer (~250 MB entpackt) |

> **Wichtig:** PyInstaller kann *nicht* über Plattformen hinweg bauen.
> Die macOS-App muss auf einem **Mac** gebaut werden, die Windows-App auf
> **Windows**, die Linux-App auf **Linux**.

## Ohne eigenen Rechner pro Plattform: GitHub Actions

Der Workflow `.github/workflows/build-packages.yml` baut alle drei Pakete auf
GitHubs Runnern:

1. auf GitHub → Reiter **Actions** → **„Pakete bauen"** → **Run workflow**
   (oder einen Tag `v1.1.0` pushen)
2. nach ein paar Minuten unten am Workflow-Lauf die Artefakte herunterladen

Alle Skripte bauen in `build/<plattform>/` und legen **nur** das fertige Paket
in `dist/` ab.

## macOS → `.dmg`
```bash
./packaging/build_macos.sh
# Ergebnis: dist/Mindmap-Editor.dmg   (enthält Mindmap-Editor.app)
```
Zum Verteilen ohne Warnung: App signieren & notarisieren (Apple Developer ID
nötig) – sonst beim ersten Start Rechtsklick → „Öffnen".

## Windows → Installer `.exe`
```bat
packaging\build_windows.bat
:: Ergebnis: dist\Mindmap-Editor-Setup.exe   (Installer, braucht Inno Setup)
```

## Linux → `.tar.gz`
```bash
./packaging/build_linux.sh
# Ergebnis: dist/Mindmap-Editor-1.1.0-linux-x86_64.tar.gz
# Nutzer: entpacken, dann ./Mindmap-Editor/starten.sh
```

## Icon
- Quelle ist `assets/icon.svg`. Nach einer Änderung:
  `python3 packaging/make_icons.py` (erzeugt `.png`, `.ico`, `.icns` sowie die
  Favicons in `web/static/`; braucht `cairosvg` und `pillow`).

## Auf der Homepage anbieten

Einen Tag pushen (`git tag v1.1.0 && git push origin v1.1.0`). Der Workflow
hängt die Pakete mit festen Namen an das GitHub-Release:

```
Mindmap-Editor.dmg
Mindmap-Editor-Setup.exe
Mindmap-Editor-windows-x86_64.zip
Mindmap-Editor-linux-x86_64.tar.gz
```

Der Menüpunkt „Desktop-Version" der Web-App liest das neueste Release (über das
Flask-Backend oder direkt bei GitHub, wenn das Repository öffentlich ist) und
verlinkt genau diese Dateien. Rückfallebene: die Dateien nach
`web/static/downloads/` kopieren.
