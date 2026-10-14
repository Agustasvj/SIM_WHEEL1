#!/usr/bin/env bash
set -e

echo "Building VForce (Linux) ..."

# ── 1. Check virtual environment ──────────────────────────────────────────────
if [ ! -f "venv/bin/python" ]; then
    echo ""
    echo "  Virtual environment not found."
    echo "  Run these commands first:"
    echo "    python3 -m venv venv"
    echo "    source venv/bin/activate"
    echo "    pip install -r requirements_linux.txt"
    echo ""
    exit 1
fi

# ── 2. Make sure uinput module is loaded ──────────────────────────────────────
if ! lsmod | grep -q "^uinput"; then
    echo "  Loading uinput kernel module (requires sudo)..."
    sudo modprobe uinput
fi

# ── 3. Install / update dependencies ─────────────────────────────────────────
echo "Installing dependencies..."
./venv/bin/python -m pip install -r requirements_linux.txt --quiet

# ── 4. Build with PyInstaller ────────────────────────────────────────────────
echo "Running PyInstaller..."
./venv/bin/python -m PyInstaller SIM_WHEEL_linux.spec --noconfirm --clean

echo ""
echo "Build complete!  Binary is at:  dist/VForce"
echo ""
echo "Before running, make sure your user can write to /dev/uinput:"
echo "  sudo usermod -aG input \$USER    # then log out and back in"
echo "  # or for a one-time session:"
echo "  sudo chmod 660 /dev/uinput && sudo chown root:input /dev/uinput"
