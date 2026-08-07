@echo off
REM Optional launcher for phone access / reliable storage.
REM You can also just double-click index.html to use Notes Gallery on this PC.
cd /d "%~dp0"
echo Starting Notes Gallery server...
where py >nul 2>nul && ( py serve.py & goto :eof )
where python >nul 2>nul && ( python serve.py & goto :eof )
echo.
echo Python was not found on PATH. You can still use Notes Gallery by
echo double-clicking index.html in this folder.
echo.
pause
