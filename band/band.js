// /band: a display of its own for the Neural Band. It opens a band room on the
// server, Kinesis (on a Mac) joins it, and every band-batch it sends is drawn
// here as it arrives. Raw data only: no keyboard and no mapping yet.
//
// band-batch: {seq, sent (Kinesis wall clock, ms), rx (server, ms), events: [
//   {event: "gyro"|"quat"|"gesture", at (Mac uptime, s), t (band clock, µs),
//    v: [...] (quat: w x y z) | finger/action/derived, late}
//   or, with Kinesis's raw sEMG switch on: {event: "emg", t, seq, d (base64: 16 samples ×
//    8 channels, little-endian UInt16, sample by sample), late}]}
// ?ws=ws://localhost:8790 points the page at another server.

const WS_URL = new URLSearchParams(location.search).get("ws") || window.GESTURE_CONFIG.backendWsUrl;
const WINDOW_S = 10;
const TRAIL_S = 3;
const GYRO_SCALE = 0.07; // counts → deg/s, Kinesis's observed scale

const el = (id) => document.getElementById(id);
const codeEl = el("code"), statusEl = el("status"), dotEl = el("dot"), deviceEl = el("device");
const gestureList = el("gestures"), countsEl = el("counts");
const recordButton = el("record"), recordInfo = el("record-info");

let socket = null;
let paired = false;
let quats = [];   // {t (s, band clock), az, el}
let gyros = [];   // {t, x, y, z}
let arrivals = { gyro: [], quat: [], batch: [], late: [], emg: [] }; // page receive times (ms), for rates
// raw sEMG: the last EMG_SECONDS of each of the 8 channels, as a ring
const EMG_RATE = 2048, EMG_SECONDS = 2, EMG_CHANNELS = 8;
const emgRing = Array.from({ length: EMG_CHANNELS }, () => new Float32Array(EMG_RATE * EMG_SECONDS));
let emgHead = 0, emgSeen = 0;
let e2e = [];     // {at, ms}
let gestureCount = 0;
let gestureCounts = new Map();
let aimRef = null;
let lastAz = null;
let recording = null;

// ---- connection ----

function setStatus(text, state) {
  statusEl.textContent = text;
  dotEl.className = "dot" + (state ? " " + state : "");
}

function connect() {
  setStatus("connecting…");
  const ws = new WebSocket(WS_URL);
  socket = ws;
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", role: "display", kind: "band" }));
  });
  ws.addEventListener("message", (event) => {
    if (ws !== socket) return;
    let message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    onMessage(message);
  });
  ws.addEventListener("close", () => {
    if (ws !== socket) return;
    paired = false;
    codeEl.textContent = "····";
    deviceEl.textContent = "";
    setStatus("reconnecting…", "wait");
    setTimeout(connect, 1500);
  });
}

function onMessage(message) {
  switch (message.type) {
    case "room-created":
      codeEl.textContent = message.code;
      setStatus("waiting for band…", "wait");
      break;
    case "band-joined": {
      paired = true;
      resetStreams();
      const info = message.deviceInfo || {};
      handSign = info.hand === "left" ? -1 : 1;
      deviceEl.textContent = [info.app, info.hand && `${info.hand} hand`].filter(Boolean).join(" · ");
      setStatus("band live", "on");
      recordButton.disabled = false;
      break;
    }
    case "band-left":
      paired = false;
      el("rec").hidden = true;
      deviceEl.textContent = "";
      setStatus("waiting for band…", "wait");
      break;
    case "band-status":
      if (message.hand) handSign = message.hand === "left" ? -1 : 1;
      if (message.connected === false) setStatus("band not connected", "wait");
      else if (paired) setStatus("band live", "on");
      break;
    case "band-batch":
      onBatch(message);
      break;
    case "band-recording":
      el("rec").hidden = !message.on;
      break;
  }
}

function resetStreams() {
  quats = []; gyros = []; aimRef = null; lastAz = null;
}

// ---- data ----

// Kinesis sends quaternions as [w, x, y, z]. Like its ForearmAim, the pointer is the
// band's +y axis (toward the hand on a right wrist, toward the elbow on a left one) in
// the world frame; azimuth there grows to the left, so "right" is its negative.
let handSign = 1;

function forearmOf(v) {
  const [w, x, y, z] = v;
  return [2 * (x * y - w * z) * handSign, (1 - 2 * (x * x + z * z)) * handSign, 2 * (y * z + w * x) * handSign];
}

function aimOf(v) {
  const [fx, fy, fz] = forearmOf(v);
  let right = -Math.atan2(fy, fx) * 180 / Math.PI;
  if (lastAz !== null) {
    while (right - lastAz > 180) right -= 360;
    while (right - lastAz < -180) right += 360;
  }
  lastAz = right;
  return { az: right, el: Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI };
}

// raw events for other modules on this page (the guided collection)
const bandListeners = [];
function sendToServer(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function onBatch(batch) {
  const now = Date.now();
  if (recording) recording.push({ ...batch, page: now });
  arrivals.batch.push(now);
  if (typeof batch.sent === "number") e2e.push({ at: now, ms: now - batch.sent });
  for (const e of batch.events || []) {
    for (const listener of bandListeners) listener(e);
    const t = e.t / 1e6;
    if (e.event === "quat" && Array.isArray(e.v)) {
      const aim = aimOf(e.v);
      if (!aimRef) aimRef = aim;
      quats.push({ t, ...aim });
      arrivals.quat.push(now);
      if (e.late) arrivals.late.push(now);
    } else if (e.event === "gyro" && Array.isArray(e.v)) {
      gyros.push({ t, x: e.v[0] * GYRO_SCALE, y: e.v[1] * GYRO_SCALE, z: e.v[2] * GYRO_SCALE });
      arrivals.gyro.push(now);
    } else if (e.event === "gesture") {
      addGesture(e);
    } else if (e.event === "emg" && typeof e.d === "string") {
      addEMG(e.d);
      arrivals.emg.push(now);
    }
  }
  const latest = Math.max(quats.length ? quats[quats.length - 1].t : 0, gyros.length ? gyros[gyros.length - 1].t : 0);
  quats = quats.filter((q) => latest - q.t <= WINDOW_S);
  gyros = gyros.filter((g) => latest - g.t <= WINDOW_S);
}

function addEMG(base64) {
  const bin = atob(base64);
  const n = Math.floor(bin.length / 2);
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const ch = i % EMG_CHANNELS;
    emgRing[ch][emgHead] = v;
    if (ch === EMG_CHANNELS - 1) emgHead = (emgHead + 1) % emgRing[0].length;
  }
  emgSeen += n / EMG_CHANNELS;
}

function drawEMG(canvas) {
  const { ctx, width, height } = prepare(canvas);
  const lane = height / EMG_CHANNELS, len = emgRing[0].length;
  ctx.strokeStyle = css("--hair");
  ctx.lineWidth = 1;
  for (let c = 1; c < EMG_CHANNELS; c++) { ctx.beginPath(); ctx.moveTo(0, c * lane); ctx.lineTo(width, c * lane); ctx.stroke(); }
  if (!emgSeen) {
    ctx.fillStyle = css("--ink-faint");
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("No sEMG yet: turn on “stream raw sEMG” in Kinesis (band page › gesture typing).", 8, 18);
    return;
  }
  const shown = Math.min(len, emgSeen);
  const step = Math.max(1, Math.floor(shown / (width * 2)));
  ctx.strokeStyle = css("--ink");
  for (let c = 0; c < EMG_CHANNELS; c++) {
    const ring = emgRing[c];
    // the channel's mean and spread over what is shown: centre it, scale to its lane
    let sum = 0, sq = 0;
    for (let k = 0; k < shown; k++) { const v = ring[(emgHead - shown + k + len) % len]; sum += v; sq += v * v; }
    const mean = sum / shown, sd = Math.sqrt(Math.max(1, sq / shown - mean * mean));
    const mid = (c + 0.5) * lane, scale = (lane * 0.42) / (3 * sd);
    ctx.beginPath();
    for (let k = 0; k < shown; k += step) {
      const v = ring[(emgHead - shown + k + len) % len];
      const x = (k / (len - 1)) * width, y = mid - Math.max(-lane / 2, Math.min(lane / 2, (v - mean) * scale));
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = css("--ink-faint");
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillText(`ch ${c + 1}`, 4, c * lane + 12);
  }
}

function addGesture(e) {
  gestureCount += 1;
  const primary = e.action && e.action !== "unknown";
  const label = primary ? e.action : e.derived;
  const key = `${e.finger} ${label}`;
  gestureCounts.set(key, (gestureCounts.get(key) || 0) + 1);
  const empty = gestureList.querySelector(".empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  li.innerHTML = `<span class="time"></span><span></span><span class="late"></span>`;
  li.children[0].textContent = time;
  li.children[1].textContent = `${e.finger} · ${label}`;
  if (!primary) li.children[1].style.color = "var(--ink-faint)";
  if (e.late) li.children[2].textContent = "late";
  gestureList.prepend(li);
  while (gestureList.children.length > 60) gestureList.lastChild.remove();
  countsEl.textContent = [...gestureCounts].filter(([k]) => !/unknown|button|Tap|Hold/.test(k.split(" ")[1]))
    .map(([k, n]) => `${k} ×${n}`).join(" · ");
}

// ---- stats ----

function perSecond(list, now) {
  while (list.length && now - list[0] > 1000) list.shift();
  return list.length;
}

function percentile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function updateStats() {
  const now = Date.now();
  const gyro = perSecond(arrivals.gyro, now), quat = perSecond(arrivals.quat, now);
  el("s-gyro").firstChild.textContent = paired ? gyro : "–";
  el("s-quat").firstChild.textContent = paired ? quat : "–";
  el("s-batch").firstChild.textContent = paired ? perSecond(arrivals.batch, now) : "–";
  const late = perSecond(arrivals.late, now);
  el("s-late").firstChild.textContent = paired && quat ? Math.round((late / quat) * 100) : "–";
  e2e = e2e.filter((x) => now - x.at <= 5000);
  const ms = e2e.map((x) => x.ms);
  el("s-e2e").firstChild.textContent = ms.length ? `${Math.round(percentile(ms, 0.5))} / ${Math.round(percentile(ms, 0.95))}` : "–";
  el("s-gest").textContent = gestureCount;
  const emg = perSecond(arrivals.emg, now);
  el("s-emg").firstChild.textContent = paired && emg ? emg * 16 : "–";
}

// ---- drawing ----

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function prepare(canvas) {
  const ratio = devicePixelRatio || 1;
  const width = canvas.clientWidth, height = Number(canvas.getAttribute("height"));
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawSeries(canvas, rows, series, span) {
  const { ctx, width, height } = prepare(canvas);
  if (!rows.length) return;
  const end = rows[rows.length - 1].t;
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) for (const s of series) { lo = Math.min(lo, r[s.key]); hi = Math.max(hi, r[s.key]); }
  const pad = Math.max(span, hi - lo) * 0.1 + 1;
  const mid = (hi + lo) / 2, half = Math.max(span, hi - lo) / 2 + pad;
  const y = (v) => height / 2 - ((v - mid) / half) * (height / 2);
  const x = (t) => width - ((end - t) / WINDOW_S) * width;
  ctx.strokeStyle = css("--hair");
  ctx.lineWidth = 1;
  const step = half > 120 ? 50 : 10;
  for (let g = Math.ceil((mid - half) / step) * step; g <= mid + half; g += step) {
    ctx.beginPath(); ctx.moveTo(0, y(g)); ctx.lineTo(width, y(g)); ctx.stroke();
  }
  for (const s of series) {
    ctx.strokeStyle = css(s.color);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    rows.forEach((r, i) => (i ? ctx.lineTo(x(r.t), y(r[s.key])) : ctx.moveTo(x(r.t), y(r[s.key]))));
    ctx.stroke();
  }
}

function drawTrail(canvas) {
  const { ctx, width, height } = prepare(canvas);
  const scale = Math.min(width, height) / 90; // ±45° fits
  const cx = width / 2, cy = height / 2;
  ctx.strokeStyle = css("--hair");
  ctx.lineWidth = 1;
  for (let d = -40; d <= 40; d += 10) {
    ctx.beginPath(); ctx.moveTo(cx + d * scale, 0); ctx.lineTo(cx + d * scale, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy + d * scale); ctx.lineTo(width, cy + d * scale); ctx.stroke();
  }
  if (!quats.length || !aimRef) return;
  const end = quats[quats.length - 1].t;
  const recent = quats.filter((q) => end - q.t <= TRAIL_S);
  const red = css("--red");
  ctx.lineWidth = 2;
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1], b = recent[i];
    ctx.globalAlpha = 0.15 + 0.85 * (1 - (end - b.t) / TRAIL_S);
    ctx.strokeStyle = red;
    ctx.beginPath();
    ctx.moveTo(cx + (a.az - aimRef.az) * scale, cy - (a.el - aimRef.el) * scale);
    ctx.lineTo(cx + (b.az - aimRef.az) * scale, cy - (b.el - aimRef.el) * scale);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const last = recent[recent.length - 1];
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.arc(cx + (last.az - aimRef.az) * scale, cy - (last.el - aimRef.el) * scale, 5, 0, Math.PI * 2);
  ctx.fill();
}

function frame() {
  drawSeries(el("aim"), quats, [{ key: "az", color: "--blue" }, { key: "el", color: "--red" }], 20);
  drawSeries(el("gyro"), gyros, [{ key: "x", color: "--blue" }, { key: "y", color: "--red" }, { key: "z", color: "--green" }], 40);
  drawTrail(el("trail"));
  drawEMG(el("emg"));
  requestAnimationFrame(frame);
}

// ---- recording ----

recordButton.addEventListener("click", () => {
  if (!recording) {
    recording = [];
    recordButton.textContent = "Stop and download";
    recordButton.classList.add("rec");
    recordInfo.textContent = "Recording…";
    return;
  }
  const lines = recording.map((b) => JSON.stringify(b)).join("\n") + "\n";
  const blob = new Blob([lines], { type: "application/x-ndjson" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `band-${codeEl.textContent}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  link.click();
  recordInfo.textContent = `Downloaded ${recording.length} batches`;
  recording = null;
  recordButton.textContent = "Record";
  recordButton.classList.remove("rec");
});

setInterval(() => {
  updateStats();
  if (recording) recordInfo.textContent = `Recording… ${recording.length} batches`;
}, 250);
connect();
requestAnimationFrame(frame);
