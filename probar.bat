@echo off
cd /d "%~dp0"
echo Version en la nube (prueba local, sin Supabase) en http://localhost:8781/prueba.html
echo Usuario de prueba: prueba@local.test   Contrasena: prueba
start "" http://localhost:8781/prueba.html
python -m http.server 8781 --bind 127.0.0.1 -d app
pause
