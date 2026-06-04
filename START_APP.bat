@echo off
title DTF Smart Nest Local Server
cd /d "%~dp0"

echo ===================================================
echo             DTF SMART NEST LOCAL SERVER
echo ===================================================
echo.
echo Luu y: Trinh duyet chan tinh nang tu dong xep anh (getImageData)
echo neu mo file index.html truc tiep (file://). 
echo Ban can chay local server nay de su dung duoc phan mem.
echo.
echo Dang khoi dong local server...

:: Check if Node/npx is available
where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Phat hien Node.js, dang khoi dong server bang npx...
    echo Mo trinh duyet tai dia chi: http://localhost:3000
    start http://localhost:3000
    npx -y serve -l 3000 .
    goto end
)

:: Check if Python is available
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Phat hien Python, dang khoi dong server bang Python...
    echo Mo trinh duyet tai dia chi: http://localhost:8000
    start http://localhost:8000
    python -m http.server 8000
    goto end
)

:: Check if python3 is available
where python3 >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Phat hien Python3, dang khoi dong server bang Python3...
    echo Mo trinh duyet tai dia chi: http://localhost:8000
    start http://localhost:8000
    python3 -m http.server 8000
    goto end
)

echo [Loi] May tinh cua ban chua cai dat Node.js hoac Python.
echo Hay cai dat mot trong hai cong cu tren de khoi dong server, 
echo hoac chay live server trong VS Code (Extension Live Server).
pause

:end
