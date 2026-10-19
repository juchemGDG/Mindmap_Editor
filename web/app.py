"""Flask-Backend für den Mindmap Editor (Web-Version).

Startet auf http://0.0.0.0:5000 und ist damit im lokalen Netz
(z. B. vom iPad) über die IP-Adresse des Rechners erreichbar.

Aufgaben des Backends:
  * liefert die statische Web-App aus (web/static/)
  * gemeinsames Bearbeiten: /api/collab.php – dasselbe Protokoll wie
    web/static/api/collab.php, damit die Web-App ohne Änderung mit PHP
    (z. B. Plesk/Bitpalast) ODER mit diesem Backend läuft
  * vermittelt die Downloads der Desktop-Version vom neuesten GitHub-Release
    (wie beim PAP-Editor)
"""

import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from flask import Flask, abort, jsonify, redirect, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "static", "downloads")

# ── Gemeinsames Bearbeiten ──────────────────────────────────────────────
# Ablage pro Sitzung ("Raum"):  <DATA>/<raum>.json  mit Stand, Versionszähler
# und den letzten Operationen. Anwesenheit nur im Speicher.
DATA_DIR = os.environ.get("MINDMAP_DATA_DIR") or os.path.join(BASE_DIR, "collab-data")
KEEP_OPS = 3000            # so viele Operationen bleiben für Nachzügler abrufbar
PEER_TTL = 15              # Sekunden ohne Lebenszeichen, bis jemand als "weg" gilt
ROOM_TTL_DAYS = 60         # unbenutzte Sitzungen werden danach gelöscht
MAX_DOC_BYTES = 8 * 1024 * 1024
COLLECTIONS = {"meta", "nodes", "links", "votes"}
ROOM_RE = re.compile(r"^[a-z0-9]{6,16}$")
ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

_locks = {}
_locks_guard = threading.Lock()
_peers = {}                # raum -> {client: {...}}


def _room_lock(room):
    with _locks_guard:
        return _locks.setdefault(room, threading.Lock())


def _room_path(room):
    return os.path.join(DATA_DIR, room + ".json")


def _load_room(room):
    try:
        with open(_room_path(room), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save_room(room, state):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = _room_path(room) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, _room_path(room))


def _cleanup_rooms():
    limit = time.time() - ROOM_TTL_DAYS * 86400
    try:
        for name in os.listdir(DATA_DIR):
            path = os.path.join(DATA_DIR, name)
            if name.endswith(".json") and os.path.getmtime(path) < limit:
                os.remove(path)
    except OSError:
        pass


def _valid_op(op):
    if not isinstance(op, dict) or op.get("c") not in COLLECTIONS:
        return False
    oid = op.get("id")
    if not isinstance(oid, str) or not 0 < len(oid) <= 80:
        return False
    kinds = [k for k in ("put", "del", "set") if k in op]
    if len(kinds) != 1:
        return False
    if "put" in op and not isinstance(op["put"], dict):
        return False
    if "set" in op and not isinstance(op["set"], dict):
        return False
    return True


def _apply_op(doc, op):
    col = doc.setdefault(op["c"], {})
    if not isinstance(col, dict):
        col = doc[op["c"]] = {}
    oid = op["id"]
    if "put" in op:
        col[oid] = op["put"]
    elif "del" in op:
        col.pop(oid, None)
    else:
        obj = col.get(oid)
        if not isinstance(obj, dict):
            return                      # inzwischen gelöscht: Änderung verfällt
        for field, value in op["set"].items():
            if value is None:
                obj.pop(field, None)
            else:
                obj[field] = value


def _now_ms():
    return int(time.time() * 1000)


@app.route("/api/collab.php", methods=["POST"])
@app.route("/api/collab", methods=["POST"])
def api_collab():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="ungültige Anfrage"), 400
    action = body.get("action")

    if action == "create":
        doc = body.get("doc")
        if not isinstance(doc, dict) or not isinstance(doc.get("nodes"), dict):
            return jsonify(error="keine Mindmap übergeben"), 400
        if len(json.dumps(doc)) > MAX_DOC_BYTES:
            return jsonify(error="Mindmap zu groß (Bilder verkleinern?)"), 413
        os.makedirs(DATA_DIR, exist_ok=True)
        _cleanup_rooms()
        for _ in range(20):
            room = "".join(secrets.choice(ROOM_ALPHABET) for _ in range(8))
            if not os.path.exists(_room_path(room)):
                break
        key = secrets.token_urlsafe(12).replace("-", "x").replace("_", "y")
        state = {"ver": 0, "base": 0, "doc": doc, "ops": [], "key": key, "created": _now_ms()}
        with _room_lock(room):
            _save_room(room, state)
        return jsonify(room=room, key=key, ver=0, now=_now_ms())

    if action != "sync":
        return jsonify(error="unbekannte Aktion"), 400

    room = str(body.get("room") or "")
    if not ROOM_RE.match(room):
        return jsonify(error="notfound")
    client = str(body.get("client") or "")[:40]
    since = body.get("since")
    since = since if isinstance(since, int) else -1
    ops = body.get("ops") or []
    if not isinstance(ops, list):
        return jsonify(error="ungültige Operationen"), 400

    with _room_lock(room):
        state = _load_room(room)
        if state is None:
            return jsonify(error="notfound")
        if ops:
            if not secrets.compare_digest(str(body.get("key") or ""), state.get("key", "")):
                return jsonify(error="readonly")
            changed = False
            for op in ops[:2000]:
                if not _valid_op(op):
                    continue
                _apply_op(state["doc"], op)
                state["ver"] += 1
                state["ops"].append({"v": state["ver"], "c": client, "o": op})
                changed = True
            if len(state["ops"]) > KEEP_OPS:
                drop = len(state["ops"]) - KEEP_OPS
                state["base"] = state["ops"][drop - 1]["v"]
                state["ops"] = state["ops"][drop:]
            if changed:
                _save_room(room, state)

        # Anwesenheit
        me = body.get("me") if isinstance(body.get("me"), dict) else {}
        peers = _peers.setdefault(room, {})
        now = time.time()
        if client:
            sel = me.get("sel") if isinstance(me.get("sel"), list) else []
            peers[client] = {
                "client": client,
                "name": str(me.get("name") or "Gast")[:40],
                "color": str(me.get("color") or "#64748b")[:16],
                "sel": [str(s)[:80] for s in sel[:8]],
                "view": str(me.get("view") or "")[:16],
                "ro": bool(me.get("ro")),
                "t": now,
            }
        for cid in [c for c, p in peers.items() if now - p["t"] > PEER_TTL]:
            del peers[cid]

        answer = {"ver": state["ver"], "now": _now_ms(),
                  "peers": [{k: v for k, v in p.items() if k != "t"} for p in peers.values()]}
        if since < state.get("base", 0):
            answer["reset"] = {"doc": state["doc"], "ver": state["ver"]}
        else:
            answer["ops"] = [o for o in state["ops"] if o["v"] > since]
    return jsonify(answer)


# ── Desktop-Downloads (wie beim PAP-Editor) ─────────────────────────────
GITHUB_REPO = os.environ.get("MINDMAP_GITHUB_REPO", "juchemGDG/Mindmap_Editor")
GITHUB_TOKEN = os.environ.get("MINDMAP_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""

DESKTOP_ASSETS = [
    ("macos",   "macOS",   "Mindmap-Editor.dmg",                 "Apple Silicon & Intel · .dmg"),
    ("windows", "Windows", "Mindmap-Editor-Setup.exe",           "Installer · .exe"),
    ("linux",   "Linux",   "Mindmap-Editor-linux-x86_64.tar.gz", "entpacken & starten · .tar.gz"),
]

CACHE_OK_SECONDS = 300
CACHE_FAIL_SECONDS = 60
_release_cache = {"time": 0.0, "data": None, "error": None}


class _NoRedirect(HTTPRedirectHandler):
    """Weiterleitungen nicht selbst folgen – wir wollen die Ziel-URL sehen."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _gh_headers(accept):
    headers = {"Accept": accept, "User-Agent": "Mindmap-Editor"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def _latest_release():
    now = time.time()
    age = now - _release_cache["time"]
    if _release_cache["data"] is not None and age < CACHE_OK_SECONDS:
        return _release_cache["data"], None
    if _release_cache["error"] is not None and age < CACHE_FAIL_SECONDS:
        return None, _release_cache["error"]
    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    try:
        with urlopen(Request(url, headers=_gh_headers("application/vnd.github+json")), timeout=6) as response:
            data = json.load(response)
        _release_cache.update(time=now, data=data, error=None)
        return data, None
    except HTTPError as exc:
        error = "kein Release gefunden" if exc.code == 404 else f"GitHub antwortet mit {exc.code}"
        if exc.code in (401, 403, 404) and not GITHUB_TOKEN:
            error += " (privates Repository? MINDMAP_GITHUB_TOKEN setzen)"
    except (URLError, ValueError, OSError) as exc:
        error = f"GitHub nicht erreichbar ({exc})"
    _release_cache.update(time=now, data=None, error=error)
    return None, error


def _assets_by_name(release):
    return {asset.get("name"): asset for asset in (release or {}).get("assets", [])}


def _local_size(name):
    path = os.path.join(DOWNLOADS_DIR, name)
    return os.path.getsize(path) if os.path.isfile(path) else None


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/downloads")
def api_downloads():
    release, error = _latest_release()
    assets = _assets_by_name(release)
    files = []
    for key, os_name, filename, hint in DESKTOP_ASSETS:
        asset = assets.get(filename)
        local = _local_size(filename)
        if asset:
            files.append({"key": key, "os": os_name, "name": filename, "hint": hint,
                          "url": f"downloads/latest/{key}", "size": asset.get("size"),
                          "source": "github", "available": True})
        elif local is not None:
            files.append({"key": key, "os": os_name, "name": filename, "hint": hint,
                          "url": f"downloads/{filename}", "size": local,
                          "source": "lokal", "available": True})
        else:
            files.append({"key": key, "os": os_name, "name": filename, "hint": hint,
                          "url": None, "size": None, "source": None, "available": False})
    published = (release or {}).get("published_at") or ""
    return jsonify({
        "repo": GITHUB_REPO,
        "version": (release or {}).get("tag_name"),
        "published": published[:10],
        "release_url": (release or {}).get("html_url"),
        "error": error,
        "files": files,
    })


@app.route("/downloads/latest/<key>")
def download_latest(key):
    entry = next((item for item in DESKTOP_ASSETS if item[0] == key), None)
    if entry is None:
        abort(404)
    filename = entry[2]
    release, _ = _latest_release()
    asset = _assets_by_name(release).get(filename)
    if asset:
        req = Request(asset["url"], headers=_gh_headers("application/octet-stream"))
        try:
            opener = build_opener(_NoRedirect)
            with opener.open(req, timeout=6) as response:
                location = response.headers.get("Location")
            if location:
                return redirect(location)
        except HTTPError as exc:
            location = exc.headers.get("Location") if exc.headers else None
            if location:
                return redirect(location)
        except (URLError, OSError):
            pass
        if asset.get("browser_download_url"):
            return redirect(asset["browser_download_url"])
    if os.path.isfile(os.path.join(DOWNLOADS_DIR, filename)):
        return redirect(f"/downloads/{filename}")
    abort(404)


# Die PHP-Ablage darf nie ausgeliefert werden (falls jemand beides parallel nutzt)
@app.route("/api/data/<path:_rest>")
def no_data(_rest):
    abort(404)


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f"\n  Mindmap Editor läuft auf  http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
