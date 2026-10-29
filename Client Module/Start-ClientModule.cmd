@echo off
rem Starts the Client Module at http://127.0.0.1:8792 and opens it in your browser. Close this window to stop it.
cd /d "%~dp0"
rem Uses the shared CRM environment (..\.venv); a .venv inside this folder takes precedence if one is created.
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo No Python environment found. In the CRM folder run:  python -m venv .venv
  echo then:  .venv\Scripts\pip install -r "Client Module\requirements.txt" -r "DOC OCR Module\requirements.txt"
  pause
  exit /b 1
)
"%PY%" -m clientmodule
pause
