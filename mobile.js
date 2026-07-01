const canvas = document.getElementById("mobile-canvas");
const context = canvas.getContext("2d");
const overlay = document.querySelector(".mobile-keyboard-overlay");

const socket = new WebSocket(window.GESTURE_CONFIG.backendWsUrl);

let isDrawing = false;
let pointerId = null;
let startPoint = null;
let lastPoint = null;
let currentStartKey = "G";
let currentMappingMode = "relative";
let currentInputMode = "center";
let mobileKeyboardVisible = true;

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
  if (isDrawing) {
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

  drawIdleState();
  if (isAbsoluteMode()) {
    applyModeClasses();
  } else {
    showOverlay(point);
  }
  canvas.setPointerCapture(pointerId);

  sendMessage({
    type: "gesture-start",
    point: isAbsoluteMode() ? toAbsoluteKeyboardPoint(point) : { x: 0, y: 0 }
  });
}

function moveGesture(event) {
  if (!isDrawing || event.pointerId !== pointerId || !startPoint || !lastPoint) {
    return;
  }

  event.preventDefault();
  const point = getPoint(event);
  drawSegment(lastPoint, point);

  sendMessage({
    type: "gesture-move",
    point: isAbsoluteMode() ? toAbsoluteKeyboardPoint(point) : toKeyboardUnits(point)
  });

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
}

socket.addEventListener("open", () => {
  sendMessage({ type: "join", role: "mobile" });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "state-update") {
    currentStartKey = String(message.cursorKey || "g").toUpperCase();
    currentMappingMode = message.mappingMode || "relative";
    currentInputMode = message.mode || "center";
    mobileKeyboardVisible = message.mobileKeyboardVisible !== false;
    applyModeClasses();
  }
});

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", startGesture);
canvas.addEventListener("pointermove", moveGesture);
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointerleave", endGesture);
canvas.addEventListener("pointercancel", endGesture);

resizeCanvas();
applyModeClasses();
