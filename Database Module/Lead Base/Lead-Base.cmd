@echo off
rem Lead Base: two-way Excel copy of all CRM leads. See README.md.
cd /d "%~dp0"
set PY="%~dp0..\..\.venv\Scripts\python.exe"
if not exist %PY% set PY=python
if not exist "data\.session.json" %PY% leadbase.py login
echo.
echo   1  Refresh workbook (pull)
echo   2  Send my Excel edits to the CRM (push)
echo   3  Keep workbook up to date every 5 minutes (watch)
echo   4  Sign in again
echo   5  Open the workbook
echo.
set /p CH=Choose 1-5: 
if "%CH%"=="1" %PY% leadbase.py pull
if "%CH%"=="2" %PY% leadbase.py push
if "%CH%"=="3" %PY% leadbase.py watch 5
if "%CH%"=="4" %PY% leadbase.py login
if "%CH%"=="5" start "" "data\Lead_Base.xlsx"
pause
