// State
let ws = null;
let isConnected = false;
let activeProfileData = null;

let sendInterval = null;
let inputState = {
  axes: {},
  buttons: {}
};

let liveTelemetry = {
  speed: 0,
  ffb: 0
};

// Tilt-to-steer state
let tiltEnabled = false;
let tiltOffset = 0; // calibration offset in degrees (gamma at the moment tilt was enabled)
let tiltSensitivity = 1.5;

// DOM Elements
const screens = {
  setup: document.getElementById('setup-screen'),
  driving: document.getElementById('driving-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'driving') {
    startDriving();
  } else {
    stopDriving();
  }
}

async function fetchProfile() {
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    const activeId = data.active_profile;
    activeProfileData = data.profiles[activeId];
  } catch (e) {
    console.error("Failed to fetch profile", e);
  }
}

// WebSocket Connection
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    isConnected = true;
    document.getElementById('status-dot').classList.add('connected');
    document.getElementById('status-text').innerText = 'Connected';
  };

  ws.onclose = () => {
    isConnected = false;
    document.getElementById('status-dot').classList.remove('connected');
    document.getElementById('status-text').innerText = 'Disconnected';
    setTimeout(connectWS, 2000);
  };
  
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'telemetry') {
        liveTelemetry = msg.data;
      }
    } catch(err) {}
  };
}

// Setup Screen
document.getElementById('btn-start').onclick = async () => {
  // Request iOS 13+ permissions for gyro/orientation
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState !== 'granted') {
        console.warn("DeviceOrientation permission not granted");
      }
    } catch(err) { console.error(err); }
  }

  await fetchProfile();
  
  if (!activeProfileData) {
    alert("Could not load profile from PC.");
    return;
  }

  // ── Request fullscreen from within the user-gesture handler so browsers allow it ──
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
  } catch(e) { console.warn('Fullscreen request failed:', e); }

  // ── Lock orientation to landscape (stays locked until X button unlocks it) ──
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch(e) { console.warn('Orientation lock failed:', e); }

  showScreen('driving');
};

// Driving Logic
const driveCanvas = document.getElementById('drive-canvas');
let steeringAngle = 0; // accumulated angle in degrees
let lastTimestamp = 0;

function startDriving() {
  if (typeof window.DeviceMotionEvent !== 'undefined' && typeof window.DeviceMotionEvent.requestPermission === 'function') {
    window.DeviceMotionEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          initDrivingSensors();
        } else {
          initDrivingSensors();
        }
      })
      .catch(e => {
        console.error(e);
        initDrivingSensors();
      });
  } else {
    initDrivingSensors();
  }
}

function initDrivingSensors() {
  // Setup UI
  driveCanvas.innerHTML = '';
  // Set custom background if available
  if (activeProfileData.bg_style) {
    document.body.style.backgroundImage = `url('/packages/Background/${activeProfileData.bg_style}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
  } else {
    document.body.style.backgroundImage = 'none';
  }

  activeProfileData.elements.forEach(el => {
    const div = document.createElement('div');
    div.className = `drive-element ${el.type}`;
    div.dataset.type = el.type;
    div.id = el.id;
    div.style.left = el.x + '%';
    div.style.top = el.y + '%';
    div.style.width = el.width + '%';
    div.style.height = el.height + '%';
    if (el.type.startsWith('pedal-')) {
      const pedalImg = activeProfileData.pedal_style;
      const imgUrl = pedalImg ? `/packages/Pedals/${pedalImg}` : '/static/pedal_plate.png';
      
      const track = document.createElement('div');
      track.className = 'pedal-track';
      div.appendChild(track);
      
      const thumb = document.createElement('div');
      thumb.className = 'pedal-thumb';
      thumb.style.backgroundImage = `url('${imgUrl}')`;
      div.appendChild(thumb);
      
      const textNode = document.createElement('span');
      textNode.innerText = el.text;
      textNode.className = 'pedal-label';
      div.appendChild(textNode);
    } else if (el.type === 'steering-wheel') {
      const wheelImg = activeProfileData.wheel_style;
      const imgUrl = wheelImg ? `/packages/Steering/${wheelImg}` : '/static/scania_wheel.png';
      div.innerHTML = `
        <img src="${imgUrl}" class="svg-wheel" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;" />
      `;
    } else if (el.type === 'joystick') {
      div.innerHTML = `
        <div class="joystick-base" style="width: 100%; height: 100%; border-radius: 50%; border: 2px solid var(--primary); position: relative; box-sizing: border-box;">
          <div class="joystick-thumb" style="width: 40%; height: 40%; background: var(--primary); border-radius: 50%; position: absolute; top: 30%; left: 30%; pointer-events: none;"></div>
        </div>
      `;
    } else if (el.type === 'yoke') {
      div.innerHTML = `
        <div class="yoke-base" style="width: 100%; height: 100%; border-radius: 10px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4);">
          <div class="yoke-thumb" style="width: 30%; height: 30%; background: var(--primary); border-radius: 5px; position: absolute; top: 35%; left: 35%; pointer-events: none; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8em;">YOKE</div>
        </div>
      `;
    } else if (el.type === 'rudder') {
      div.innerHTML = `
        <div class="rudder-base" style="width: 100%; height: 100%; border-radius: 5px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4);">
          <div class="rudder-thumb" style="width: 20%; height: 100%; background: var(--primary); border-radius: 3px; position: absolute; top: 0; left: 40%; pointer-events: none;"></div>
        </div>
      `;
    } else if (el.type.startsWith('throttle-')) {
      div.innerHTML = `
        <div class="throttle-base" style="width: 100%; height: 100%; border-radius: 5px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4);">
          <div class="throttle-thumb" style="width: 100%; height: 20%; background: var(--primary); border-radius: 3px; position: absolute; bottom: 0; left: 0; pointer-events: none;"></div>
        </div>
      `;
      // Initialize throttle value to 0 if not present
      if (!(el.id in currentThrottleValues)) {
        currentThrottleValues[el.id] = 0.0;
      }
    } else {
      div.innerText = el.text;
    }
    
    driveCanvas.appendChild(div);
  });

  // Fullscreen is already requested in the btn-start click handler (user gesture).
  // Nothing extra needed here.

  // Reset state
  steeringAngle = 0;
  lastTimestamp = 0;
  currentWheelRotation = 0;
  
  // Touch Loop
  driveCanvas.addEventListener('touchstart', handleTouches, {passive: false});
  driveCanvas.addEventListener('touchmove', handleTouches, {passive: false});
  driveCanvas.addEventListener('touchend', handleTouches, {passive: false});
  driveCanvas.addEventListener('touchcancel', handleTouches, {passive: false});

  // Auto-enable tilt if profile requests it
  tiltSensitivity = activeProfileData.tilt_sensitivity !== undefined ? activeProfileData.tilt_sensitivity : 1.5;
  if (activeProfileData.tilt_enabled) {
    enableTilt();
  }

  updateHUD();

  // Start send loop (60Hz)
  sendInterval = setInterval(sendInputState, 1000 / 60);
}

function stopDriving() {
  clearInterval(sendInterval);
  disableTilt();
  // Fullscreen + orientation unlock are handled by the X button handler below,
  // NOT here, so that other callers of stopDriving don't accidentally unlock.
}

document.getElementById('btn-exit').onclick = async () => {
  // ── Unlock orientation ONLY when the user explicitly exits the driving screen ──
  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch(e) { console.warn('Orientation unlock failed:', e); }

  // ── Exit fullscreen ──
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch(e) { console.warn('Exit fullscreen failed:', e); }

  showScreen('setup');
};
document.getElementById('btn-recenter').onclick = () => {
  if (tiltEnabled) {
    // Re-calibrate tilt center
    calibrateTilt();
  } else {
    steeringAngle = 0;
    currentWheelRotation = 0;
    updateHUD();
  }
};

// Tilt toggle button
document.getElementById('btn-tilt').onclick = () => {
  if (tiltEnabled) {
    disableTilt();
  } else {
    enableTilt();
  }
};

// ─── Tilt-to-Steer ───────────────────────────────────────────────────────────

function calibrateTilt() {
  // Will be set on next orientation event
  tiltOffset = null;
}

function enableTilt() {
  tiltEnabled = true;
  tiltOffset = null; // calibrate on first event
  window.addEventListener('deviceorientation', handleTilt, true);
  const btn = document.getElementById('btn-tilt');
  if (btn) {
    btn.classList.add('tilt-active');
    btn.innerText = '📱 Tilt ON';
  }
}

function disableTilt() {
  tiltEnabled = false;
  window.removeEventListener('deviceorientation', handleTilt, true);
  const btn = document.getElementById('btn-tilt');
  if (btn) {
    btn.classList.remove('tilt-active');
    btn.innerText = '📱 Tilt';
  }
}

function getOrientationAngle() {
  // screen.orientation.angle: 0 = portrait, 90 = landscape CW, 270/-90 = landscape CCW
  if (screen.orientation && screen.orientation.angle !== undefined) {
    return screen.orientation.angle;
  }
  // Fallback for older browsers
  if (typeof window.orientation === 'number') {
    return window.orientation;
  }
  return 0;
}

function getLandscapeTiltValue(e) {
  // DeviceOrientationEvent axes are always relative to portrait (Earth frame).
  // In landscape the phone is rotated 90°, so the left/right steering axis
  // maps to 'beta' (front/back in portrait) instead of 'gamma' (left/right in portrait).
  //
  //  Orientation angle  | Steering axis
  //  -------------------|---------------
  //  0   (portrait)     | gamma  (no change)
  //  90  (landscape CW) | -beta  (negate because CW rotation flips the sign)
  //  270 (landscape CCW)| +beta
  //  180 (portrait flip)| -gamma

  const angle = ((getOrientationAngle() % 360) + 360) % 360; // normalise to 0-359

  if (angle === 90) {
    return -(e.beta || 0);   // landscape, rotated clockwise
  } else if (angle === 270) {
    return  (e.beta || 0);   // landscape, rotated counter-clockwise
  } else if (angle === 180) {
    return -(e.gamma || 0);  // portrait upside-down
  } else {
    return  (e.gamma || 0);  // normal portrait (0°)
  }
}

function handleTilt(e) {
  if (!tiltEnabled || !activeProfileData) return;

  const tiltValue = getLandscapeTiltValue(e);
  if (tiltValue === null || tiltValue === undefined) return;

  // Calibrate on first event after enabling (stores current tilt as neutral/center)
  if (tiltOffset === null) {
    tiltOffset = tiltValue;
    return;
  }

  const MAX_ROTATION = activeProfileData.max_steering_angle || 180;
  // Apply sensitivity and optional invert
  const invert = activeProfileData.tilt_inverted ? -1 : 1;
  const rawDelta = (tiltValue - tiltOffset) * tiltSensitivity * invert;
  currentWheelRotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, rawDelta));
  steeringAngle = currentWheelRotation;

  const normalizedSteering = currentWheelRotation / MAX_ROTATION;

  // Update steering wheel visuals and input state
  const steeringEl = document.querySelector('.steering-wheel');
  if (steeringEl) {
    inputState.axes[steeringEl.id] = normalizedSteering;
    const svg = steeringEl.querySelector('.svg-wheel');
    if (svg) svg.style.transform = `rotate(${currentWheelRotation}deg)`;
  }

  updateHUD();
}


// ─── HUD Update ──────────────────────────────────────────────────────────────

function updateHUD() {
  const hudSteering = document.getElementById('hud-steering');
  const hudRotations = document.getElementById('hud-rotations');
  if (hudSteering) {
    const deg = Math.round(currentWheelRotation);
    const sign = deg > 0 ? '+' : '';
    hudSteering.innerText = `${sign}${deg}°`;
  }
  if (hudRotations) {
    const rotations = (Math.abs(currentWheelRotation) / 360).toFixed(2);
    hudRotations.innerText = `${rotations} rot${tiltEnabled ? ' · 📱' : ''}`;
  }
}

// ─── Touch Handling ───────────────────────────────────────────────────────────

let activeTouches = {};
let currentThrottleValues = {};
let currentWheelRotation = 0;
let lastTouchAngle = 0;
let isSteeringTouched = false;
let steeringTouchId = null;

function handleTouches(e) {
  e.preventDefault(); // Prevent scrolling
  
  // 1. Clean up removed touches
  const currentTouchIds = Array.from(e.touches).map(t => t.identifier);
  Object.keys(activeTouches).forEach(idStr => {
    const id = parseInt(idStr);
    if (!currentTouchIds.includes(id)) {
      const touchData = activeTouches[id];
      if (touchData.el) {
        touchData.el.classList.remove('active');
        if (touchData.type.startsWith('pedal-')) {
          const thumb = touchData.el.querySelector('.pedal-thumb');
          if (thumb) thumb.style.bottom = '0%';
        } else if (touchData.type === 'joystick' || touchData.type === 'yoke') {
          const thumbClass = touchData.type === 'yoke' ? '.yoke-thumb' : '.joystick-thumb';
          const thumb = touchData.el.querySelector(thumbClass);
          if (thumb) thumb.style.transform = `translate(0px, 0px)`;
        } else if (touchData.type === 'rudder') {
          const thumb = touchData.el.querySelector('.rudder-thumb');
          if (thumb) thumb.style.left = '40%';

        }
      }
      if (id === steeringTouchId) {
        isSteeringTouched = false;
        steeringTouchId = null;
      }
      delete activeTouches[id];
    }
  });

  // Reset input state for this frame (except persistent ones like throttles)
  inputState.buttons = {};
  inputState.axes = {};
  
  // Re-apply throttles
  Object.keys(currentThrottleValues).forEach(id => {
    inputState.axes[id] = currentThrottleValues[id];
  });

  // 2. Process active touches
  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    
    // Assign touch to element if not already assigned
    if (!activeTouches[t.identifier]) {
      let target = document.elementFromPoint(t.clientX, t.clientY);
      if (target) target = target.closest('.drive-element');
      if (target) {
        const type = target.dataset.type;
        
        // Prevent multiple touches on the same steering wheel
        if (type === 'steering-wheel' && steeringTouchId !== null) {
          continue;
        }

        // If tilt mode is on, ignore touches on the steering wheel
        if (tiltEnabled && type === 'steering-wheel') {
          continue;
        }

        activeTouches[t.identifier] = {
          el: target,
          type: type,
          startX: t.clientX,
          startY: t.clientY
        };
        target.classList.add('active');

        if (type === 'steering-wheel') {
          steeringTouchId = t.identifier;
          isSteeringTouched = true;
          const rect = target.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          lastTouchAngle = Math.atan2(t.clientY - centerY, t.clientX - centerX) * 180 / Math.PI;
        }
      }
    }

    // Process mapped touch
    const touchData = activeTouches[t.identifier];
    if (touchData) {
      const el = touchData.el;
      const type = touchData.type;
      const rect = el.getBoundingClientRect();
      
      if (type === 'steering-wheel') {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let angleDeg = Math.atan2(t.clientY - centerY, t.clientX - centerX) * 180 / Math.PI;
        
        let deltaAngle = angleDeg - lastTouchAngle;
        if (deltaAngle > 180) deltaAngle -= 360;
        if (deltaAngle < -180) deltaAngle += 360;
        
        currentWheelRotation += deltaAngle;
        lastTouchAngle = angleDeg;
        
        const MAX_ROTATION = activeProfileData.max_steering_angle || 180;
        currentWheelRotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, currentWheelRotation));
        steeringAngle = currentWheelRotation; 
        
        let normalizedSteering = currentWheelRotation / MAX_ROTATION;
        inputState.axes[el.id] = normalizedSteering;
        
        const svg = el.querySelector('.svg-wheel');
        if (svg) svg.style.transform = `rotate(${currentWheelRotation}deg)`;

        updateHUD();
      } 
      else if (type === 'joystick' || type === 'yoke') {
        const radiusX = rect.width / 2;
        const radiusY = rect.height / 2;
        
        let dx = t.clientX - touchData.startX;
        let dy = t.clientY - touchData.startY;
        
        // Elliptical boundary constraint
        const normDist = Math.sqrt((dx*dx)/(radiusX*radiusX) + (dy*dy)/(radiusY*radiusY));
        if (normDist > 1) {
          dx = dx / normDist;
          dy = dy / normDist;
        }
        
        let normX = dx / radiusX;
        let normY = dy / radiusY;
        
        // Apply an aggressive square-root curve to overcome game deadzones 
        let rawDist = Math.sqrt(normX*normX + normY*normY);
        if (rawDist > 0.01) {
          let curvedDist = Math.pow(rawDist, 0.5);
          normX = (normX / rawDist) * curvedDist;
          normY = (normY / rawDist) * curvedDist;
        }
        
        inputState.axes[el.id + '_x'] = normX;
        inputState.axes[el.id + '_y'] = -normY; // Invert so Up is positive Y
        
        const thumbClass = type === 'yoke' ? '.yoke-thumb' : '.joystick-thumb';
        const thumb = el.querySelector(thumbClass);
        if (thumb) {
          thumb.style.transform = `translate(${dx}px, ${dy}px)`;
        }
      }
      else if (type === 'rudder') {
        const radius = rect.width / 2;
        let dx = t.clientX - touchData.startX;
        
        if (dx > radius) dx = radius;
        if (dx < -radius) dx = -radius;
        
        let normX = dx / radius;
        inputState.axes[el.id] = normX;
        
        const thumb = el.querySelector('.rudder-thumb');
        if (thumb) {
          // base is 100%, thumb is 20%. Center is 40%.
          let centerPct = 40;
          let offsetPct = (dx / radius) * 40; // max shift is +/- 40%
          thumb.style.left = (centerPct + offsetPct) + '%';
        }
      }
      else if (type.startsWith('button-')) {
        inputState.buttons[el.id] = true;
      } 
      else if (type.startsWith('pedal-')) {
        let value = 1.0 - ((t.clientY - rect.top) / rect.height);
        value = Math.max(0.0, Math.min(1.0, value));
        
        const thumb = el.querySelector('.pedal-thumb');
        if (thumb) thumb.style.bottom = (value * (100 - 40)) + '%'; // 40 is the thumb height %
        
        inputState.axes[el.id] = value;
      }
      else if (type.startsWith('throttle-')) {
        let value = 1.0 - ((t.clientY - rect.top) / rect.height);
        value = Math.max(0.0, Math.min(1.0, value));
        
        const thumb = el.querySelector('.throttle-thumb');
        if (thumb) thumb.style.bottom = (value * (100 - 20)) + '%'; // 20 is the thumb height %
        
        currentThrottleValues[el.id] = value;
        inputState.axes[el.id] = value;
      }
    }
  }
}

function sendInputState() {
  // In tilt mode the tilt handler drives currentWheelRotation directly,
  // so skip the touch-based return-to-center logic for steering.
  if (!tiltEnabled && !isSteeringTouched && currentWheelRotation !== 0) {
    let returnSpeed = activeProfileData.return_speed !== undefined ? activeProfileData.return_speed : 5; 
    
    // Dynamic FFB Integration:
    if (Math.abs(liveTelemetry.speed) > 1) {
      let ffbForce = liveTelemetry.ffb * 20; // Scale the raw force
      currentWheelRotation += ffbForce;
      
      let speedFactor = Math.min(Math.abs(liveTelemetry.speed) / 50.0, 1.0); // max out at 50kmh
      let dynamicStep = returnSpeed * speedFactor;
      
      if (currentWheelRotation > 0) {
        currentWheelRotation -= dynamicStep;
        if (currentWheelRotation < 0) currentWheelRotation = 0;
      } else {
        currentWheelRotation += dynamicStep;
        if (currentWheelRotation > 0) currentWheelRotation = 0;
      }
    } else {
      let step = returnSpeed;
      if (Math.abs(currentWheelRotation) < step) {
        step = Math.abs(currentWheelRotation);
      }
      if (currentWheelRotation > 0) {
        currentWheelRotation -= step;
        if (currentWheelRotation < 0) currentWheelRotation = 0;
      } else {
        currentWheelRotation += step;
        if (currentWheelRotation > 0) currentWheelRotation = 0;
      }
    }
    
    // We only update the visual wheel and output if no touches are active
    const MAX_ROTATION = activeProfileData.max_steering_angle || 180;
    currentWheelRotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, currentWheelRotation));
    steeringAngle = currentWheelRotation;
    
    let normalizedSteering = currentWheelRotation / MAX_ROTATION;
    
    const steeringEl = document.querySelector('.steering-wheel');
    if (steeringEl) {
      inputState.axes[steeringEl.id] = normalizedSteering;
      const svg = steeringEl.querySelector('.svg-wheel');
      if (svg) svg.style.transform = `rotate(${currentWheelRotation}deg)`;
    }

    updateHUD();
  }

  // Keep tilt steering axis updated in input state every frame
  if (tiltEnabled) {
    const MAX_ROTATION = activeProfileData.max_steering_angle || 180;
    const normalizedSteering = currentWheelRotation / MAX_ROTATION;
    const steeringEl = document.querySelector('.steering-wheel');
    if (steeringEl) {
      inputState.axes[steeringEl.id] = normalizedSteering;
    }
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(inputState));
  }
}

// Init
connectWS();
