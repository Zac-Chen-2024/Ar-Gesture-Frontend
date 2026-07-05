const canvas = document.getElementById("mobile-canvas");
const context = canvas.getContext("2d");
const overlay = document.querySelector(".mobile-keyboard-overlay");

const socket = new WebSocket(window.GESTURE_CONFIG.backendWsUrl);

let isDrawing = false;
let pointerId = null;
let startPoint = null;
let lastPoint = null;
let gestureStartTime = 0;

// Long-press / dwell detection for v3 letter input lives entirely on the
// SERVER (keyboard units + its own clock); the phone stays a dumb touchpad.

// ---- LAN mode (optional fast path) ----
// When the display enables it, the phone opens a WebRTC data channel straight
// to the display (host/mDNS ICE candidates keep it on the local network) and
// MIRRORS every gesture message onto it. The WebSocket path to the server is
// untouched, so decoding, recording and all logic behave exactly as before;
// the channel only lets the display render the cursor without the WAN hop.
let lanMode = false;
let rtcPeer = null;
let rtcChannel = null;
let p2pActive = false;

function stopP2P() {
  p2pActive = false;
  if (rtcChannel) {
    try { rtcChannel.close(); } catch (e) { /* noop */ }
    rtcChannel = null;
  }
  if (rtcPeer) {
    try { rtcPeer.close(); } catch (e) { /* noop */ }
    rtcPeer = null;
  }
}

function startP2P() {
  if (rtcPeer || !lanMode || !paired) {
    return;
  }
  rtcPeer = new RTCPeerConnection({ iceServers: [] }); // LAN only: no STUN/TURN
  rtcChannel = rtcPeer.createDataChannel("trace");
  rtcChannel.onopen = () => { p2pActive = true; };
  rtcChannel.onclose = () => { p2pActive = false; };
  rtcPeer.onicecandidate = (e) => {
    if (e.candidate) {
      sendMessage({ type: "rtc-ice", candidate: e.candidate });
    }
  };
  rtcPeer
    .createOffer()
    .then((offer) => rtcPeer.setLocalDescription(offer))
    .then(() => sendMessage({ type: "rtc-offer", sdp: rtcPeer.localDescription }))
    .catch(() => stopP2P());
}

function p2pSend(kind, payload) {
  if (p2pActive && rtcChannel && rtcChannel.readyState === "open") {
    try {
      rtcChannel.send(JSON.stringify({ kind, ...(payload || {}) }));
    } catch (e) { /* fall back silently; the server path is always running */ }
  }
}

let currentStartKey = "G";
let currentMappingMode = "relative";
let currentInputMode = "center";
let mobileKeyboardVisible = true;
let paired = false;
let roomCode = null;

function applyModeClasses() {
  const isAbsoluteMode = currentMappingMode === "absolute";
  document.body.classList.toggle("is-absolute-mode", isAbsoluteMode);
  document.body.classList.toggle("is-continuous-mode", !isAbsoluteMode && currentInputMode === "continuous");
  document.body.classList.toggle("is-mobile-keyboard-hidden", !mobileKeyboardVisible);

  if (isAbsoluteMode) {
    overlay.style.left = "";
    overlay.style.top = "";
    overlay.style.transform = "";
    overlay.classList.add("is-visible");
  } else if (!isDrawing) {
    hideOverlay();
  }
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawIdleState();
}

function drawIdleState() {
  context.clearRect(0, 0, canvas.width, canvas.height);
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

function getPoint(event) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function sendMessage(payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function isAbsoluteMode() {
  return currentMappingMode === "absolute";
}

function getOverlayMetrics() {
  const anchorKey = getOverlayAnchorKey();
  const anchorRect = anchorKey.getBoundingClientRect();
  return {
    keyWidth: anchorRect.width,
    keyHeight: anchorRect.height
  };
}

function getOverlayAnchorKey() {
  return overlay.querySelector(`[data-key="${currentStartKey}"]`) || overlay.querySelector('[data-key="G"]');
}

function getOverlayAnchorOffset() {
  const anchorKey = getOverlayAnchorKey();
  overlay.style.left = "0px";
  overlay.style.top = "0px";
  overlay.style.transform = "none";

  const overlayRect = overlay.getBoundingClientRect();
  const anchorRect = anchorKey.getBoundingClientRect();

  return {
    x: anchorRect.left - overlayRect.left + anchorRect.width / 2,
    y: anchorRect.top - overlayRect.top + anchorRect.height / 2
  };
}

function placeOverlay(point) {
  const anchorOffset = getOverlayAnchorOffset();
  overlay.style.left = `${point.x - anchorOffset.x}px`;
  overlay.style.top = `${point.y - anchorOffset.y}px`;
  overlay.style.transform = "none";
}

function showOverlay(point) {
  placeOverlay(point);
  overlay.classList.add("is-visible");
}

function hideOverlay() {
  overlay.classList.remove("is-visible");
}

function getAbsoluteKeyboardRect() {
  return overlay.querySelector(".keyboard-shell").getBoundingClientRect();
}

function isInsideRect(point, rect) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function toAbsoluteKeyboardPoint(point) {
  const rect = getAbsoluteKeyboardRect();
  return {
    x: clamp01((point.x - rect.left) / rect.width),
    y: clamp01((point.y - rect.top) / rect.height)
  };
}

function toKeyboardUnits(point) {
  const metrics = getOverlayMetrics();
  return {
    x: (point.x - startPoint.x) / metrics.keyWidth,
    y: (point.y - startPoint.y) / metrics.keyHeight
  };
}

function startGesture(event) {
  if (isDrawing || !paired) {
    return;
  }

  event.preventDefault();
  const point = getPoint(event);

  if (isAbsoluteMode() && !isInsideRect(point, getAbsoluteKeyboardRect())) {
    return;
  }

  isDrawing = true;
  pointerId = event.pointerId;
  startPoint = point;
  lastPoint = point;
  gestureStartTime = performance.now();
  canvas.setPointerCapture(pointerId);

  drawIdleState();
  if (isAbsoluteMode()) {
    applyModeClasses();
  } else {
    showOverlay(point);
  }

  const startPayload = isAbsoluteMode() ? toAbsoluteKeyboardPoint(point) : { x: 0, y: 0 };
  startPayload.t = 0;
  sendMessage({ type: "gesture-start", point: startPayload });
  p2pSend("start", startPayload);
}

function moveGesture(event) {
  if (!isDrawing || event.pointerId !== pointerId || !startPoint || !lastPoint) {
    return;
  }

  event.preventDefault();
  const point = getPoint(event);
  drawSegment(lastPoint, point);

  // t = ms since gesture start; used server-side for data recording and
  // (later) dwell/speed-aware decoding
  const payload = isAbsoluteMode() ? toAbsoluteKeyboardPoint(point) : toKeyboardUnits(point);
  payload.t = Math.round(performance.now() - gestureStartTime);
  sendMessage({ type: "gesture-move", point: payload });
  p2pSend("move", payload);

  lastPoint = point;
}

function endGesture(event) {
  if (!isDrawing || event.pointerId !== pointerId) {
    return;
  }

  event.preventDefault();

  isDrawing = false;
  pointerId = null;
  startPoint = null;
  lastPoint = null;

  drawIdleState();
  applyModeClasses();
  sendMessage({ type: "gesture-end" });
  p2pSend("end", {});
}

const sessionPicker = document.getElementById("session-picker");
const sessionList = document.getElementById("session-list");
const pickerRefresh = document.getElementById("picker-refresh");
const pickerStatus = document.getElementById("picker-status");

function showPicker(statusMessage) {
  paired = false;
  roomCode = null;
  document.body.classList.remove("is-paired");
  if (pickerStatus) {
    pickerStatus.textContent = statusMessage || "";
  }
  sessionPicker.classList.remove("is-hidden");
}

function hidePicker() {
  sessionPicker.classList.add("is-hidden");
}

function renderRooms(list) {
  sessionList.innerHTML = "";
  const openRooms = (list || []).filter((room) => !room.busy);

  if (openRooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "session-empty";
    empty.textContent = "No open sessions. Open the display page, then Refresh.";
    sessionList.appendChild(empty);
    return;
  }

  for (const room of openRooms) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-item";
    button.textContent = room.code;
    button.addEventListener("click", () => {
      sendMessage({ type: "join-room", code: room.code });
    });
    sessionList.appendChild(button);
  }
}

if (pickerRefresh) {
  pickerRefresh.addEventListener("click", () => sendMessage({ type: "list-rooms" }));
}

socket.addEventListener("open", () => {
  sendMessage({ type: "join", role: "mobile" });
});

socket.addEventListener("close", () => {
  showPicker("Disconnected. Reload the page to reconnect.");
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "room-list") {
    if (!paired) {
      renderRooms(message.rooms);
    }
    return;
  }

  if (message.type === "room-joined") {
    paired = true;
    roomCode = message.code;
    document.body.classList.add("is-paired");
    hidePicker();
    resizeCanvas();
    return;
  }

  if (message.type === "room-closed" || message.type === "room-error") {
    stopP2P();
    showPicker(message.message || "Session ended.");
    return;
  }

  if (message.type === "rtc-answer") {
    if (rtcPeer) {
      rtcPeer.setRemoteDescription(message.sdp).catch(() => stopP2P());
    }
    return;
  }

  if (message.type === "rtc-ice") {
    if (rtcPeer && message.candidate) {
      rtcPeer.addIceCandidate(message.candidate).catch(() => {});
    }
    return;
  }

  if (message.type === "state-update") {
    currentStartKey = String(message.cursorKey || "g").toUpperCase();
    currentMappingMode = message.mappingMode || "relative";
    currentInputMode = message.mode || "center";
    mobileKeyboardVisible = message.mobileKeyboardVisible !== false;
    const nextLan = message.lanMode === true;
    if (nextLan !== lanMode) {
      lanMode = nextLan;
      if (lanMode) {
        startP2P();
      } else {
        stopP2P();
      }
    } else if (lanMode && paired && !rtcPeer) {
      startP2P();
    }
    applyModeClasses();
  }
});

const buildBadge = document.getElementById("build-badge");
if (buildBadge) {
  buildBadge.textContent = window.GESTURE_CONFIG.version || "";
}

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", startGesture);
canvas.addEventListener("pointermove", moveGesture);
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointerleave", endGesture);
canvas.addEventListener("pointercancel", endGesture);

resizeCanvas();
applyModeClasses();
