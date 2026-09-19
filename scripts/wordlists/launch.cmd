@echo off
python "%~dp0extract.py" --gui
if errorlevel 1 pause
