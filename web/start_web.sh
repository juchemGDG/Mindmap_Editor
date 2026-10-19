#!/usr/bin/env bash
# Startet die Web-Version mit Flask-Backend (inkl. gemeinsamem Bearbeiten).
#   bash web/start_web.sh [port]
cd "$(dirname "$0")"
exec python3 app.py "${1:-5000}"
