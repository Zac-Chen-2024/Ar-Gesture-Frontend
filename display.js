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

  // top-1 sits center-stage (bold); 2nd/3rd flank it, 4th/5th at the edges.
  // MUST match the server's CANDIDATE_DISPLAY_ORDER — picks are positional.
  const ORDER = [3, 1, 0, 2, 4];
  for (let p = 0; p < 5; p += 1) {
    const candidate = list[ORDER[p]];
    const word = candidate ? candidate.word : "";
    const seg = document.createElement("div");
    seg.className = "candidate-seg" + (ORDER[p] === 0 && candidate ? " is-top" : "");
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

// ---- decode-score panel (staged score pipeline, v2f) ----
// four slots: path / shape / final / extra — stages arrive from the server as
// an ordered array, so new score components plug in without frontend changes
const SCORE_SLOTS = ["path", "shape", "final", "extra"];
const scoreListEls = {};
const scoreHeadEls = {};
for (const slot of SCORE_SLOTS) {
  scoreListEls[slot] = document.getElementById(`list-${slot}`);
  scoreHeadEls[slot] = document.getElementById(`head-${slot}`);
}
const scorePanelEl = document.getElementById("score-panel");
const scoreToggleBtn = document.getElementById("score-toggle");

function scoreRows(container, list, preRankByWord) {
  container.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    return; // lists render only when there are words; the frame stays put
  }
  const scores = list.map((r) => r.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const span = max - min || 1;
  list.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "score-row" + (i === 0 ? " is-top1" : "");
    // bar length: best score fills, worst nearly empty (floor keeps it visible)
    row.style.setProperty("--w", `${8 + 92 * ((r.score - min) / span)}%`);
    const rank = document.createElement("span");
    rank.className = "score-rank";
    rank.textContent = String(i + 1);
    const word = document.createElement("span");
    word.className = "score-word";
    word.textContent = r.word;
    const val = document.createElement("span");
    val.className = "score-val";
    val.textContent = r.score.toFixed(2);
    row.append(rank, word, val);
    if (preRankByWord) {
      const delta = document.createElement("span");
      const was = preRankByWord.get(r.word);
      if (was === undefined) {
        delta.className = "score-delta up";
        delta.textContent = "new";
      } else if (was > i) {
        delta.className = "score-delta up";
        delta.textContent = `↑${was - i}`;
      } else if (was < i) {
        delta.className = "score-delta down";
        delta.textContent = `↓${i - was}`;
      } else {
        delta.className = "score-delta same";
        delta.textContent = "=";
      }
      row.appendChild(delta);
    }
    container.appendChild(row);
  });
}

function renderScoreDebug(debug) {
  const stages = (debug && debug.stages) || [];
  const bySlot = {};
  const overflow = [];
  for (const st of stages) {
    if (SCORE_SLOTS.includes(st.id) && !bySlot[st.id]) {
      bySlot[st.id] = st;
    } else {
      overflow.push(st);
    }
  }
  if (!bySlot.extra && overflow.length) {
    bySlot.extra = overflow[0];
  }
  let prevList = null; // each stage's deltas compare against the stage before it
  for (const slot of SCORE_SLOTS) {
    const el = scoreListEls[slot];
    if (!el) continue;
    const st = bySlot[slot];
    if (!st) {
      // live slots stay blank until there are words; future slots say so
      const reservedText = { shape: "reserved · shape score", extra: "reserved" }[slot];
      if (reservedText) {
        el.classList.add("is-placeholder");
        el.textContent = reservedText;
      } else {
        el.classList.remove("is-placeholder");
        el.innerHTML = "";
      }
      continue;
    }
    el.classList.remove("is-placeholder");
    if (scoreHeadEls[slot] && st.label) {
      const prevWord = slot === "final" && debug.prev ? ` · prev "${debug.prev}"` : "";
      const nums = { path: "①", shape: "②", final: "③", extra: "④" };
      scoreHeadEls[slot].textContent = `${nums[slot]} ${st.label}${prevWord}`;
    }
    const rankMap = prevList
      ? new Map(prevList.map((r, i) => [r.word, i]))
      : null;
    scoreRows(el, st.list || [], rankMap);
    if (st.list && st.list.length) {
      prevList = st.list;
    }
  }
}

function renderScoreParams(params) {
  const runtimeEl = document.getElementById("params-runtime");
  const compiledEl = document.getElementById("params-compiled");
  if (!runtimeEl || !compiledEl) {
    return;
  }
  const fill = (el, tag, rows) => {
    el.innerHTML = `<div class="score-param-tag">${tag}</div>`;
    for (const [k, v] of rows || []) {
      const row = document.createElement("div");
      row.className = "score-param-row";
      const key = document.createElement("span");
      key.className = "k";
      key.textContent = k;
      const val = document.createElement("span");
      val.className = "v";
      val.textContent = v === null || v === undefined ? "—" : String(v);
      row.append(key, val);
      el.appendChild(row);
    }
  };
  if (!params) {
    fill(runtimeEl, "runtime", [["n/a", "v2f only"]]);
    compiledEl.innerHTML = "";
    return;
  }
  fill(runtimeEl, "runtime", params.runtime);
  fill(compiledEl, "compiled (rebuild to change)", params.compiled);
}

// collapsible via the toggle button at the frame's top-right (Zac: no thin
// strip — collapsed means gone); expanded by default, state persisted
function applyScoreCollapsed(collapsed) {
  if (scorePanelEl) {
    scorePanelEl.classList.toggle("collapsed", collapsed);
  }
  if (scoreToggleBtn) {
    scoreToggleBtn.textContent = collapsed ? "« Scores" : "Scores »";
    scoreToggleBtn.setAttribute(
      "aria-label", collapsed ? "Show score panel" : "Hide score panel");
  }
}

if (scoreToggleBtn) {
  applyScoreCollapsed(localStorage.getItem("scorePanelCollapsed") === "1");
  scoreToggleBtn.addEventListener("click", () => {
    const collapsed = !scorePanelEl.classList.contains("collapsed");
    localStorage.setItem("scorePanelCollapsed", collapsed ? "1" : "0");
    applyScoreCollapsed(collapsed);
  });
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
      const label = { armed: "lift = input", pending: "place it", positioning: "place it" }[state.mode] || "";
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
// the server only stores on/off, so lan-vs-usb would silently reset to "lan"
// on every reload — persist the display-local choice
if (lanModeSelect) {
  const savedLink = localStorage.getItem("linkMode");
  if (savedLink === "usb" || savedLink === "lan" || savedLink === "server") {
    lanModeSelect.value = savedLink;
  }
}
const lanBadge = document.getElementById("lan-badge");
let isApplyingServerLanMode = false;
let linkModeBounce = false; // true while our own lan<->usb renegotiation bounce is in flight
let currentLanMode = false;
let rtcPeer = null;
let p2pActive = false;
let usbActive = false;
let pathStatsTimer = null;

function linkMode() {
  return lanModeSelect ? lanModeSelect.value : "server";
}

function setP2pActive(active) {
  p2pActive = active;
  if (lanBadge) {
    lanBadge.classList.toggle("is-visible", active || usbActive);
    if (!active && !usbActive) {
      lanBadge.textContent = "LAN ⚡";
    }
  }
}

// ---- USB direct link (ADB reverse tunnel; vendor/adb.bundle.js) ----
// Deterministic cable transport: the phone page connects to 127.0.0.1 and the
// bytes ride the USB cable into this page — no ICE, no network racing. The
// WebRTC LAN path below is untouched and keeps working independently.
const usbButton = document.getElementById("usb-connect");
const usbSetting = document.getElementById("usb-setting");
const usbStatus = document.getElementById("usb-status");
let usbDeviceName = "";

function setUsbStatus(text) {
  if (usbStatus) {
    usbStatus.textContent = text || "";
    usbStatus.hidden = !text;
  }
}

function updateUsbUi() {
  // the USB device button is always available — the ADB tunnel is orthogonal
  // to the Server/LAN transport choice (Zac: don't hide it behind Link=USB)
  if (usbSetting) {
    usbSetting.hidden = false;
  }
}

if (usbButton) {
  usbButton.addEventListener("click", async () => {
    if (!window.UsbDirect || !UsbDirect.supported()) {
      setUsbStatus("WebUSB is not supported in this browser — use Chrome or Edge");
      return;
    }
    usbButton.disabled = true;
    try {
      const info = await UsbDirect.connect({
        onStatus: (text) => setUsbStatus(text),
        onTrace: (msg) => handleP2pTrace(msg),
        onActive: (active) => {
          usbActive = active;
          if (lanBadge) {
            lanBadge.classList.toggle("is-visible", active || p2pActive);
            lanBadge.textContent = active
              ? `USB ⚡ · ${usbDeviceName}` : "LAN ⚡";
          }
        },
        onRtt: (ms) => {
          if (usbActive && lanBadge) {
            lanBadge.textContent = `USB ⚡ ${ms.toFixed(1)}ms · ${usbDeviceName}`;
          }
        },
      });
      usbDeviceName = info.name || info.serial;
    } catch (e) {
      setUsbStatus(e && e.message ? e.message : String(e));
    }
    usbButton.disabled = false;
  });
}

// USB link pinning: keep only candidates we can place on a tethering subnet.
// Chrome obfuscates host candidates as mDNS (.local) names — those cannot be
// classified, so they pass through; the badge below reports the address the
// selected pair ACTUALLY uses, which stats expose post-connect.
function candidateAllowed(candidateStr) {
  const mode = linkMode();
  if (mode === "server") {
    return true;
  }
  // "candidate:<f> <comp> <proto> <prio> <ADDRESS> <port> typ ..."
  const parts = (candidateStr || "").split(" ");
  const addr = parts.length > 4 ? parts[4] : "";
  if (!addr || addr.endsWith(".local")) {
    return true; // mDNS: cannot classify, let ICE try it
  }
  if (addr.includes(":")) {
    // IPv6. Global addresses route via the ISP — they masquerade as "P2P"
    // with WAN latency (observed: 72ms over carrier v6). USB pinning drops
    // v6 entirely; LAN keeps only link-local/ULA.
    if (mode === "usb") {
      return false;
    }
    return addr.startsWith("fe80") || addr.startsWith("fd") || addr.startsWith("fc");
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    return true;
  }
  if (mode === "usb") {
    const subnets = window.GESTURE_CONFIG.usbSubnets || [];
    return subnets.some((p) => addr.startsWith(p));
  }
  // lan: private IPv4 only
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr);
}

// Visual layer: read the selected candidate pair and its live RTT so the
// actual path (cable vs WiFi) is visible instead of guessed.
function startPathStats() {
  stopPathStats();
  pathStatsTimer = setInterval(async () => {
    if (!rtcPeer || !p2pActive || !lanBadge) {
      return;
    }
    let stats;
    try {
      stats = await rtcPeer.getStats();
    } catch (e) {
      return;
    }
    let selectedId = null;
    const pairs = {};
    const cands = {};
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) {
        selectedId = s.selectedCandidatePairId;
      } else if (s.type === "candidate-pair") {
        pairs[s.id] = s;
      } else if (s.type === "local-candidate" || s.type === "remote-candidate") {
        cands[s.id] = s;
      }
    });
    let pair = selectedId ? pairs[selectedId] : null;
    if (!pair) {
      pair = Object.values(pairs).find((p) => p.nominated && p.state === "succeeded");
    }
    if (!pair) {
      return;
    }
    const local = cands[pair.localCandidateId] || {};
    const remote = cands[pair.remoteCandidateId] || {};
    const addr = local.address || local.ip || "";
    const raddr = remote.address || remote.ip || "";
    const subnets = window.GESTURE_CONFIG.usbSubnets || [];
    const onUsb = subnets.some((p) => addr.startsWith(p) || raddr.startsWith(p));
    // in USB mode, warn loudly when an anonymized (mDNS) WiFi candidate won
    // the race anyway — turning the phone's WiFi off forces the cable
    const label = onUsb ? "USB ⚡"
      : (linkMode() === "usb" ? "USB✗ on WiFi (turn phone WiFi off to force the cable)" : "LAN ⚡");
    const rtt = typeof pair.currentRoundTripTime === "number"
      ? ` ${(pair.currentRoundTripTime * 1000).toFixed(1)}ms`
      : "";
    // show the pair's addresses so unknown tethering subnets are identifiable
    const via = addr || raddr ? ` · ${addr || "?"}→${raddr || "?"}` : "";
    lanBadge.textContent = label + rtt + via;
  }, 2000);
}

function stopPathStats() {
  if (pathStatsTimer) {
    clearInterval(pathStatsTimer);
    pathStatsTimer = null;
  }
}

function teardownP2P() {
  setP2pActive(false);
  stopPathStats();
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
    if (e.candidate && candidateAllowed(e.candidate.candidate)) {
      sendMessage({ type: "rtc-ice", candidate: e.candidate });
    }
  };
  rtcPeer.ondatachannel = (e) => {
    const channel = e.channel;
    channel.onopen = () => {
      setP2pActive(true);
      startPathStats();
    };
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
    if (rtcPeer && message.candidate &&
        candidateAllowed(message.candidate.candidate)) {
      rtcPeer.addIceCandidate(message.candidate).catch(() => {});
    }
    return;
  }

  if (message.type === "gesture-cancel") {
    clearCanvas();
    return;
  }

  if (message.type === "gesture-start") {
    if (p2pActive || usbActive) {
      return; // a fast-path channel already rendered this stroke locally
    }
    updateKeyboardReference();
    clearCanvas();
    const nextPoint = toDisplayPoint(message.point);
    moveCursor(nextPoint);
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-move" && lastPoint) {
    if (p2pActive || usbActive) {
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
    if (p2pActive || usbActive) {
      return;
    }
    clearCanvas();
    return;
  }

  if (message.type === "text-update" || message.type === "state-update") {
    plainText = message.text || "";
    decodedText.textContent = plainText;
    decodedText.scrollLeft = decodedText.scrollWidth; // keep the newest words visible

    if ("scoreDebug" in message) {
      renderScoreDebug(message.scoreDebug);
    }

    if ("scoreParams" in message) {
      renderScoreParams(message.scoreParams);
    }

    if ("letters" in message && message.letters !== currentLetters) {
      currentLetters = message.letters;
      renderCandidates(message.candidates || []);
    }

    if ("lanMode" in message) {
      currentLanMode = message.lanMode === true;
      // the server only knows on/off; lan-vs-usb is a display-local choice,
      // so keep "usb" selected when the server echoes enabled=true
      const wanted = currentLanMode
        ? (linkMode() === "usb" ? "usb" : "lan")
        : "server";
      if (!linkModeBounce && lanModeSelect && lanModeSelect.value !== wanted) {
        isApplyingServerLanMode = true;
        lanModeSelect.value = wanted;
        isApplyingServerLanMode = false;
        updateUsbUi();
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
  let prevLinkMode = lanModeSelect.value;
  lanModeSelect.addEventListener("change", () => {
    if (isApplyingServerLanMode) {
      prevLinkMode = lanModeSelect.value;
      return;
    }
    const mode = lanModeSelect.value;
    localStorage.setItem("linkMode", mode);
    updateUsbUi();
    const enabled = mode !== "server";
    const wasEnabled = prevLinkMode !== "server";
    prevLinkMode = mode;
    if (enabled && wasEnabled) {
      // lan <-> usb: the server-side flag does not change, so bounce it to
      // force a fresh offer — candidate filtering only applies at negotiation.
      // The intermediate disabled echo must not touch the select (it would
      // flip usb back to server/lan), hence the bounce guard.
      linkModeBounce = true;
      sendMessage({ type: "lan-mode-set", enabled: false });
      setTimeout(() => sendMessage({ type: "lan-mode-set", enabled: true }), 250);
      setTimeout(() => { linkModeBounce = false; }, 900);
      return;
    }
    sendMessage({ type: "lan-mode-set", enabled });
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
updateUsbUi();
renderScoreDebug(null);
renderScoreParams(null);
