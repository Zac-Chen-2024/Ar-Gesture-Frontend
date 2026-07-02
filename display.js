const canvas = document.getElementById("display-canvas");
const frame = document.querySelector(".display-frame");
const context = canvas.getContext("2d");
const mappingModeSelect = document.getElementById("mapping-mode");
const inputModeSelect = document.getElementById("input-mode");
const visualModeSelect = document.getElementById("visual-mode");
const mobileKeyboardModeSelect = document.getElementById("mobile-keyboard-mode");
const algoVersionSelect = document.getElementById("algo-version");
const candidateStrip = document.getElementById("candidate-strip");
const decodedText = document.getElementById("decoded-text");
const cursorMarker = document.getElementById("cursor-marker");

const socket = new WebSocket(window.GESTURE_CONFIG.backendWsUrl);

let keyboardAnchorPoint = { x: 0, y: 0 };
let keyboardMetrics = { keyWidth: 0, keyHeight: 0 };
let lastPoint = null;
let isApplyingServerText = false;
let isApplyingServerMappingMode = false;
let isApplyingServerMode = false;
let isApplyingServerVisualMode = false;
let isApplyingServerMobileKeyboardMode = false;
let currentCursorKey = "G";
let currentMappingMode = "relative";
let currentInputMode = "center";
let currentVisualMode = "gesture";
let currentBehavior = "top1";
let isApplyingServerVersion = false;
let versionsPopulated = false;

function sendMessage(payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function resizeCanvas() {
  const rect = frame.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  updateKeyboardReference();
  clearCanvas();
  updateCursorByKey(currentCursorKey);
}

function updateKeyboardReference() {
  const anchorKey = document.querySelector('[data-key="G"]');
  const anchorRect = anchorKey.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();

  keyboardAnchorPoint = {
    x: anchorRect.left - frameRect.left + anchorRect.width / 2,
    y: anchorRect.top - frameRect.top + anchorRect.height / 2
  };

  keyboardMetrics = {
    keyWidth: anchorRect.width,
    keyHeight: anchorRect.height
  };
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  lastPoint = null;
}

function toDisplayPoint(point) {
  return {
    x: keyboardAnchorPoint.x + point.x * keyboardMetrics.keyWidth,
    y: keyboardAnchorPoint.y + point.y * keyboardMetrics.keyHeight
  };
}

function getKeyCenter(keyName) {
  const keyElement = document.querySelector(`[data-key="${keyName.toUpperCase()}"]`);
  if (!keyElement) {
    return toDisplayPoint({ x: 0, y: 0 });
  }

  const keyRect = keyElement.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();

  return {
    x: keyRect.left - frameRect.left + keyRect.width / 2,
    y: keyRect.top - frameRect.top + keyRect.height / 2
  };
}

function moveCursor(point) {
  cursorMarker.style.left = `${point.x}px`;
  cursorMarker.style.top = `${point.y}px`;
}

function updateCursorByKey(keyName) {
  moveCursor(getKeyCenter(keyName || "G"));
}

function applyModeClasses() {
  const isAbsoluteMode = currentMappingMode === "absolute";
  document.body.classList.toggle("is-absolute-mode", isAbsoluteMode);
  document.body.classList.toggle("is-continuous-mode", !isAbsoluteMode && currentInputMode === "continuous");
  document.body.classList.toggle("is-cursor-visual-mode", currentVisualMode === "cursor");
  inputModeSelect.disabled = isAbsoluteMode;
}

function drawSegment(from, to) {
  context.strokeStyle = "#111111";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function populateVersions(versions) {
  if (versionsPopulated || !Array.isArray(versions) || versions.length === 0) {
    return;
  }
  algoVersionSelect.innerHTML = "";
  for (const version of versions) {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = version.name;
    if (version.summary) {
      option.title = version.summary;
    }
    algoVersionSelect.appendChild(option);
  }
  versionsPopulated = true;
}

// Segment weight must match the server's candidate_slot (max(len, 2)).
function candidateWeight(word) {
  return Math.max(String(word || "").length, 2);
}

// The bar is a permanent in-flow row inside the keyboard shell (aligned with
// the top key row): 5 word slots + backspace + clear. Everything here is
// display-only; selection happens by the cursor (touchpad) sliding onto a
// segment, decided on the server. Weights must match server.py.
function renderCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  candidateStrip.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const candidate = list[i];
    const word = candidate ? candidate.word : "";
    const seg = document.createElement("div");
    seg.className = "candidate-seg" + (i === 0 && candidate ? " is-top" : "");
    seg.style.flex = `${candidateWeight(word)} 1 0`;
    seg.textContent = word;
    candidateStrip.appendChild(seg);
  }

  const backspace = document.createElement("div");
  backspace.className = "candidate-seg candidate-action";
  backspace.style.flex = "3 1 0";
  backspace.textContent = "⌫";
  candidateStrip.appendChild(backspace);

  const clear = document.createElement("div");
  clear.className = "candidate-seg candidate-action";
  clear.style.flex = "3 1 0";
  clear.textContent = "Clear";
  candidateStrip.appendChild(clear);
}

function highlightCandidate(index) {
  Array.from(candidateStrip.children).forEach((seg, i) => {
    seg.classList.toggle("is-hover", i === index);
  });
}

const roomCodeBadge = document.getElementById("room-code");

function updateRoomBadge(code, paired) {
  if (!roomCodeBadge) {
    return;
  }
  if (code) {
    roomCodeBadge.querySelector(".room-code-value").textContent = code;
  }
  roomCodeBadge.classList.toggle("is-paired", Boolean(paired));
  const statusEl = roomCodeBadge.querySelector(".room-code-status");
  if (statusEl) {
    statusEl.textContent = paired ? "phone paired" : "waiting for phone…";
  }
}

socket.addEventListener("open", () => {
  sendMessage({ type: "join", role: "display" });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "room-created") {
    updateRoomBadge(message.code, false);
    return;
  }

  if (message.type === "mobile-joined") {
    updateRoomBadge(null, true);
    return;
  }

  if (message.type === "mobile-left") {
    updateRoomBadge(null, false);
    return;
  }

  if (message.type === "candidate-hover") {
    highlightCandidate(message.index);
    return;
  }

  if (message.type === "gesture-cancel") {
    clearCanvas();
    return;
  }

  if (message.type === "gesture-start") {
    updateKeyboardReference();
    clearCanvas();
    const nextPoint = toDisplayPoint(message.point);
    moveCursor(nextPoint);
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-move" && lastPoint) {
    const nextPoint = toDisplayPoint(message.point);
    moveCursor(nextPoint);
    if (currentVisualMode === "gesture") {
      drawSegment(lastPoint, nextPoint);
    }
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-end") {
    clearCanvas();
    return;
  }

  if (message.type === "text-update" || message.type === "state-update") {
    decodedText.textContent = message.text || "";

    if (message.mappingMode && mappingModeSelect.value !== message.mappingMode) {
      isApplyingServerMappingMode = true;
      mappingModeSelect.value = message.mappingMode;
      isApplyingServerMappingMode = false;
    }

    if (message.mode && inputModeSelect.value !== message.mode) {
      isApplyingServerMode = true;
      inputModeSelect.value = message.mode;
      isApplyingServerMode = false;
    }

    if (message.visualMode && visualModeSelect.value !== message.visualMode) {
      isApplyingServerVisualMode = true;
      visualModeSelect.value = message.visualMode;
      isApplyingServerVisualMode = false;
    }

    if (typeof message.mobileKeyboardVisible === "boolean") {
      const nextMobileKeyboardMode = message.mobileKeyboardVisible ? "show" : "hide";
      if (mobileKeyboardModeSelect.value !== nextMobileKeyboardMode) {
        isApplyingServerMobileKeyboardMode = true;
        mobileKeyboardModeSelect.value = nextMobileKeyboardMode;
        isApplyingServerMobileKeyboardMode = false;
      }
    }

    if (message.mappingMode) {
      currentMappingMode = message.mappingMode;
    }

    if (message.mode) {
      currentInputMode = message.mode;
    }

    if (message.visualMode) {
      currentVisualMode = message.visualMode;
    }

    if (message.cursorKey) {
      currentCursorKey = String(message.cursorKey).toUpperCase();
      updateCursorByKey(currentCursorKey);
    }

    if (message.code) {
      updateRoomBadge(message.code, message.mobilePaired === true);
    }

    if (message.versions) {
      populateVersions(message.versions);
    }

    if (message.version && algoVersionSelect.value !== message.version) {
      isApplyingServerVersion = true;
      algoVersionSelect.value = message.version;
      isApplyingServerVersion = false;
    }

    if (typeof message.behavior === "string") {
      currentBehavior = message.behavior;
    }

    if (message.reset) {
      clearCanvas();
      renderCandidates([]);
    } else if ("candidates" in message) {
      renderCandidates(message.candidates);
    }

    applyModeClasses();
  }
});

mappingModeSelect.addEventListener("change", () => {
  if (isApplyingServerMappingMode) {
    return;
  }

  sendMessage({
    type: "mapping-mode-set",
    mappingMode: mappingModeSelect.value
  });
});

inputModeSelect.addEventListener("change", () => {
  if (isApplyingServerMode || currentMappingMode === "absolute") {
    return;
  }

  sendMessage({
    type: "mode-set",
    mode: inputModeSelect.value
  });
});

visualModeSelect.addEventListener("change", () => {
  if (isApplyingServerVisualMode) {
    return;
  }

  sendMessage({
    type: "visual-mode-set",
    visualMode: visualModeSelect.value
  });
});

mobileKeyboardModeSelect.addEventListener("change", () => {
  if (isApplyingServerMobileKeyboardMode) {
    return;
  }

  sendMessage({
    type: "mobile-keyboard-set",
    visible: mobileKeyboardModeSelect.value === "show"
  });
});

algoVersionSelect.addEventListener("change", () => {
  if (isApplyingServerVersion) {
    return;
  }

  sendMessage({
    type: "version-set",
    version: algoVersionSelect.value
  });
});

const buildBadge = document.getElementById("build-badge");
if (buildBadge) {
  buildBadge.textContent = window.GESTURE_CONFIG.version || "";
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
applyModeClasses();
renderCandidates([]);
