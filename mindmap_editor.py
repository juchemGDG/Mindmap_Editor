"""Mindmap Editor – Desktop-Version

Die Desktop-Version zeigt dieselbe Oberfläche wie die Web-Version (web/static)
in einem eigenen Programmfenster (pywebview: WebKit unter macOS, Edge WebView2
unter Windows, Qt WebEngine unter Linux). So gibt es nur EINE Codebasis für
beide Varianten – anders als beim PAP-Editor müssen keine zwei
Implementierungen (Tkinter und JavaScript) synchron gehalten werden.

Was die Desktop-Version zusätzlich macht:
  * echte Öffnen-/Speichern-Dialoge des Betriebssystems (über die Klasse Api,
    die im Browser als window.pywebview.api erreichbar ist)
  * Rückfrage beim Schließen, wenn etwas nicht gespeichert ist
  * der Zwischenspeicher (letzter Stand) bleibt über Programmstarts erhalten

Start:  python3 mindmap_editor.py      (oder bash start_mindmap.sh)
"""

from __future__ import annotations

import base64
import functools
import http.server
import os
import socket
import sys
import threading

import webview

APP_TITLE = "Mindmap Editor"
PREFERRED_PORT = 48761          # fester Port → Browser-Speicher bleibt erhalten


def resource_dir() -> str:
    """Ordner mit den mitgelieferten Dateien (auch im PyInstaller-Paket)."""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


STATIC_DIR = os.path.join(resource_dir(), "web", "static")


def data_dir() -> str:
    """Ablage für den Browser-Speicher der Desktop-Version (pro Benutzer)."""
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    path = os.path.join(base, "Mindmap-Editor")
    os.makedirs(path, exist_ok=True)
    return path


# Dateitypen für die Dialoge. Die Beschreibung darf laut pywebview nur
# Buchstaben, Ziffern und Leerzeichen enthalten.
FILE_TYPES = {
    ".json": ("Mindmap (*.json)",),
    ".png": ("PNG Bild (*.png)",),
    ".jpg": ("JPG Bild (*.jpg;*.jpeg)",),
    ".svg": ("SVG Grafik (*.svg)",),
    ".md": ("Markdown (*.md)",),
    ".opml": ("OPML (*.opml)",),
    ".csv": ("CSV Tabelle (*.csv)",),
    ".ics": ("Kalender (*.ics)",),
}
OPEN_TYPES = (
    "Mindmaps und Listen (*.json;*.mm;*.opml;*.md;*.markdown;*.txt)",
    "Alle Dateien (*.*)",
)


# ── Lokaler Webserver ───────────────────────────────────────────────────
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Liefert web/static aus, ohne Protokollausgabe und ohne Caching."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json"}

    def log_message(self, *args):     # keine Konsolenausgabe
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def start_server() -> int:
    handler = functools.partial(QuietHandler, directory=STATIC_DIR)
    for port in (PREFERRED_PORT, 0):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    else:
        raise RuntimeError("Kein freier Port für den lokalen Server")
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


# ── Schnittstelle für die Web-Oberfläche (window.pywebview.api) ─────────
class Api:
    def __init__(self) -> None:
        self._window = None
        self.dirty = False
        self._last_dir = os.path.expanduser("~/Documents")
        if not os.path.isdir(self._last_dir):
            self._last_dir = os.path.expanduser("~")

    def attach(self, window) -> None:
        self._window = window

    def set_dirty(self, value: bool) -> None:
        """Die Oberfläche meldet, ob es ungespeicherte Änderungen gibt."""
        self.dirty = bool(value)

    def save_file(self, name: str, data: str, is_base64: bool = False):
        """Speichern-Dialog zeigen und die Datei schreiben. Gibt den Pfad zurück (oder None)."""
        name = os.path.basename(str(name)) or "mindmap.json"
        ext = os.path.splitext(name)[1].lower()
        types = FILE_TYPES.get(ext, ()) + ("Alle Dateien (*.*)",)
        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE, directory=self._last_dir, save_filename=name, file_types=types)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        if ext and not os.path.splitext(path)[1]:
            path += ext
        if is_base64:
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
        else:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(data)
        self._last_dir = os.path.dirname(path)
        return path

    def open_file(self, accept: str = ""):
        """Öffnen-Dialog zeigen; liefert {name, data} (Text) oder None."""
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, directory=self._last_dir, allow_multiple=False, file_types=OPEN_TYPES)
        if not result:
            return None
        path = result[0]
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            data = f.read()
        self._last_dir = os.path.dirname(path)
        return {"name": os.path.basename(path), "data": data}


def on_closing(window, api: Api) -> bool:
    """Vor dem Schließen nachfragen, wenn ungespeicherte Änderungen da sind.

    Den Zustand meldet die Oberfläche selbst (Api.set_dirty) – ein
    evaluate_js an dieser Stelle könnte auf manchen Systemen hängen bleiben.
    """
    if not api.dirty:
        return True
    return window.create_confirmation_dialog(
        APP_TITLE,
        "Die Mindmap wurde seit dem letzten Speichern geändert.\n"
        "Der letzte Stand bleibt zwar im Programm erhalten – trotzdem ohne Speichern schließen?")


def main() -> None:
    if not os.path.isfile(os.path.join(STATIC_DIR, "index.html")):
        sys.exit(f"web/static/index.html nicht gefunden (gesucht in {STATIC_DIR})")
    port = start_server()
    api = Api()
    window = webview.create_window(
        APP_TITLE,
        url=f"http://127.0.0.1:{port}/index.html?desktop=1",
        js_api=api,
        width=1440, height=900, min_size=(900, 600),
        background_color="#0f172a",
        text_select=True,
    )
    api.attach(window)
    window.events.closing += lambda: on_closing(window, api)
    icon = os.path.join(resource_dir(), "assets", "icon.png")
    webview.start(
        private_mode=False,                 # Zwischenspeicher über Neustarts behalten
        storage_path=data_dir(),
        icon=icon if os.path.isfile(icon) else None,
        debug="--debug" in sys.argv,
    )


if __name__ == "__main__":
    main()
