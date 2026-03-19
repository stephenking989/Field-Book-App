@echo off
cd /d "%~dp0"
echo.
echo   FieldBook - local server
echo   ----------------------------------------
echo   Open this in your browser:
echo   http://localhost:8765/index.html
echo   ----------------------------------------
echo   Press Ctrl+C to stop the server
echo.
start "" "http://localhost:8765/index.html"
python -m http.server 8765
pause
