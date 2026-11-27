@echo off
setlocal
chcp 65001 >nul 2>&1
title Lumina Steam Theme Installer

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install.ps1"

where pwsh >nul 2>&1
if %errorlevel%==0 (
    set "PS_EXE=pwsh.exe"
) else (
    set "PS_EXE=powershell.exe"
)

if exist "%PS1%" (
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Pause %*
) else (
    set "LUMINA_PAUSE=1"
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $u='https://raw.githubusercontent.com/Fisnetia/Lumina-Steam-Theme/main/install.ps1'; $c=$null; foreach($p in @('','https://gh-proxy.org/','https://hk.gh-proxy.org/','https://gh-proxy.com/')){ try{ $c=(Invoke-WebRequest -Uri ($p+$u) -UseBasicParsing -TimeoutSec 10).Content; if($c){ break } }catch{} }; if(-not $c){ Write-Host '[X] Failed to download install.ps1 from GitHub.' -ForegroundColor Red; Write-Host 'Press any key to close...'; [void][Console]::ReadKey($true); exit 1 }; Invoke-Expression $c"
)
endlocal
