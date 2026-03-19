#!/bin/bash
# FieldBook local dev server
# Double-click this (or run: bash start.sh) to launch the app.
# Serves on http://localhost:8765 — use this URL instead of opening index.html directly.

PORT=8765
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  FieldBook — local server"
echo "  ─────────────────────────────────────────"
echo "  URL : http://localhost:$PORT/index.html"
echo "  Dir : $DIR"
echo "  Stop: Ctrl+C"
echo ""

cd "$DIR"
python3 -m http.server $PORT
