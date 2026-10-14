@echo off
echo Building VForce V 1.0 BETA...
if not exist venv\Scripts\python.exe (
    echo Virtual environment not found. Please setup venv first.
    pause
    exit /b 1
)

echo Installing dependencies...
.\venv\Scripts\python.exe -m pip install -r requirements.txt

echo Running PyInstaller...
.\venv\Scripts\python.exe -m PyInstaller SIM_WHEEL.spec --noconfirm --clean

echo Build complete! Your updated .exe is inside the "dist" folder.
pause
