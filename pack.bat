@echo off
del firefox-auto-refresh-tab.xpi 2>nul
powershell -Command "Compress-Archive -Path 'background.js','LICENSE','manifest.json','popup.css','popup.html','popup.js','README.md' -DestinationPath 'firefox-auto-refresh-tab.zip' -Force; Rename-Item 'firefox-auto-refresh-tab.zip' 'firefox-auto-refresh-tab.xpi'"
