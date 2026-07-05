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
let currentLetters = null;
let isApplyingServerVersion = false;
let versionsPopulated = false;
let plainText = "";

function sendMessage(payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

const keyboardShell = document.querySelector(".keyboard-shell");
const textRow = document.querySelector(".text-row");

// Make the keyboard (and the candidate bar inside it) span the same width as
// the text row above: 10 keys across the row's width.
function sizeKeyboardToTextRow() {
  if (!keyboardShell || !textRow) {
    return;
  }
  const width = textRow.getBoundingClientRect().width;
  if (width > 0) {
    keyboardShell.style.setProperty("--key-width", `${width / 10}px`);
  }
}

function resizeCanvas() {
  sizeKeyboardToTextRow();

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
  backspace.style.flex = "2 1 0";
  backspace.textContent = "⌫";
  candidateStrip.appendChild(backspace);

  const clear = document.createElement("div");
  clear.className = "candidate-seg candidate-action";
  clear.style.flex = "2 1 0";
  clear.textContent = currentLetters ? "↩" : "Clear"; // v3: Undo replaces Clear
  candidateStrip.appendChild(clear);
}

function highlightCandidate(index) {
  Array.from(candidateStrip.children).forEach((seg, i) => {
    seg.classList.toggle("is-hover", i === index);
  });
}

// ---- v3 letter input feedback ----
const letterBadge = document.getElementById("letter-badge");

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderLetterState(state) {
  const active = state.mode && state.mode !== "off";
  if (letterBadge) {
    letterBadge.classList.toggle("is-visible", active);
    if (active) {
      const letter = state.letter ? state.letter.toUpperCase() : "·";
      const label = { armed: "pick a key", pending: "place it", positioning: "place it" }[state.mode] || "";
      letterBadge.innerHTML =
        `<span class="lb-letter">${escapeHtml(letter)}</span>` +
        `<span class="lb-hint">${label}</span>`;
    }
  }

  if (!active || state.mode === "armed") {
    decodedText.textContent = plainText;
    return;
  }
  // pending/positioning: show the insertion caret; caret == len+1 means
  // "as a new word" (rendered after a gap)
  const text = state.text || "";
  const caret = Math.max(0, Math.min(text.length + 1, state.caret));
  const mark = '<span class="text-caret"></span>';
  if (caret > text.length) {
    decodedText.innerHTML = escapeHtml(text) + "&nbsp;" + mark;
  } else {
    decodedText.innerHTML = escapeHtml(text.slice(0, caret)) + mark + escapeHtml(text.slice(caret));
  }
  decodedText.scrollLeft = decodedText.scrollWidth;
}

// ---- LAN mode (optional fast path) ----
// The phone opens a WebRTC data channel to us and mirrors its gesture stream;
// we render cursor/trace from it locally (LAN latency) and simply ignore the
// server's echoed gesture-move messages while the channel is up. All decoding
// and state stay on the server - this is rendering-only.
const lanModeSelect = document.getElementById("lan-mode");
const lanBadge = document.getElementById("lan-badge");
let isApplyingServerLanMode = false;
let currentLanMode = false;
let rtcPeer = null;
let p2pActive = false;

function setP2pActive(active) {
  p2pActive = active;
  if (lanBadge) {
    lanBadge.classList.toggle("is-visible", active);
  }
}

function teardownP2P() {
  setP2pActive(false);
  if (rtcPeer) {
    try { rtcPeer.close(); } catch (e) { /* noop */ }
    rtcPeer = null;
  }
}

function keyboardUnitsOfKey(keyName) {
  const c = getKeyCenter(keyName);
  return {
    x: (c.x - keyboardAnchorPoint.x) / keyboardMetrics.keyWidth,
    y: (c.y - keyboardAnchorPoint.y) / keyboardMetrics.keyHeight
  };
}

// Reconstruct the global keyboard-unit point from the phone's raw payload,
// mirroring the server's coordinate transforms.
function p2pGlobalPoint(msg) {
  if (currentMappingMode === "absolute") {
    return { x: msg.x * 10 - 5, y: msg.y * 3 - 1.5 };
  }
  const start = currentInputMode === "continuous"
    ? keyboardUnitsOfKey(currentCursorKey)
    : { x: 0, y: 0 };
  return { x: start.x + msg.x, y: start.y + msg.y };
}

function handleP2pTrace(msg) {
  if (msg.kind === "start") {
    updateKeyboardReference();
    clearCanvas();
    const p = toDisplayPoint(p2pGlobalPoint(msg));
    moveCursor(p);
    lastPoint = p;
  } else if (msg.kind === "move" && lastPoint) {
    const p = toDisplayPoint(p2pGlobalPoint(msg));
    moveCursor(p);
    if (currentVisualMode === "gesture") {
      drawSegment(lastPoint, p);
    }
    lastPoint = p;
  } else if (msg.kind === "end") {
    clearCanvas();
  }
}

async function handleRtcOffer(message) {
  teardownP2P();
  rtcPeer = new RTCPeerConnection({ iceServers: [] }); // LAN only: no STUN/TURN
  rtcPeer.onicecandidate = (e) => {
    if (e.candidate) {
      sendMessage({ type: "rtc-ice", candidate: e.candidate });
    }
  };
  rtcPeer.ondatachannel = (e) => {
    const channel = e.channel;
    channel.onopen = () => setP2pActive(true);
    channel.onclose = () => setP2pActive(false);
    channel.onmessage = (ev) => {
      try {
        handleP2pTrace(JSON.parse(ev.data));
      } catch (err) { /* ignore malformed frames */ }
    };
  };
  try {
    await rtcPeer.setRemoteDescription(message.sdp);
    const answer = await rtcPeer.createAnswer();
    await rtcPeer.setLocalDescription(answer);
    sendMessage({ type: "rtc-answer", sdp: rtcPeer.localDescription });
  } catch (err) {
    teardownP2P();
  }
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

  if (message.type === "letter-state") {
    renderLetterState(message);
    return;
  }

  if (message.type === "rtc-offer") {
    handleRtcOffer(message);
    return;
  }

  if (message.type === "rtc-ice") {
    if (rtcPeer && message.candidate) {
      rtcPeer.addIceCandidate(message.candidate).catch(() => {});
    }
    return;
  }

  if (message.type === "gesture-cancel") {
    clearCanvas();
    return;
  }

  if (message.type === "gesture-start") {
    if (p2pActive) {
      return; // the P2P channel already rendered this stroke locally
    }
    updateKeyboardReference();
    clearCanvas();
    const nextPoint = toDisplayPoint(message.point);
    moveCursor(nextPoint);
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-move" && lastPoint) {
    if (p2pActive) {
      return;
    }
    const nextPoint = toDisplayPoint(message.point);
    moveCursor(nextPoint);
    if (currentVisualMode === "gesture") {
      drawSegment(lastPoint, nextPoint);
    }
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-end") {
    if (p2pActive) {
      return;
    }
    clearCanvas();
    return;
  }

  if (message.type === "text-update" || message.type === "state-update") {
    plainText = message.text || "";
    decodedText.textContent = plainText;
    decodedText.scrollLeft = decodedText.scrollWidth; // keep the newest words visible

    if ("letters" in message && message.letters !== currentLetters) {
      currentLetters = message.letters;
      renderCandidates(message.candidates || []);
    }

    if ("lanMode" in message) {
      currentLanMode = message.lanMode === true;
      const wanted = currentLanMode ? "lan" : "server";
      if (lanModeSelect && lanModeSelect.value !== wanted) {
        isApplyingServerLanMode = true;
        lanModeSelect.value = wanted;
        isApplyingServerLanMode = false;
      }
      if (!currentLanMode) {
        teardownP2P();
      }
    }

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

if (lanModeSelect) {
  lanModeSelect.addEventListener("change", () => {
    if (isApplyingServerLanMode) {
      return;
    }
    sendMessage({
      type: "lan-mode-set",
      enabled: lanModeSelect.value === "lan"
    });
  });
}

const buildBadge = document.getElementById("build-badge");
if (buildBadge) {
  buildBadge.textContent = window.GESTURE_CONFIG.version || "";
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
applyModeClasses();
renderCandidates([]);
