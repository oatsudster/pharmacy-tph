@echo off
rem Start HOSxP Bridge minimized: lets the floating leftover window read HN + appointment days from HOSxP
start "HOSxP Bridge" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hosxp-bridge.ps1"
