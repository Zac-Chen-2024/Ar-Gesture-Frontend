const canvas = document.getElementById("display-canvas");
const frame = document.querySelector(".display-frame");
const context = canvas.getContext("2d");
// null while the Mapping selector is commented out in display.html (Relative only)
const mappingModeSelect = document.getElementById("mapping-mode");
const inputModeSelect = document.getElementById("input-mode"); // hidden; driven by the switch below
const inputModeSwitch = document.getElementById("input-mode-switch");
// null while the Trace selector is commented out in display.html (Gesture only)
const visualModeSelect = document.getElementById("visual-mode");
// null while the Phone keys selector is commented out in display.html (Hide only)
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
let currentInputMode = "continuous";
let currentVisualMode = "gesture";
let currentBehavior = "candidates";
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
  if (touchpadActive) {
    moveCursor(touchpadCursorPoint());
  } else {
    updateCursorByKey(currentCursorKey);
  }
}

function updateKeyboardReference() {
  const anchorKey = document.querySelector('[data-key="G"]');
  const anchorRect = anchorKey.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();

  keyboardAnchorPoint = {
    x: anchorRect.left - frameRect.left + anchorRect.width / 2,
    y: anchorRect.top - frameRect.top + anchorRect.height / 2
  };

  // one key unit = the pitch between neighbouring keys (G->H, G->B); adjacent
  // keys share a border, so a key's own box is slightly wider than the pitch
  const rightRect = document.querySelector('[data-key="H"]').getBoundingClientRect();
  const belowRect = document.querySelector('[data-key="B"]').getBoundingClientRect();
  keyboardMetrics = {
    keyWidth: rightRect.left - anchorRect.left || anchorRect.width,
    keyHeight: belowRect.top - anchorRect.top || anchorRect.height
  };
  layoutActionPill(anchorRect);
}

// Size the Clear/Undo pill to the server's real action zone: below the zone
// line (ACTION_ZONE_Y, key heights from G's center) down to where the cursor is
// clamped (+ BAR_BAND_H), and across CLEAR_ZONE_X (Q's left edge to Z's left
// edge), in the same key units the server uses.
function layoutActionPill(anchorRect) {
  const pill = document.getElementById("action-clear");
  if (!pill || !keyboardShell) {
    return;
  }
  const shellRect = keyboardShell.getBoundingClientRect();
  const mode = currentMappingMode === "absolute" ? "absolute" : "relative";
  const centerX = anchorRect.left - shellRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top - shellRect.top + anchorRect.height / 2;
  const { keyWidth, keyHeight } = keyboardMetrics;
  pill.style.left = `${centerX + CLEAR_ZONE_X[0] * keyWidth}px`;
  pill.style.width = `${(CLEAR_ZONE_X[1] - CLEAR_ZONE_X[0]) * keyWidth}px`;
  pill.style.top = `${centerY + ACTION_ZONE_Y[mode] * keyHeight}px`;
  pill.style.height = `${BAR_BAND_H * keyHeight}px`;
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  lastPoint = null;
}

// Visual ceiling for the cursor: the candidate bar acts as the top of the
// world — once in the bar you slide along it (left/right to choose, down to
// leave), never above it. Render-only: the server, decode and gesture logs
// keep the raw unclamped trajectory. MIRRORS server.py CANDIDATE_ZONE_Y_*.
const CANDIDATE_ZONE_Y = { relative: -1.8, absolute: -1.35 };
const ACTION_ZONE_Y = { relative: 1.8, absolute: 1.35 }; // mirrors server.py
const BAR_BAND_H = 0.45; // visual height of the bar band above the zone line
const CLEAR_ZONE_X = [-5, -4]; // Q's left edge to Z's left edge; mirrors server.py

function clampTracePoint(point) {
  const mode = currentMappingMode === "absolute" ? "absolute" : "relative";
  const top = CANDIDATE_ZONE_Y[mode] - BAR_BAND_H;
  const bottom = ACTION_ZONE_Y[mode] + BAR_BAND_H;
  if (point.y < top) return { x: point.x, y: top };
  if (point.y > bottom) return { x: point.x, y: bottom };
  return point;
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
  syncSegmented(inputModeSwitch, inputModeSelect.value);
  inputModeSwitch?.querySelectorAll("button").forEach((button) => {
    button.disabled = isAbsoluteMode;
  });
}

// trace look comes from the active display style (--trace-color/--trace-width)
let traceColor = "#111111";
let traceWidth = 6;

function readTraceStyle() {
  const styles = getComputedStyle(document.body);
  traceColor = styles.getPropertyValue("--trace-color").trim() || "#111111";
  traceWidth = parseFloat(styles.getPropertyValue("--trace-width")) || 6;
}

function drawSegment(from, to) {
  context.strokeStyle = traceColor;
  context.lineWidth = traceWidth;
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
// the top key row): 5 word slots + backspace. Clear/Undo lives in the
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

  // bottom action zone (slide down past the keyboard, lift on the LEFT half)
  const actionPill = document.getElementById("action-clear");
  if (actionPill) {
    actionPill.textContent = currentLetters ? "↩ Undo" : "Clear";
  }
}

// Decode-score panel: commented out (kept for later). The server still sends
// scoreDebug / scoreParams; restore by uncommenting this block, the state-update
// hooks, the startup calls and the <aside> in display.html.
// // ---- decode-score panel (staged score pipeline, v2f) ----
// // four slots: path / shape / final / extra — stages arrive from the server as
// // an ordered array, so new score components plug in without frontend changes
// const SCORE_SLOTS = ["path", "shape", "final", "extra"];
// const scoreListEls = {};
// const scoreHeadEls = {};
// for (const slot of SCORE_SLOTS) {
//   scoreListEls[slot] = document.getElementById(`list-${slot}`);
//   scoreHeadEls[slot] = document.getElementById(`head-${slot}`);
// }
// const scorePanelEl = document.getElementById("score-panel");
// const scoreCollapseBtn = document.getElementById("score-collapse");
// const scoreExpandTab = document.getElementById("score-expand");
//
// function scoreRows(container, list, preRankByWord) {
//   container.innerHTML = "";
//   if (!Array.isArray(list) || list.length === 0) {
//     return; // lists render only when there are words; the frame stays put
//   }
//   const scores = list.map((r) => r.score);
//   const max = Math.max(...scores);
//   const min = Math.min(...scores);
//   const span = max - min || 1;
//   list.forEach((r, i) => {
//     const row = document.createElement("div");
//     row.className = "score-row" + (i === 0 ? " is-top1" : "");
//     // bar length: best score fills, worst nearly empty (floor keeps it visible)
//     row.style.setProperty("--w", `${8 + 92 * ((r.score - min) / span)}%`);
//     const rank = document.createElement("span");
//     rank.className = "score-rank";
//     rank.textContent = String(i + 1);
//     const word = document.createElement("span");
//     word.className = "score-word";
//     word.textContent = r.word;
//     const val = document.createElement("span");
//     val.className = "score-val";
//     val.textContent = r.score.toFixed(2);
//     row.append(rank, word, val);
//     if (preRankByWord) {
//       const delta = document.createElement("span");
//       const was = preRankByWord.get(r.word);
//       if (was === undefined) {
//         delta.className = "score-delta up";
//         delta.textContent = "new";
//       } else if (was > i) {
//         delta.className = "score-delta up";
//         delta.textContent = `↑${was - i}`;
//       } else if (was < i) {
//         delta.className = "score-delta down";
//         delta.textContent = `↓${i - was}`;
//       } else {
//         delta.className = "score-delta same";
//         delta.textContent = "=";
//       }
//       row.appendChild(delta);
//     }
//     container.appendChild(row);
//   });
// }
//
// function renderScoreDebug(debug) {
//   const stages = (debug && debug.stages) || [];
//   const bySlot = {};
//   const overflow = [];
//   for (const st of stages) {
//     if (SCORE_SLOTS.includes(st.id) && !bySlot[st.id]) {
//       bySlot[st.id] = st;
//     } else {
//       overflow.push(st);
//     }
//   }
//   if (!bySlot.extra && overflow.length) {
//     bySlot.extra = overflow[0];
//   }
//   let prevList = null; // each stage's deltas compare against the stage before it
//   for (const slot of SCORE_SLOTS) {
//     const el = scoreListEls[slot];
//     if (!el) continue;
//     const st = bySlot[slot];
//     if (!st) {
//       // live slots stay blank until there are words; future slots say so
//       const reservedText = { shape: "reserved · shape score", extra: "reserved" }[slot];
//       if (reservedText) {
//         el.classList.add("is-placeholder");
//         el.textContent = reservedText;
//       } else {
//         el.classList.remove("is-placeholder");
//         el.innerHTML = "";
//       }
//       continue;
//     }
//     el.classList.remove("is-placeholder");
//     if (scoreHeadEls[slot] && st.label) {
//       const prevWord = slot === "final" && debug.prev ? ` · prev "${debug.prev}"` : "";
//       const nums = { path: "①", shape: "②", final: "③", extra: "④" };
//       scoreHeadEls[slot].textContent = `${nums[slot]} ${st.label}${prevWord}`;
//     }
//     const rankMap = prevList
//       ? new Map(prevList.map((r, i) => [r.word, i]))
//       : null;
//     scoreRows(el, st.list || [], rankMap);
//     if (st.list && st.list.length) {
//       prevList = st.list;
//     }
//   }
// }
//
// function renderScoreParams(params) {
//   const runtimeEl = document.getElementById("params-runtime");
//   const compiledEl = document.getElementById("params-compiled");
//   if (!runtimeEl || !compiledEl) {
//     return;
//   }
//   // never clobber an input the user is typing into
//   if (runtimeEl.contains(document.activeElement)) {
//     return;
//   }
//   const fill = (el, tag, rows, editable) => {
//     el.innerHTML = `<div class="score-param-tag">${tag}</div>`;
//     for (const [k, v] of rows || []) {
//       const row = document.createElement("div");
//       row.className = "score-param-row";
//       const key = document.createElement("span");
//       key.className = "k";
//       key.textContent = k;
//       row.appendChild(key);
//       if (editable) {
//         const PARAM_STEPS = {
//           bigram_table: 1, lambda_bi: 0.1, lambda_shape: 1, junk_cost: 0.1,
//           emission_sigma: 0.05, beam_delta: 1, max_active: 50,
//         };
//         const ctrl = document.createElement("span");
//         ctrl.className = "score-param-ctrl";
//         const input = document.createElement("input");
//         input.className = "v score-param-input";
//         input.type = "number";
//         input.step = "any";
//         input.value = v === null || v === undefined ? "" : String(v);
//         const send = (num) => sendMessage({ type: "param-set", key: k, value: num });
//         const stepBy = (dir) => {
//           const cur = parseFloat(input.value);
//           const step = PARAM_STEPS[k] || 0.1;
//           if (!Number.isFinite(cur)) return;
//           const next = Math.round((cur + dir * step) * 10000) / 10000;
//           input.value = String(next);
//           send(next);
//         };
//         const mkStep = (label, dir) => {
//           const b = document.createElement("button");
//           b.type = "button";
//           b.className = "score-param-step";
//           b.textContent = label;
//           b.setAttribute("aria-label", `${label === "−" ? "Decrease" : "Increase"} ${k}`);
//           b.addEventListener("click", () => stepBy(dir));
//           return b;
//         };
//         input.addEventListener("keydown", (e) => {
//           if (e.key === "Enter") {
//             const num = parseFloat(input.value);
//             if (Number.isFinite(num)) send(num);
//             input.blur();
//           }
//         });
//         input.addEventListener("blur", () => {
//           const num = parseFloat(input.value);
//           if (Number.isFinite(num) && String(num) !== String(v)) {
//             send(num);
//           }
//         });
//         ctrl.append(mkStep("−", -1), input, mkStep("+", 1));
//         row.appendChild(ctrl);
//       } else {
//         const val = document.createElement("span");
//         val.className = "v";
//         val.textContent = v === null || v === undefined ? "—" : String(v);
//         row.appendChild(val);
//       }
//       el.appendChild(row);
//     }
//   };
//   if (!params) {
//     fill(runtimeEl, "runtime", [["n/a", "v3 only"]], false);
//     compiledEl.innerHTML = "";
//     return;
//   }
//   fill(runtimeEl, "runtime · edit + Enter to apply", params.runtime, true);
//   fill(compiledEl, "compiled (rebuild to change)", params.compiled, false);
// }
//
// // Collapsible: hidden by default, with a slim tab on the right screen edge to
// // expand it. An explicit user choice remains persisted across visits.
// function applyScoreCollapsed(collapsed) {
//   if (scorePanelEl) {
//     scorePanelEl.classList.toggle("collapsed", collapsed);
//   }
//   if (scoreExpandTab) {
//     scoreExpandTab.hidden = !collapsed;
//   }
// }
//
// function setScoreCollapsed(collapsed) {
//   localStorage.setItem("scorePanelCollapsed", collapsed ? "1" : "0");
//   applyScoreCollapsed(collapsed);
// }
//
// if (scoreCollapseBtn && scoreExpandTab) {
//   applyScoreCollapsed(localStorage.getItem("scorePanelCollapsed") !== "0");
//   scoreCollapseBtn.addEventListener("click", () => setScoreCollapsed(true));
//   scoreExpandTab.addEventListener("click", () => setScoreCollapsed(false));
// }

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
  // "lan" is no longer offered (its button is commented out): fall back to Remote
  if (savedLink === "usb" || savedLink === "server") {
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

// ---- Device / Link segmented switches ----
// Device: Touchpad | Phone. Link only applies to the phone, and Connect phone
// only to Link=USB. Touchpad is never restored on load: it needs a click to
// lock the pointer, and Esc always drops back to Phone.
const deviceSwitch = document.getElementById("device-mode");
const linkSwitch = document.getElementById("link-mode");
const linkSetting = document.getElementById("link-setting");
const linkArrow = document.getElementById("link-arrow");
const usbArrow = document.getElementById("usb-arrow");
let deviceMode = "phone";

function syncSegmented(group, value) {
  if (!group) {
    return;
  }
  group.querySelectorAll("button[data-value]").forEach((button) => {
    const on = button.dataset.value === value;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function updateUsbUi() {
  const isPhone = deviceMode === "phone";
  syncSegmented(deviceSwitch, deviceMode);
  syncSegmented(linkSwitch, linkMode());
  const showUsb = isPhone && linkMode() === "usb";
  [linkSetting, linkArrow].forEach((el) => { if (el) el.hidden = !isPhone; });
  [usbSetting, usbArrow].forEach((el) => { if (el) el.hidden = !showUsb; });
}

deviceSwitch?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button || button.dataset.value === deviceMode) {
    return;
  }
  deviceMode = button.dataset.value;
  updateUsbUi();
  // this click is the user activation that pointer lock requires
  if (deviceMode === "touchpad") {
    enterTouchpad();
  } else {
    exitTouchpad();
  }
});

// ---- Touchpad mode: the laptop touchpad stands in for the phone ----
// A second socket joins this display's own room as the "mobile", so the server
// path (decode, candidates, state) is exactly the phone's. The pointer is
// locked (cursor hidden); moving starts a stroke, a click ends it, and the
// movement in between is sent as relative keyboard units like mobile.js.
// Strokes render locally (as the LAN/USB fast paths do). Esc — or losing the
// lock for any reason — leaves touchpad mode and switches Device back to Phone.
const TOUCHPAD_GAIN = 1.0; // cursor px per px of pointer travel
const touchpadHint = document.getElementById("touchpad-hint");
const TOUCHPAD_IDLE_HINT = "Touchpad · move to start a word · click to finish · Esc to exit";
let currentRoomCode = null;
let touchpadSocket = null;
let touchpadActive = false; // joined the room: strokes are ours to render
let touchpadStroke = null; // the stroke being drawn (also queued in touchpadOutbox)

// Unlike a phone, the touchpad has a persistent pointer: a new stroke continues
// exactly where the last one ended instead of snapping to the server's cursor
// key. The server still builds global points as its own start + relative, so
// each stroke's moves are held until the server echoes that start point (the
// display socket's gesture-start), then sent as (true position - server start).
let touchpadPos = { x: 0, y: 0 }; // hidden pointer, keyboard units (G = 0,0)
const touchpadOutbox = []; // strokes in order: { start, sentStart, moves, ended }

function setTouchpadHint(text) {
  if (touchpadHint) {
    touchpadHint.textContent = text || "";
    touchpadHint.hidden = !text;
  }
}

function touchpadSend(payload) {
  if (touchpadSocket && touchpadSocket.readyState === WebSocket.OPEN) {
    touchpadSocket.send(JSON.stringify(payload));
  }
}

function pumpTouchpad() {
  while (touchpadOutbox.length) {
    const stroke = touchpadOutbox[0];
    if (!stroke.sentStart) {
      touchpadSend({ type: "gesture-start", point: { x: 0, y: 0, t: 0 } });
      stroke.sentStart = true;
    }
    if (!stroke.start) {
      return; // wait for the server to tell us where it anchored this stroke
    }
    for (const m of stroke.moves) {
      touchpadSend({
        type: "gesture-move",
        point: { x: m.x - stroke.start.x, y: m.y - stroke.start.y, t: m.t }
      });
    }
    stroke.moves = [];
    if (!stroke.ended) {
      return;
    }
    touchpadSend({ type: "gesture-end" });
    touchpadOutbox.shift();
  }
}

// called from the display socket's gesture-start echo while touchpad is active
function touchpadServerStart(point) {
  const stroke = touchpadOutbox.find((s) => s.sentStart && !s.start);
  if (stroke && point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    stroke.start = { x: point.x, y: point.y };
    pumpTouchpad();
  }
}

function touchpadCursorPoint() {
  return toDisplayPoint(clampTracePoint(touchpadPos));
}

function enterTouchpad() {
  if (!currentRoomCode) {
    exitTouchpad("Touchpad: no session yet — wait for the session code");
    return;
  }
  try {
    const lock = frame.requestPointerLock();
    if (lock && typeof lock.catch === "function") {
      lock.catch(() => exitTouchpad("Touchpad: the browser refused to hide the pointer"));
    }
  } catch (e) {
    exitTouchpad("Touchpad: pointer lock is not supported in this browser");
    return;
  }

  setTouchpadHint("Touchpad · connecting…");
  const ws = new WebSocket(window.GESTURE_CONFIG.backendWsUrl);
  touchpadSocket = ws;
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", role: "mobile" }));
    ws.send(JSON.stringify({ type: "join-room", code: currentRoomCode }));
  });
  ws.addEventListener("message", (event) => {
    if (ws !== touchpadSocket) {
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (message.type === "room-joined") {
      touchpadActive = true;
      touchpadPos = keyboardUnitsOfKey(currentCursorKey); // pick up where the cursor is
      moveCursor(touchpadCursorPoint());
      setTouchpadHint(TOUCHPAD_IDLE_HINT);
    } else if (message.type === "room-error" || message.type === "room-closed") {
      exitTouchpad(`Touchpad: ${message.message || "could not join the session"}`);
    }
  });
  ws.addEventListener("close", () => {
    if (ws === touchpadSocket) {
      exitTouchpad("Touchpad: connection closed");
    }
  });
}

function exitTouchpad(reason) {
  const head = touchpadOutbox[0];
  if (head && head.sentStart) {
    touchpadSend({ type: "gesture-end" }); // never leave the server mid-stroke
  }
  touchpadOutbox.length = 0;
  touchpadStroke = null;
  touchpadActive = false;
  const ws = touchpadSocket;
  touchpadSocket = null; // clear first: the close/lock events below must not re-enter
  if (ws) {
    ws.close();
  }
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  setTouchpadHint("");
  clearCanvas();
  updateCursorByKey(currentCursorKey);
  if (reason) {
    setUsbStatus(reason);
    setTimeout(() => setUsbStatus(""), 4000);
  }
  if (deviceMode === "touchpad") {
    deviceMode = "phone";
    updateUsbUi();
  }
}

function startTouchpadStroke() {
  if (currentInputMode === "center") {
    touchpadPos = { x: 0, y: 0 }; // Word start = Center: every word starts at G
  }
  touchpadStroke = { start: null, sentStart: false, moves: [], ended: false, t0: performance.now() };
  touchpadOutbox.push(touchpadStroke);
  pumpTouchpad();

  updateKeyboardReference();
  clearCanvas();
  lastPoint = touchpadCursorPoint();
  moveCursor(lastPoint);
  setTouchpadHint("Touchpad · drawing — click to finish · Esc to exit");
}

function moveTouchpadStroke(dx, dy) {
  const { keyWidth, keyHeight } = keyboardMetrics;
  if (!keyWidth || !keyHeight) {
    return;
  }
  // the pointer stays on the keyboard band, like a cursor at a screen edge
  const next = clampTracePoint({
    x: touchpadPos.x + (dx * TOUCHPAD_GAIN) / keyWidth,
    y: touchpadPos.y + (dy * TOUCHPAD_GAIN) / keyHeight
  });
  touchpadPos = { x: Math.max(-5.5, Math.min(5.5, next.x)), y: next.y };
  touchpadStroke.moves.push({
    x: touchpadPos.x,
    y: touchpadPos.y,
    t: Math.round(performance.now() - touchpadStroke.t0)
  });
  pumpTouchpad();

  const p = touchpadCursorPoint();
  moveCursor(p);
  if (currentVisualMode === "gesture" && lastPoint) {
    drawSegment(lastPoint, p);
  }
  lastPoint = p;
}

function endTouchpadStroke() {
  touchpadStroke.ended = true;
  touchpadStroke = null;
  pumpTouchpad();

  // back to G right away when: Word start = Center (every word starts at G),
  // or the stroke ended in the candidate bar (pick / backspace) or the bottom
  // action zone (Clear)
  if (
    currentInputMode === "center" ||
    touchpadPos.y <= CANDIDATE_ZONE_Y.relative ||
    touchpadPos.y >= ACTION_ZONE_Y.relative
  ) {
    touchpadPos = { x: 0, y: 0 };
  }
  clearCanvas();
  moveCursor(touchpadCursorPoint());
  if (touchpadActive) {
    setTouchpadHint(TOUCHPAD_IDLE_HINT);
  }
}

document.addEventListener("pointerlockchange", () => {
  if (deviceMode === "touchpad" && document.pointerLockElement !== frame) {
    exitTouchpad();
  }
});

document.addEventListener("keydown", (event) => {
  // Esc normally just releases the lock (handled above); this covers the
  // case where the lock never engaged
  if (event.key === "Escape" && deviceMode === "touchpad") {
    exitTouchpad();
  }
});

// a click only ever ends the stroke in progress; starting is done by moving
document.addEventListener("mousedown", (event) => {
  if (!touchpadActive || document.pointerLockElement !== frame || event.button !== 0) {
    return;
  }
  event.preventDefault();
  if (touchpadStroke) {
    endTouchpadStroke();
  }
});

document.addEventListener("mousemove", (event) => {
  if (!touchpadActive || document.pointerLockElement !== frame) {
    return;
  }
  // idle: any movement starts a stroke
  if (!touchpadStroke) {
    startTouchpadStroke();
  }
  moveTouchpadStroke(event.movementX, event.movementY);
});

linkSwitch?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button || !lanModeSelect || button.dataset.value === lanModeSelect.value) {
    return;
  }
  lanModeSelect.value = button.dataset.value;
  lanModeSelect.dispatchEvent(new Event("change"));
});

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
    const p = toDisplayPoint(clampTracePoint(p2pGlobalPoint(msg)));
    moveCursor(p);
    lastPoint = p;
  } else if (msg.kind === "move" && lastPoint) {
    const p = toDisplayPoint(clampTracePoint(p2pGlobalPoint(msg)));
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
    currentRoomCode = code;
    roomCodeBadge.querySelector(".room-code-value").textContent = code;
  }
  roomCodeBadge.classList.toggle("is-paired", Boolean(paired));
  const statusEl = roomCodeBadge.querySelector(".room-code-status");
  if (statusEl) {
    // our own touchpad socket pairs as the "mobile" too
    const pairedLabel = deviceMode === "touchpad" ? "touchpad active" : "phone paired";
    statusEl.textContent = paired ? pairedLabel : "waiting for phone…";
  }
}

socket.addEventListener("open", () => {
  sendMessage({ type: "join", role: "display" });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "room-created") {
    updateRoomBadge(message.code, false);
    // restoreLexicon();  // dictionary picker is hidden: keep the server default
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
    if (!touchpadActive) {
      clearCanvas(); // touchpad clears locally; a late echo must not wipe the next stroke
    }
    return;
  }

  if (message.type === "action-hover") {
    const pill = document.getElementById("action-clear");
    if (pill) {
      pill.classList.toggle("is-hover", message.active === true);
    }
    return;
  }

  if (message.type === "gesture-start") {
    if (touchpadActive) {
      touchpadServerStart(message.point); // strokes are drawn locally; just learn the anchor
      return;
    }
    if (p2pActive || usbActive) {
      return; // a fast-path channel already rendered this stroke locally
    }
    updateKeyboardReference();
    clearCanvas();
    const nextPoint = toDisplayPoint(clampTracePoint(message.point));
    moveCursor(nextPoint);
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-move" && lastPoint) {
    if (p2pActive || usbActive || touchpadActive) {
      return;
    }
    const nextPoint = toDisplayPoint(clampTracePoint(message.point));
    moveCursor(nextPoint);
    if (currentVisualMode === "gesture") {
      drawSegment(lastPoint, nextPoint);
    }
    lastPoint = nextPoint;
    return;
  }

  if (message.type === "gesture-end") {
    // ALWAYS clear, even when a fast-path channel is active: if that
    // channel's own "end" was lost or raced a stale active-flag, this is the
    // backstop that wipes leftover trace tails. Double-clearing is harmless
    // (clearCanvas nulls lastPoint, so late fast-path moves can't redraw).
    // Touchpad is the exception: it clears on its own click, and this echo can
    // arrive after the next stroke has already started drawing.
    if (!touchpadActive) {
      clearCanvas();
    }
    return;
  }

  if (message.type === "text-update" || message.type === "state-update") {
    plainText = message.text || "";
    decodedText.textContent = plainText;
    decodedText.scrollLeft = decodedText.scrollWidth; // keep the newest words visible

    // decode-score panel is commented out
    // if ("scoreDebug" in message) {
    //   renderScoreDebug(message.scoreDebug);
    // }
    //
    // if ("scoreParams" in message) {
    //   renderScoreParams(message.scoreParams);
    // }

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

    if (message.mappingMode && mappingModeSelect && mappingModeSelect.value !== message.mappingMode) {
      isApplyingServerMappingMode = true;
      mappingModeSelect.value = message.mappingMode;
      isApplyingServerMappingMode = false;
    }

    if (!mappingModeSelect && message.mappingMode && message.mappingMode !== "relative") {
      // no selector to get out of absolute — pin the session back to relative
      sendMessage({ type: "mapping-mode-set", mappingMode: "relative" });
    }

    if (message.mode && inputModeSelect.value !== message.mode) {
      isApplyingServerMode = true;
      inputModeSelect.value = message.mode;
      isApplyingServerMode = false;
    }

    if (message.visualMode && visualModeSelect && visualModeSelect.value !== message.visualMode) {
      isApplyingServerVisualMode = true;
      visualModeSelect.value = message.visualMode;
      isApplyingServerVisualMode = false;
    }

    if (!visualModeSelect && message.visualMode && message.visualMode !== "gesture") {
      // no selector to get back to the trail — pin the session to gesture
      sendMessage({ type: "visual-mode-set", visualMode: "gesture" });
    }

    if (typeof message.mobileKeyboardVisible === "boolean") {
      const nextMobileKeyboardMode = message.mobileKeyboardVisible ? "show" : "hide";
      if (mobileKeyboardModeSelect && mobileKeyboardModeSelect.value !== nextMobileKeyboardMode) {
        isApplyingServerMobileKeyboardMode = true;
        mobileKeyboardModeSelect.value = nextMobileKeyboardMode;
        isApplyingServerMobileKeyboardMode = false;
      }
      if (!mobileKeyboardModeSelect && message.mobileKeyboardVisible) {
        // no selector to turn it off — pin the session back to hidden
        sendMessage({ type: "mobile-keyboard-set", visible: false });
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
      if (!touchpadActive) {
        updateCursorByKey(currentCursorKey); // touchpad keeps its own unsnapped pointer
      }
    }

    if (message.code) {
      updateRoomBadge(message.code, message.mobilePaired === true);
    }

    if (message.versions) {
      populateVersions(message.versions);
    }

    if ("lexicon" in message) {
      applyLexiconState(message);
    }

    if ("testMode" in message && message.testMode !== testMode) {
      testMode = message.testMode === true;
      renderBuildBadge();
    }

    if (message.version && algoVersionSelect.value !== message.version) {
      isApplyingServerVersion = true;
      algoVersionSelect.value = message.version;
      isApplyingServerVersion = false;
    }

    if (typeof message.behavior === "string") {
      currentBehavior = message.behavior;
    }

    if (message.reset && touchpadActive) {
      touchpadPos = { x: 0, y: 0 }; // server reset input state: cursor back to G
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

mappingModeSelect?.addEventListener("change", () => {
  if (isApplyingServerMappingMode) {
    return;
  }

  sendMessage({
    type: "mapping-mode-set",
    mappingMode: mappingModeSelect.value
  });
});

inputModeSwitch?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button || button.disabled || button.dataset.value === inputModeSelect.value) {
    return;
  }
  inputModeSelect.value = button.dataset.value;
  inputModeSelect.dispatchEvent(new Event("change"));
  syncSegmented(inputModeSwitch, inputModeSelect.value);
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

visualModeSelect?.addEventListener("change", () => {
  if (isApplyingServerVisualMode) {
    return;
  }

  sendMessage({
    type: "visual-mode-set",
    visualMode: visualModeSelect.value
  });
});

mobileKeyboardModeSelect?.addEventListener("change", () => {
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

// ---- display style (purely visual; geometry is re-measured on switch) ----
// bottom-left icon cycles through the styles; the choice is kept per browser
const THEMES = ["original", "editorial"];
const THEME_NAMES = { original: "Original", editorial: "Editorial" };
const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  const name = THEMES.includes(theme) ? theme : "original";
  document.body.dataset.theme = name;
  if (themeToggle) {
    themeToggle.title = `Style: ${THEME_NAMES[name]} (click to switch)`;
  }
  readTraceStyle();
  resizeCanvas(); // keys may have moved: re-anchor cursor mapping to G
}

themeToggle?.addEventListener("click", () => {
  const current = THEMES.indexOf(document.body.dataset.theme);
  const next = THEMES[(current + 1) % THEMES.length];
  localStorage.setItem("displayTheme", next);
  applyTheme(next);
});

// ---- dictionary picker (Local-AOM decode lexicon; kept per browser) ----
const lexiconToggle = document.getElementById("lexicon-toggle");
const lexiconMenu = document.getElementById("lexicon-menu");
const lexiconOptions = document.getElementById("lexicon-options");
const lexiconMenuNote = document.getElementById("lexicon-menu-note");
let lexiconState = { current: null, options: [], supported: true };

function formatWordCount(words) {
  return Number.isFinite(words) ? `${words.toLocaleString("en-US")} words` : "";
}

function renderLexiconPicker() {
  if (!lexiconToggle || !lexiconMenu) {
    return;
  }
  const { current, options, supported } = lexiconState;
  const active = options.find((row) => row.id === current);
  lexiconToggle.classList.toggle("is-inactive", !supported);
  lexiconToggle.title = supported
    ? `Dictionary: ${active ? active.name : "…"} (click to change)`
    : `Dictionary: ${active ? active.name : "…"} (only used by Local-AOM)`;
  lexiconMenu.classList.toggle("is-inactive", !supported);
  lexiconMenuNote.textContent = supported ? "Local-AOM" : "Local-AOM only";

  lexiconOptions.innerHTML = "";
  options.forEach((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lexicon-option";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", row.id === current ? "true" : "false");
    button.classList.toggle("is-active", row.id === current);
    button.innerHTML =
      '<span class="lexicon-option-check"></span>' +
      '<span class="lexicon-option-name"></span>' +
      '<span class="lexicon-option-words"></span>';
    button.querySelector(".lexicon-option-check").textContent = row.id === current ? "✓" : "";
    button.querySelector(".lexicon-option-name").textContent = row.name;
    button.querySelector(".lexicon-option-words").textContent = formatWordCount(row.words);
    button.addEventListener("click", () => selectLexicon(row.id));
    lexiconOptions.appendChild(button);
  });
}

function setLexiconMenuOpen(open) {
  if (!lexiconToggle || !lexiconMenu) {
    return;
  }
  lexiconMenu.hidden = !open;
  lexiconToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function selectLexicon(id) {
  localStorage.setItem("lexicon", id);
  lexiconState.current = id; // optimistic; the server echoes it in state-update
  renderLexiconPicker();
  setLexiconMenuOpen(false);
  sendMessage({ type: "lexicon-set", lexicon: id });
}

function applyLexiconState(message) {
  lexiconState = {
    current: message.lexicon,
    options: Array.isArray(message.lexicons) ? message.lexicons : lexiconState.options,
    supported: message.lexiconSupported !== false,
  };
  renderLexiconPicker();
}

// a fresh room starts on the server default: re-apply this browser's choice
function restoreLexicon() {
  const saved = localStorage.getItem("lexicon");
  if (saved) {
    sendMessage({ type: "lexicon-set", lexicon: saved });
  }
}

lexiconToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  setLexiconMenuOpen(lexiconMenu.hidden);
});

document.addEventListener("click", (event) => {
  if (lexiconMenu && !lexiconMenu.hidden && !lexiconMenu.contains(event.target)) {
    setLexiconMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lexiconMenu && !lexiconMenu.hidden) {
    setLexiconMenuOpen(false);
    lexiconToggle.focus();
  }
});

const buildBadge = document.getElementById("build-badge");

// Hidden test-mode switch: four quick clicks on the version badge toggle the
// experimental scoring for this session only (not remembered across reloads).
const TEST_MODE_CLICKS = 4;
const TEST_MODE_WINDOW_MS = 1500;
let testMode = false;
let badgeClicks = [];

function renderBuildBadge() {
  if (buildBadge) {
    const version = window.GESTURE_CONFIG.version || "";
    buildBadge.textContent = testMode ? `${version} · TEST` : version;
  }
}

buildBadge?.addEventListener("click", () => {
  const now = performance.now();
  badgeClicks = badgeClicks.filter((t) => now - t < TEST_MODE_WINDOW_MS);
  badgeClicks.push(now);
  if (badgeClicks.length >= TEST_MODE_CLICKS) {
    badgeClicks = [];
    sendMessage({ type: "test-mode-set", enabled: !testMode });
  }
});

renderBuildBadge();

window.addEventListener("resize", resizeCanvas);
applyTheme(localStorage.getItem("displayTheme") || "editorial"); // Editorial is the default look
applyModeClasses();
renderCandidates([]);
updateUsbUi();
// renderScoreDebug(null);   // decode-score panel is commented out
// renderScoreParams(null);
