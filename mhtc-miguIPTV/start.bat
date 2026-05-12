@echo off
title IPTV 播放列表管理器
echo ================================================
echo   IPTV 播放列表管理器
echo ================================================
echo.
echo 正在启动服务...
echo.
cd /d "%~dp0"
node app.js
pause
