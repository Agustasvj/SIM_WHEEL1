import json
import socket
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from controller import SimController
from telemetry import ACTelemetry
import uvicorn
import os
import sys
import threading
import shutil
import signal
import webview
import datetime
import ipaddress

PLATFORM = sys.platform


def show_error_dialog(title: str, message: str):
    """Show a native error dialog — ctypes on Windows, tkinter on Linux."""
    if PLATFORM == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
    else:
        try:
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw()  # Hide the empty root window
            messagebox.showerror(title, message)
            root.destroy()
        except Exception:
            # Fallback: print to stderr if tkinter is unavailable
            print(f"[ERROR] {title}: {message}", file=sys.stderr)

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

# Fix for Uvicorn crashing when console=False in PyInstaller (sys.stdout is None)
if sys.stdout is None:
    class DummyStream:
        def write(self, *args, **kwargs): pass
        def flush(self, *args, **kwargs): pass
        def isatty(self): return False
    sys.stdout = DummyStream()
    sys.stderr = DummyStream()

# Determine the base directory for resources
if hasattr(sys, '_MEIPASS'):
    BASE_DIR = sys._MEIPASS
    USER_DIR = os.path.dirname(sys.executable)  # Next to the built executable
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    USER_DIR = BASE_DIR # In the dev folder

PACKAGES_DIR = os.path.join(USER_DIR, "packages")
STEERING_DIR = os.path.join(PACKAGES_DIR, "Steering")
PEDALS_DIR = os.path.join(PACKAGES_DIR, "Pedals")
BG_DIR = os.path.join(PACKAGES_DIR, "Background")

PROFILE_FILE = os.path.join(USER_DIR, "profiles.json")
SSL_CERT_FILE = os.path.join(USER_DIR, "vforce_cert.pem")
SSL_KEY_FILE  = os.path.join(USER_DIR, "vforce_key.pem")


def generate_self_signed_cert():
    """Generate a self-signed SSL certificate valid for 10 years."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    # Generate private key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    local_ip = get_local_ip()
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"VForce Local"),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName(u"localhost"),
                x509.IPAddress(ipaddress.ip_address(local_ip)),
                x509.IPAddress(ipaddress.ip_address(u"127.0.0.1")),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    with open(SSL_CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(SSL_KEY_FILE, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
    print("SSL certificate generated.")

DEFAULT_PROFILES = {
    "active_profile": "default",
    "profiles": {
        "default": {
            "name": "Default Racing",
            "mode": "driving",
            "max_steering_angle": 180,
            "elements": [
                { "id": "el_1", "type": "pedal-gas", "x": 80, "y": 30, "width": 10, "height": 60, "text": "GAS" },
                { "id": "el_2", "type": "pedal-brake", "x": 10, "y": 30, "width": 10, "height": 60, "text": "BRK" },
                { "id": "el_3", "type": "steering-wheel", "x": 35, "y": 40, "width": 30, "height": 30, "text": "WHEEL" }
            ],
            "mappings": {
                "el_1": {"output": "RIGHT_TRIGGER"},
                "el_2": {"output": "LEFT_TRIGGER"},
                "el_3": {"output": "LEFT_STICK_X"}
            }
        },
        "default_flight": {
            "name": "Default Flight",
            "mode": "flight",
            "max_steering_angle": 180,
            "elements": [
                { "id": "el_f1", "type": "throttle-1", "x": 10, "y": 30, "width": 10, "height": 60, "text": "THR" },
                { "id": "el_f2", "type": "rudder", "x": 35, "y": 80, "width": 30, "height": 10, "text": "RUDDER" },
                { "id": "el_f3", "type": "yoke", "x": 35, "y": 30, "width": 30, "height": 30, "text": "YOKE" }
            ],
            "mappings": {
                "el_f1": {"output": "LEFT_TRIGGER"},
                "el_f2": {"output": "RIGHT_STICK_X"},
                "el_f3_x": {"output": "RIGHT_STICK_X"},
                "el_f3_y": {"output": "RIGHT_STICK_Y"}
            }
        }
    }
}

def load_profiles():
    if os.path.exists(PROFILE_FILE):
        try:
            with open(PROFILE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return DEFAULT_PROFILES
    return DEFAULT_PROFILES

def save_profiles(data):
    with open(PROFILE_FILE, "w") as f:
        json.dump(data, f, indent=2)

profiles_data = load_profiles()

_lifespan_started = False  # Guard: only init once across both uvicorn instances

@asynccontextmanager
async def lifespan(app: FastAPI):
    global sim_controller, _lifespan_started

    if not _lifespan_started:
        _lifespan_started = True

        sim_controller = SimController(profiles_data)

        # Setup Packages Directory
        os.makedirs(STEERING_DIR, exist_ok=True)
        os.makedirs(PEDALS_DIR, exist_ok=True)
        os.makedirs(BG_DIR, exist_ok=True)

        # Copy default assets if they exist in static
        default_wheels = ["scania_wheel.png", "volvo_wheel.png"]
        for w in default_wheels:
            src = os.path.join(BASE_DIR, "static", w)
            dst = os.path.join(STEERING_DIR, w)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy(src, dst)

        pedal_src = os.path.join(BASE_DIR, "static", "pedal_plate.png")
        pedal_dst = os.path.join(PEDALS_DIR, "pedal_plate.png")
        if os.path.exists(pedal_src) and not os.path.exists(pedal_dst):
            shutil.copy(pedal_src, pedal_dst)

        print("Package directories initialized.")

        # Start telemetry broadcast loop
        task = asyncio.create_task(telemetry_loop())
        yield
        task.cancel()
    else:
        # Second uvicorn instance (HTTPS) — skip re-initialization
        yield

app = FastAPI(lifespan=lifespan)

sim_controller = None

# Mount the static directory for CSS/JS
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

# Make sure packages directory exists before mounting to avoid errors
os.makedirs(PACKAGES_DIR, exist_ok=True)
app.mount("/packages", StaticFiles(directory=PACKAGES_DIR), name="packages")

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.get("/api/profiles")
async def get_profiles():
    return profiles_data

@app.post("/api/profiles")
async def update_profiles(request: Request):
    global profiles_data
    data = await request.json()
    profiles_data = data
    save_profiles(profiles_data)
    if sim_controller:
        sim_controller.update_profiles(profiles_data)
    return {"status": "success"}

@app.get("/")
async def get_root():
    try:
        with open(os.path.join(BASE_DIR, "static/index.html"), "r", encoding="utf-8") as f:
            html = f.read()
        return HTMLResponse(html)
    except FileNotFoundError:
        return HTMLResponse("<h1>static/index.html not found.</h1>", status_code=404)

@app.get("/Driving")
async def get_pc_driving():
    try:
        with open(os.path.join(BASE_DIR, "static/pc.html"), "r", encoding="utf-8") as f:
            html = f.read()
        return HTMLResponse(html)
    except FileNotFoundError:
        return HTMLResponse("<h1>static/pc.html not found.</h1>", status_code=404)

@app.get("/Flight")
async def get_pc_flight():
    try:
        with open(os.path.join(BASE_DIR, "static/pc.html"), "r", encoding="utf-8") as f:
            html = f.read()
        return HTMLResponse(html)
    except FileNotFoundError:
        return HTMLResponse("<h1>static/pc.html not found.</h1>", status_code=404)

@app.get("/mobile")
async def get_mobile():
    try:
        with open(os.path.join(BASE_DIR, "static/mobile.html"), "r", encoding="utf-8") as f:
            html = f.read()
        return HTMLResponse(html)
    except FileNotFoundError:
        return HTMLResponse("<h1>static/mobile.html not found.</h1>", status_code=404)

@app.get("/api/packages")
def get_packages():
    def get_files(d):
        if not os.path.exists(d):
            return []
        return [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))]

    return {
        "steering": get_files(STEERING_DIR),
        "pedals": get_files(PEDALS_DIR),
        "background": get_files(BG_DIR)
    }

@app.get("/api/network")
def get_network_info():
    return {"ip": get_local_ip(), "port": 8443, "protocol": "https"}

@app.post("/api/shutdown")
def shutdown_server():
    # Gracefully shut down the current process
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting down"}

active_websockets = set()

# Telemetry broadcast loop (started inside lifespan)

async def telemetry_loop():
    telemetry = ACTelemetry()
    while True:
        await asyncio.sleep(1/60.0)
        data = telemetry.get_data()
        if data and active_websockets:
            msg = json.dumps({"type": "telemetry", "data": data})
            for ws in list(active_websockets):
                try:
                    await ws.send_text(msg)
                except Exception:
                    pass

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    print("Client connected.")
    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
                if sim_controller:
                    sim_controller.process_input(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
        print("Client disconnected.")

def run_http_server(port):
    """Plain HTTP server bound to localhost only — for the pywebview PC dashboard."""
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )

def run_https_server(port, ssl_certfile, ssl_keyfile):
    """HTTPS server bound to all interfaces — for mobile phones on LAN.
    Uses SelectorEventLoop for stable SSL handling across all platforms.
    (On Windows with Python 3.12+, ProactorEventLoop has a known SSL bug;
     SelectorEventLoop avoids it. On Linux this is a no-op since Selector
     is already the default.)
    """
    import selectors
    selector = selectors.SelectSelector()
    loop = asyncio.SelectorEventLoop(selector)
    asyncio.set_event_loop(loop)

    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=port,
        log_level="warning",
        ssl_certfile=ssl_certfile,
        ssl_keyfile=ssl_keyfile,
        loop="none",  # Don't let uvicorn override our SelectorEventLoop
    )
    server = uvicorn.Server(config)
    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()

if __name__ == "__main__":
    http_port  = 8000  # PC dashboard (localhost only, plain HTTP)
    https_port = 8443  # Mobile phones (LAN, HTTPS — required for tilt steering)
    
    # Check if either port is already taken (VForce already running)
    if is_port_in_use(http_port) or is_port_in_use(https_port):
        message = (
            "VForce is already running in the background!\n\n"
            "Please open http://localhost:8000 in your browser to configure or shut it down.\n"
            "(If you cannot access the dashboard, kill the VForce process via your system's task manager)"
        )
        show_error_dialog("VForce Error", message)
        sys.exit(1)

    # Generate SSL cert if it doesn't exist yet, or if the local IP has changed
    def cert_covers_current_ip():
        """Return True if the existing cert's SANs include the current local IP."""
        try:
            from cryptography import x509
            with open(SSL_CERT_FILE, "rb") as f:
                cert = x509.load_pem_x509_certificate(f.read())
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
            current_ip = ipaddress.ip_address(get_local_ip())
            return current_ip in san.value.get_values_for_type(x509.IPAddress)
        except Exception:
            return False  # If anything goes wrong, regenerate to be safe

    if not os.path.exists(SSL_CERT_FILE) or not os.path.exists(SSL_KEY_FILE):
        print("Generating self-signed SSL certificate for HTTPS (needed for tilt steering)...")
        generate_self_signed_cert()
    elif not cert_covers_current_ip():
        print("Local IP has changed — regenerating SSL certificate...")
        generate_self_signed_cert()

    local_ip = get_local_ip()
    print("\n" + "="*60)
    print(f"Server started successfully!")
    print(f"PC Dashboard :  http://localhost:{http_port}/")
    print(f"Phone (Mobile): https://{local_ip}:{https_port}/mobile")
    print(f"  NOTE: Accept the certificate warning in your phone browser once.")
    print("="*60 + "\n")
    
    # Start the plain HTTP server (localhost only) for the PC dashboard
    http_thread = threading.Thread(target=run_http_server, args=(http_port,))
    http_thread.daemon = True
    http_thread.start()

    # Start the HTTPS server (all interfaces) for mobile phones
    https_thread = threading.Thread(
        target=run_https_server,
        args=(https_port, SSL_CERT_FILE, SSL_KEY_FILE)
    )
    https_thread.daemon = True
    https_thread.start()
    
    # Launch the native PC GUI window over plain HTTP (localhost = secure context)
    # Force Qt backend on Linux to skip the GTK probe; on Windows pywebview auto-detects.
    gui_backend = None if PLATFORM == "win32" else "qt"
    webview.create_window("VForce V 2.0 BETA", f"http://localhost:{http_port}/", width=1024, height=768)
    webview.start(gui=gui_backend)
