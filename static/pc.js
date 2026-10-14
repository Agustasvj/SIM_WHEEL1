let profilesData = {};
let currentProfileId = '';
const simMode = window.location.pathname.includes('Flight') ? 'flight' : 'driving';

const xboxOutputs = [
  "LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y",
  "LEFT_TRIGGER", "RIGHT_TRIGGER",
  "BUTTON_A", "BUTTON_B", "BUTTON_X", "BUTTON_Y",
  "BUTTON_LB", "BUTTON_RB", "BUTTON_BACK", "BUTTON_START",
  "BUTTON_L3", "BUTTON_R3",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"
];

let packageData = { steering: [], pedals: [], background: [] };

async function loadData() {
  try {
    const netRes = await fetch('/api/network');
    const netData = await netRes.json();
    const proto = netData.protocol || 'https';
    document.getElementById('connect-url').innerText = `${proto}://${netData.ip}:${netData.port}/mobile`;
  } catch (e) {
    document.getElementById('connect-url').innerText = `https://${window.location.host}/mobile`;
  }
  
  // Fetch packages
  try {
    const pkgRes = await fetch('/api/packages');
    packageData = await pkgRes.json();
    populatePackageDropdowns();
  } catch (e) {
    console.error("Failed to load packages", e);
  }

  const res = await fetch('/api/profiles');
  profilesData = await res.json();
  currentProfileId = profilesData.active_profile;
  renderProfileSelect();
  loadProfile(currentProfileId);
}

function populatePackageDropdowns() {
  const wheelSel = document.getElementById('prof-wheel-style');
  wheelSel.innerHTML = '<option value="">Default Steering</option>';
  packageData.steering.forEach(f => {
    wheelSel.innerHTML += `<option value="${f}">${f}</option>`;
  });

  const pedalSel = document.getElementById('prof-pedal-style');
  pedalSel.innerHTML = '<option value="">Default Pedals</option>';
  packageData.pedals.forEach(f => {
    pedalSel.innerHTML += `<option value="${f}">${f}</option>`;
  });

  const bgSel = document.getElementById('prof-bg-style');
  bgSel.innerHTML = '<option value="">None (Solid Color)</option>';
  packageData.background.forEach(f => {
    bgSel.innerHTML += `<option value="${f}">${f}</option>`;
  });
}

function renderProfileSelect() {
  const select = document.getElementById('profile-select');
  select.innerHTML = '';
  
  // Set up elements dropdown based on mode
  const elSelect = document.getElementById('element-type');
  if (elSelect) {
    if (simMode === 'flight') {
      elSelect.innerHTML = `
        <option value="yoke">Yoke</option>
        <option value="rudder">Rudder</option>
        <option value="throttle-1">Throttle 1</option>
        <option value="throttle-2">Throttle 2</option>
        <option value="throttle-3">Throttle 3</option>
        <option value="throttle-4">Throttle 4</option>
        <option value="button-A">Button A</option>
        <option value="button-B">Button B</option>
        <option value="button-X">Button X</option>
        <option value="button-Y">Button Y</option>
      `;
    } else {
      elSelect.innerHTML = `
        <option value="steering-wheel">Steering Wheel</option>
        <option value="joystick">Analogue Joystick</option>
        <option value="pedal-gas">Gas Pedal</option>
        <option value="pedal-brake">Brake Pedal</option>
        <option value="pedal-clutch">Clutch Pedal</option>
        <option value="button-A">Button A</option>
        <option value="button-B">Button B</option>
        <option value="button-X">Button X</option>
        <option value="button-Y">Button Y</option>
      `;
    }
  }

  // Find first valid profile if current is invalid for this mode
  let validProfileIds = Object.keys(profilesData.profiles).filter(id => {
    let mode = profilesData.profiles[id].mode;
    if (!mode) mode = 'driving'; // default legacy profiles to driving
    return mode === simMode;
  });

  if (validProfileIds.length === 0) {
    // Create a default if none exists for this mode
    const newId = 'prof_' + Date.now();
    profilesData.profiles[newId] = {
      name: 'Default ' + (simMode === 'flight' ? 'Flight' : 'Racing'),
      mode: simMode,
      max_steering_angle: 180,
      elements: [],
      mappings: {}
    };
    validProfileIds.push(newId);
  }

  if (!validProfileIds.includes(currentProfileId)) {
    currentProfileId = validProfileIds[0];
    profilesData.active_profile = currentProfileId;
  }

  validProfileIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.innerText = profilesData.profiles[id].name;
    if (id === currentProfileId) opt.selected = true;
    select.appendChild(opt);
  });
}

document.getElementById('profile-select').onchange = (e) => {
  currentProfileId = e.target.value;
  profilesData.active_profile = currentProfileId;
  loadProfile(currentProfileId);
};

document.getElementById('btn-new-profile').onclick = () => {
  const name = prompt("Enter profile name:");
  if (name) {
    const id = 'prof_' + Date.now();
    profilesData.profiles[id] = { 
      name: name, 
      mode: simMode,
      max_steering_angle: 180,
      elements: [],
      mappings: {}
    };
    currentProfileId = id;
    profilesData.active_profile = currentProfileId;
    renderProfileSelect();
    loadProfile(id);
  }
};

function loadProfile(id) {
  // Save current profile fields back before switching — but only if the DOM
  // has already been populated (prevents blank name overwriting on first load).
  const nameInput = document.getElementById('prof-name');
  if (nameInput.value.trim() !== '') {
    const p = profilesData.profiles[currentProfileId];
    if (p) {
      p.name = nameInput.value;
      p.max_steering_angle = parseInt(document.getElementById('prof-steering-angle').value) || 180;
      p.return_speed = parseInt(document.getElementById('prof-return-speed').value) || 5;
      p.wheel_style = document.getElementById('prof-wheel-style').value;
      p.pedal_style = document.getElementById('prof-pedal-style').value;
      p.bg_style = document.getElementById('prof-bg-style').value;
      p.tilt_enabled = document.getElementById('prof-tilt-enabled')?.checked || false;
      p.tilt_sensitivity = parseFloat(document.getElementById('prof-tilt-sensitivity')?.value) || 1.5;
      p.tilt_inverted = document.getElementById('prof-tilt-inverted')?.checked || false;
    }
  }
  
  // Extract elements
  const pLoad = profilesData.profiles[id];
  if (!pLoad) return;
  document.getElementById('prof-name').value = pLoad.name;
  document.getElementById('prof-steering-angle').value = pLoad.max_steering_angle || 180;
  let rs = pLoad.return_speed !== undefined ? pLoad.return_speed : 5;
  document.getElementById('prof-return-speed').value = rs;
  document.getElementById('prof-return-val').innerText = rs;
  document.getElementById('prof-wheel-style').value = pLoad.wheel_style || '';
  document.getElementById('prof-pedal-style').value = pLoad.pedal_style || '';
  document.getElementById('prof-bg-style').value = pLoad.bg_style || '';
  const tiltEl = document.getElementById('prof-tilt-enabled');
  if (tiltEl) tiltEl.checked = pLoad.tilt_enabled || false;
  const tiltSensEl = document.getElementById('prof-tilt-sensitivity');
  if (tiltSensEl) {
    tiltSensEl.value = pLoad.tilt_sensitivity !== undefined ? pLoad.tilt_sensitivity : 1.5;
    const tiltSensVal = document.getElementById('prof-tilt-sensitivity-val');
    if (tiltSensVal) tiltSensVal.innerText = tiltSensEl.value + 'x';
  }
  const tiltInvEl = document.getElementById('prof-tilt-inverted');
  if (tiltInvEl) tiltInvEl.checked = pLoad.tilt_inverted || false;
  
  renderCanvas(pLoad.elements);
  renderMappings(pLoad);
}

document.getElementById('prof-name').onchange = (e) => {
  profilesData.profiles[currentProfileId].name = e.target.value;
  renderProfileSelect();
};

document.getElementById('prof-steering-angle').onchange = (e) => {
  profilesData.profiles[currentProfileId].max_steering_angle = parseInt(e.target.value) || 180;
};

document.getElementById('prof-return-speed').oninput = (e) => {
  let val = parseInt(e.target.value) || 0;
  document.getElementById('prof-return-val').innerText = val;
  profilesData.profiles[currentProfileId].return_speed = val;
};

// Tilt steering handlers
document.getElementById('prof-tilt-enabled')?.addEventListener('change', (e) => {
  profilesData.profiles[currentProfileId].tilt_enabled = e.target.checked;
  const sensRow = document.getElementById('tilt-sensitivity-row');
  if (sensRow) sensRow.style.display = e.target.checked ? '' : 'none';
});

document.getElementById('prof-tilt-sensitivity')?.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  profilesData.profiles[currentProfileId].tilt_sensitivity = val;
  const tiltSensVal = document.getElementById('prof-tilt-sensitivity-val');
  if (tiltSensVal) tiltSensVal.innerText = val.toFixed(1) + 'x';
});

document.getElementById('prof-tilt-inverted')?.addEventListener('change', (e) => {
  profilesData.profiles[currentProfileId].tilt_inverted = e.target.checked;
});

// steering mode handler removed

document.getElementById('prof-wheel-style').onchange = (e) => {
  profilesData.profiles[currentProfileId].wheel_style = e.target.value;
  renderCanvas(profilesData.profiles[currentProfileId].elements);
};

document.getElementById('prof-pedal-style').onchange = (e) => {
  profilesData.profiles[currentProfileId].pedal_style = e.target.value;
  renderCanvas(profilesData.profiles[currentProfileId].elements);
};

document.getElementById('prof-bg-style').onchange = (e) => {
  profilesData.profiles[currentProfileId].bg_style = e.target.value;
};

// Canvas Logic
const editorCanvas = document.getElementById('editor-canvas');
let draggedElement = null;
let resizedElement = null;
let startX, startY, startW, startH, startLeft, startTop;

function renderCanvas(elements) {
  editorCanvas.innerHTML = `
    <!-- Permanent UI overlay guides -->
    <div style="position: absolute; top: 20px; right: 20px; width: 44px; height: 44px; border-radius: 50%; border: 2px dashed rgba(255,255,255,0.3); background: rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.3); font-size: 1.2rem; pointer-events: none; z-index: 0;">✕</div>
    <div style="position: absolute; top: 20px; left: 20px; padding: 10px 16px; border-radius: 20px; border: 2px dashed rgba(255,255,255,0.3); background: rgba(0,0,0,0.2); color: rgba(255,255,255,0.3); font-weight: bold; pointer-events: none; z-index: 0;">⟳ Recenter</div>
    <div style="position: absolute; top: 20px; left: 140px; padding: 10px 20px; border-radius: 20px; border: 2px dashed rgba(255,255,255,0.3); background: rgba(0,0,0,0.2); color: rgba(255,255,255,0.3); font-weight: bold; pointer-events: none; z-index: 0;">📱 Tilt</div>
    <div style="position: absolute; top: 20px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: rgba(255,255,255,0.3); font-weight: 800; font-size: 2rem; pointer-events: none; z-index: 0;">0°<span style="font-size: 1rem; font-weight: 400;">0.00 rot</span></div>
  `;
  elements.forEach(el => {
    createEditorElement(el);
  });
}

function createEditorElement(el) {
  const div = document.createElement('div');
  div.className = 'control-item';
  div.id = el.id;
  div.style.left = el.x + '%';
  div.style.top = el.y + '%';
  div.style.width = el.width + '%';
  div.style.height = el.height + '%';
  div.dataset.type = el.type;

  if (el.type === 'joystick') {
    div.innerHTML = `
      <div class="joystick-base" style="width: 100%; height: 100%; border-radius: 50%; border: 2px solid var(--primary); position: relative; box-sizing: border-box; pointer-events: none;">
        <div class="joystick-thumb" style="width: 40%; height: 40%; background: var(--primary); border-radius: 50%; position: absolute; top: 30%; left: 30%; pointer-events: none;"></div>
      </div>
    `;
  } else if (el.type === 'yoke') {
    div.innerHTML = `
      <div class="yoke-base" style="width: 100%; height: 100%; border-radius: 10px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4); pointer-events: none;">
        <div class="yoke-thumb" style="width: 30%; height: 30%; background: var(--primary); border-radius: 5px; position: absolute; top: 35%; left: 35%; pointer-events: none; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8em;">YOKE</div>
      </div>
    `;
  } else if (el.type === 'rudder') {
    div.innerHTML = `
      <div class="rudder-base" style="width: 100%; height: 100%; border-radius: 5px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4); pointer-events: none;">
        <div class="rudder-thumb" style="width: 20%; height: 100%; background: var(--primary); border-radius: 3px; position: absolute; top: 0; left: 40%; pointer-events: none;"></div>
      </div>
    `;
  } else if (el.type.startsWith('throttle-')) {
    div.innerHTML = `
      <div class="throttle-base" style="width: 100%; height: 100%; border-radius: 5px; border: 2px solid var(--primary); position: relative; box-sizing: border-box; background: rgba(0, 0, 0, 0.4); pointer-events: none;">
        <div class="throttle-thumb" style="width: 100%; height: 20%; background: var(--primary); border-radius: 3px; position: absolute; bottom: 0; left: 0; pointer-events: none;"></div>
      </div>
    `;
  } else if (el.type === 'steering-wheel') {
    const wheelImg = profilesData.profiles[currentProfileId]?.wheel_style;
    const imgUrl = wheelImg ? `/packages/Steering/${wheelImg}` : '/static/scania_wheel.png';
    div.innerHTML = `
      <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;">
    `;
  } else if (el.type.startsWith('pedal-')) {
    const pedalImg = profilesData.profiles[currentProfileId]?.pedal_style;
    const imgUrl = pedalImg ? `/packages/Pedals/${pedalImg}` : '/static/pedal_plate.png';
    div.innerHTML = `
      <div style="position: absolute; top: 10%; bottom: 10%; left: 50%; transform: translateX(-50%); width: 6px; background: rgba(0,0,0,0.5); border-radius: 3px; z-index: 1;"></div>
      <div style="position: absolute; bottom: 0%; left: 50%; transform: translateX(-50%); width: 70%; height: 40%; background-image: url('${imgUrl}'); background-size: contain; background-repeat: no-repeat; background-position: center bottom; z-index: 3;"></div>
      <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-weight: bold; text-shadow: 0 2px 4px black; z-index: 4;">${el.text}</span>
    `;
  } else {
    div.innerText = el.text || el.type.split('-')[1]?.toUpperCase() || 'BTN';
  }

  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  div.appendChild(handle);

  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.innerText = '×';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    div.remove();
    updateProfileElements();
  };
  div.appendChild(delBtn);

  div.addEventListener('mousedown', (e) => {
    document.querySelectorAll('.control-item').forEach(i => i.classList.remove('selected'));
    div.classList.add('selected');
    
    if (e.target === handle) {
      resizedElement = div;
      startW = parseFloat(div.style.width);
      startH = parseFloat(div.style.height);
    } else if (e.target !== delBtn) {
      draggedElement = div;
      startLeft = parseFloat(div.style.left);
      startTop = parseFloat(div.style.top);
    }
    startX = e.clientX;
    startY = e.clientY;
    e.stopPropagation();
  });

  editorCanvas.appendChild(div);
}

document.addEventListener('mousemove', (e) => {
  if (draggedElement) {
    const rect = editorCanvas.getBoundingClientRect();
    const dx = (e.clientX - startX) / rect.width * 100;
    const dy = (e.clientY - startY) / rect.height * 100;
    draggedElement.style.left = Math.max(0, Math.min(100 - parseFloat(draggedElement.style.width), startLeft + dx)) + '%';
    draggedElement.style.top = Math.max(0, Math.min(100 - parseFloat(draggedElement.style.height), startTop + dy)) + '%';
  } else if (resizedElement) {
    const rect = editorCanvas.getBoundingClientRect();
    const dx = (e.clientX - startX) / rect.width * 100;
    const dy = (e.clientY - startY) / rect.height * 100;
    resizedElement.style.width = Math.max(5, startW + dx) + '%';
    resizedElement.style.height = Math.max(5, startH + dy) + '%';
  }
});

document.addEventListener('mouseup', () => {
  if (draggedElement || resizedElement) {
    updateProfileElements();
  }
  draggedElement = null;
  resizedElement = null;
});

function updateProfileElements() {
  const elements = [];
  document.querySelectorAll('#editor-canvas .control-item').forEach(el => {
    elements.push({
      id: el.id,
      type: el.dataset.type,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
      text: el.childNodes[0].nodeValue
    });
  });
  profilesData.profiles[currentProfileId].elements = elements;
  
  // Clean up mappings for deleted elements, add for new ones
  const p = profilesData.profiles[currentProfileId];
  if (!p.mappings) p.mappings = {};
  
  const currentIds = elements.map(e => e.id);
  Object.keys(p.mappings).forEach(id => {
    const baseId = id.replace('_x', '').replace('_y', '');
    if (!currentIds.includes(baseId)) delete p.mappings[id];
  });
  
  renderMappings(p);
}

document.getElementById('btn-add-element').onclick = () => {
  const type = document.getElementById('element-type').value;
  let text = type.split('-')[1]?.toUpperCase() || 'BTN';
  if (type.startsWith('pedal')) text = text.substring(0, 3);
  if (type === 'joystick') text = 'JOY';
  if (type === 'steering-wheel') text = 'WHEEL';
  if (type === 'yoke') text = 'YOKE';
  if (type === 'rudder') text = 'RUDDER';
  if (type.startsWith('throttle-')) text = 'THR' + type.split('-')[1];
  
  const isSquare = type === 'steering-wheel' || type === 'joystick' || type === 'yoke';
  const isWide = type === 'rudder';
  const isTall = type.startsWith('pedal') || type.startsWith('throttle-');
  
  const el = {
    id: 'el_' + Date.now(),
    type: type,
    x: 45, y: 40, width: isSquare ? 30 : (isWide ? 40 : 10), height: isTall ? 40 : (isSquare ? 30 : 20),
    text: text
  };
  createEditorElement(el);
  updateProfileElements();
};

function renderMappings(profile) {
  const list = document.getElementById('mapping-list');
  list.innerHTML = '';
  
  const createMappingRow = (elId, labelText) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    
    const label = document.createElement('span');
    label.innerText = labelText;
    
    const arrow = document.createElement('i');
    arrow.innerText = '→';
    
    const select = document.createElement('select');
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.innerText = '-- Unmapped --';
    select.appendChild(defOpt);
    
    xboxOutputs.forEach(out => {
      const opt = document.createElement('option');
      opt.value = out;
      opt.innerText = out;
      select.appendChild(opt);
    });
    
    if (profile.mappings[elId] && profile.mappings[elId].output) {
      select.value = profile.mappings[elId].output;
    }
    
    select.onchange = (e) => {
      if (!profile.mappings[elId]) profile.mappings[elId] = {};
      profile.mappings[elId].output = e.target.value;
    };
    
    row.appendChild(label);
    row.appendChild(arrow);
    row.appendChild(select);
    list.appendChild(row);
  };

  profile.elements.forEach(el => {
    const labelText = el.text || el.type;
    if (el.type === 'joystick' || el.type === 'yoke') {
      createMappingRow(el.id + '_x', labelText + ' (X-Axis)');
      createMappingRow(el.id + '_y', labelText + ' (Y-Axis)');
    } else {
      createMappingRow(el.id, labelText);
    }
  });
}

document.getElementById('btn-save').onclick = async () => {
  const p = profilesData.profiles[currentProfileId];
  if (p) {
    p.name = document.getElementById('prof-name').value;
    p.max_steering_angle = parseInt(document.getElementById('prof-steering-angle').value) || 180;
    p.wheel_style = document.getElementById('prof-wheel-style').value;
    p.pedal_style = document.getElementById('prof-pedal-style').value;
    p.bg_style = document.getElementById('prof-bg-style').value;
    p.tilt_enabled = document.getElementById('prof-tilt-enabled')?.checked || false;
    p.tilt_sensitivity = parseFloat(document.getElementById('prof-tilt-sensitivity')?.value) || 1.5;
    p.tilt_inverted = document.getElementById('prof-tilt-inverted')?.checked || false;
  }
  
  const res = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profilesData)
  });
  if (res.ok) {
    const status = document.getElementById('save-status');
    status.innerText = 'Saved successfully!';
    setTimeout(() => status.innerText = '', 2000);
  }
};

document.getElementById('btn-quit').onclick = async () => {
  if (confirm('Are you sure you want to quit VForce completely?')) {
    try {
      await fetch('/api/shutdown', { method: 'POST' });
    } catch (e) {
      // The fetch might throw because the server shuts down and abruptly closes the connection
    }
    document.body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
        <h1>VForce Shutdown Successful</h1>
        <p>The background process has been terminated. You can safely close this window.</p>
      </div>
    `;
  }
};

loadData().then(() => {
  // Show/hide tilt sensitivity row based on current profile's tilt_enabled state
  const tiltChk = document.getElementById('prof-tilt-enabled');
  const sensRow = document.getElementById('tilt-sensitivity-row');
  if (tiltChk && sensRow) {
    sensRow.style.display = tiltChk.checked ? '' : 'none';
  }
});
