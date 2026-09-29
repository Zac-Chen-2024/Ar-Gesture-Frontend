// Participant display. Zero clicks: everything the participant does arrives
// from the server — decoded text, candidates and hovers while typing, and a
// persistent pointer (study-pointer) on the ready / rating / break screens,
// which this page hit-tests. The experimenter drives the rest through
// study-command (console) or the keyboard of this machine.

const RT = window.STUDY_CONFIG_RUNTIME;
const Z = window.ZONES;
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const upper = $("upper");
const stage = $("stage");
const cursorEl = $("cursor");
const traceCanvas = $("trace");
const ctx = traceCanvas.getContext("2d");

// ---------------------------------------------------------------- state

const S = {
  code: null,
  phone: false,
  session: null,
  cfg: null,
  done: new Set(), // "step:trial"
  rated: new Set(),
  step: 0,
  trialIdx: 0,
  screen: "waiting", // waiting | ready | trial | feedback | rating | break | end
  paused: false,
  pending: null, // "open" | "start" | "finish:<status>" | "rating"
  trial: null, // server trial row while typing
  text: "",
  cands: [],
  candHover: -1,
  actionSlot: null,
  cursor: { x: 0, y: 0 },
  stroke: null,
  timing: null, // { tShown, tFirst, tLast, strokes }
  lastResult: null,
  ratingIdx: 0,
  answers: {},
  ratingLog: [],
  breakUntil: 0,
  hoverId: null,
  error: ""
};
let targets = []; // pointer screens: { id, r: [x0, y0, x1, y1], el, enabled }
let feedbackTimer = null;

const sock = window.StudySocket(onMessage, (status) => {
  if (status === "open") sock.send({ type: "join", role: "display" });
  if (status === "closed" || status === "error") {
    S.error = "Connection to the server lost. Reload this page; the session resumes where it stopped.";
    render();
  }
});

const cur = () => S.session && S.session.steps[S.step];
const key = (step, trial) => `${step}:${trial}`;

// ---------------------------------------------------------------- server messages

function onMessage(m) {
  switch (m.type) {
    case "room-created":
      S.code = m.code;
      if (params.get("pid")) openSession(params.get("pid"));
      render();
      break;
    case "mobile-joined":
    case "mobile-left":
      S.phone = m.type === "mobile-joined";
      render();
      break;
    case "state-update":
      onState(m);
      break;
    case "gesture-start":
      if (S.screen !== "trial") return;
      S.stroke = [[m.point.x, m.point.y]];
      S.cursor = { x: m.point.x, y: m.point.y };
      if (S.timing && S.timing.tFirst == null) S.timing.tFirst = performance.now();
      moveCursorEl();
      drawTrace();
      break;
    case "gesture-move":
      if (S.screen !== "trial" || !S.stroke) return;
      S.stroke.push([m.point.x, m.point.y]);
      S.cursor = { x: m.point.x, y: m.point.y };
      moveCursorEl();
      drawTrace();
      break;
    case "gesture-end":
    case "gesture-cancel":
      if (S.timing) S.timing.strokes++;
      S.stroke = null;
      setTimeout(drawTrace, 220);
      break;
    case "candidate-hover":
      S.candHover = m.index;
      paintHover();
      break;
    case "action-hover":
      S.actionSlot = m.slot || (m.active ? "clear" : null);
      paintHover();
      break;
    case "study-next":
      if (S.screen !== "trial" || S.paused || S.pending || !S.trial) return;
      if (!S.text.trim()) return shake("next");
      finishTrial("completed");
      break;
    case "study-pointer":
      onPointer(m);
      break;
    case "study-update":
      onStudyUpdate(m);
      break;
    case "study-command":
      command(m.cmd, m.arg || {});
      break;
  }
}

function onState(m) {
  if (m.study) S.phone = !!m.study.phonePaired;
  const text = m.text || "";
  if (S.screen === "trial" && text !== S.text && S.timing) S.timing.tLast = performance.now();
  S.text = text;
  S.cands = m.candidates || [];
  if (!S.stroke && S.screen === "trial") {
    const k = window.KEY_XY[(m.cursorKey || "g").toLowerCase()] || [0, 0];
    S.cursor = { x: k[0], y: k[1] };
  }
  if (S.screen === "trial") {
    renderTyped();
    renderCandidates();
    moveCursorEl();
  } else if (S.screen === "waiting") {
    render();
  }
}

function onStudyUpdate(m) {
  if (m.error) {
    S.error = m.error;
    S.pending = null;
    render();
    return;
  }
  S.error = "";
  if (m.session) applySession(m.session);
  if (S.pending === "start" && m.trial) {
    S.pending = null;
    S.trial = m.trial;
    S.text = "";
    S.cands = [];
    S.stroke = null;
    S.cursor = { x: 0, y: 0 };
    S.timing = { tShown: performance.now(), tFirst: null, tLast: null, strokes: 0 };
    S.screen = "trial";
    render();
  } else if (S.pending && S.pending.startsWith("finish:") && m.saved) {
    const status = S.pending.slice(7);
    S.pending = null;
    afterFinish(m.saved, status);
  }
}

function applySession(session) {
  const first = !S.session || S.session.id !== session.id;
  S.session = session;
  S.cfg = session.config;
  S.done = new Set(session.done.map((d) => key(d.step, d.trial)));
  S.rated = new Set(session.rated);
  if (S.pending === "open") S.pending = null;
  if (S.pending === "rating" && S.rated.has(cur().cond)) {
    S.pending = null;
    advanceStep();
    return;
  }
  if (first) {
    S.step = resumeStep();
    S.screen = "waiting";
    setPhase("locked", "waiting");
  }
  render();
}

// first step with work left; the break before it is shown again if that step
// has not started yet
function resumeStep() {
  const steps = S.session.steps;
  const doneTrials = (i) => steps[i].phrases.filter((_, t) => S.done.has(key(i, t))).length;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const complete =
      s.kind === "block" ? doneTrials(i) === s.phrases.length : s.kind === "rating" ? S.rated.has(s.cond) : s.kind === "break";
    if (complete) continue;
    const started = s.kind === "block" && doneTrials(i) > 0;
    return i > 0 && steps[i - 1].kind === "break" && !started ? i - 1 : i;
  }
  return steps.length - 1;
}

// ---------------------------------------------------------------- flow

function openSession(pid) {
  S.pending = "open";
  sock.send({ type: "study-open", pid, frontendVersion: RT.version, display: displayInfo() });
}

function displayInfo() {
  return { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, userAgent: navigator.userAgent.slice(0, 200) };
}

function setPhase(phase, screen, reset = false) {
  sock.send({ type: "study-phase", phase, screen, reset });
}

function enterStep() {
  const step = cur();
  clearTimeout(feedbackTimer);
  S.cursor = { x: 0, y: 0 };
  if (!step) return;
  if (step.kind === "block") {
    S.trialIdx = Math.max(0, step.phrases.findIndex((_, t) => !S.done.has(key(S.step, t))));
    S.screen = "ready";
    setPhase("pointer", "ready", true);
  } else if (step.kind === "rating") {
    S.screen = "rating";
    S.ratingIdx = 0;
    S.answers = {};
    S.ratingLog = [];
    setPhase("pointer", "rating", true);
  } else if (step.kind === "break") {
    S.screen = "break";
    S.breakUntil = Date.now() + (S.cfg.min_break_ms || 0);
    setPhase("pointer", "break", true);
  } else {
    S.screen = "end";
    setPhase("locked", "end");
  }
  render();
}

function advanceStep() {
  S.step++;
  enterStep();
}

function startTrial() {
  if (S.pending) return;
  if (!S.phone) {
    S.error = "The phone is not connected.";
    render();
    return;
  }
  S.pending = "start";
  sock.send({ type: "study-trial-start", step: S.step, trial: S.trialIdx, frontendVersion: RT.version, display: displayInfo() });
}

function finishTrial(status) {
  if (S.pending || !S.trial) return;
  const target = cur().phrases[S.trialIdx].text;
  const t = S.timing;
  const ms = t.tFirst != null && t.tLast != null ? t.tLast - t.tFirst : 0;
  S.pending = `finish:${status}`;
  S.lastResult = { wpm: window.Metrics.wpm(S.text, ms), cer: window.Metrics.cer(target, S.text) };
  sock.send({
    type: "study-trial-finish",
    trialId: S.trial.id,
    status,
    client: {
      typed: S.text,
      ms: Math.round(ms),
      msFromShown: t.tFirst != null ? Math.round(t.tFirst - t.tShown) : null,
      strokes: t.strokes,
      wpm: +S.lastResult.wpm.toFixed(3),
      cer: +S.lastResult.cer.toFixed(4)
    }
  });
}

function afterFinish(saved, status) {
  S.trial = null;
  S.stroke = null;
  drawTrace();
  if (status === "redo") {
    startTrial(); // same phrase, next attempt
    return;
  }
  S.done.add(key(saved.step, saved.trial));
  S.screen = "feedback";
  render();
  const showStats = S.cfg.show_trial_feedback && status === "completed";
  feedbackTimer = setTimeout(afterFeedback, showStats ? S.cfg.feedback_ms : 500);
}

function afterFeedback() {
  if (S.paused) {
    feedbackTimer = setTimeout(afterFeedback, 300);
    return;
  }
  const step = cur();
  const next = step.phrases.findIndex((_, t) => !S.done.has(key(S.step, t)));
  if (next >= 0) {
    S.trialIdx = next;
    startTrial();
  } else {
    advanceStep();
  }
}

// ---------------------------------------------------------------- pointer screens

function onPointer(m) {
  if (!["ready", "rating", "break"].includes(S.screen) || S.paused) return;
  S.cursor = { x: m.x, y: m.y };
  moveCursorEl();
  updateHover();
  if (m.phase === "up") {
    const t = hit();
    if (t && t.enabled) activate(t.id);
    else if (t) shake(t.id);
  }
}

function hit() {
  const { x, y } = S.cursor;
  return targets.find((t) => x >= t.r[0] && x <= t.r[2] && y >= t.r[1] && y <= t.r[3]);
}

function updateHover() {
  const t = hit();
  targets.forEach((x) => x.el.classList.toggle("is-hover", x === t && x.enabled));
  S.hoverId = t ? t.id : null;
}

function activate(id) {
  if (S.pending) return;
  if (id === "start") return startTrial();
  if (id === "bnext") return advanceStep();
  if (S.screen !== "rating") return;
  const items = S.cfg.rating_items;
  const it = items[S.ratingIdx];
  if (id.startsWith("opt:")) {
    const v = +id.slice(4);
    S.answers[it.id] = v;
    S.ratingLog.push({ t: Date.now(), item: it.id, v });
    render();
  } else if (id === "back" && S.ratingIdx > 0) {
    S.ratingLog.push({ t: Date.now(), item: it.id, back: true });
    S.ratingIdx--;
    render();
  } else if (id === "rnext" && S.answers[it.id]) {
    if (S.ratingIdx < items.length - 1) {
      S.ratingIdx++;
      render();
    } else {
      S.pending = "rating";
      sock.send({ type: "study-rating", cond: cur().cond, answers: S.answers, log: S.ratingLog });
    }
  }
}

// ---------------------------------------------------------------- experimenter

function command(cmd, arg) {
  switch (cmd) {
    case "setup":
      if (arg.pid && !S.trial) openSession(arg.pid);
      break;
    case "start": // waiting → first step; ready → start typing; break → next
      if (!S.session || S.paused) return;
      if (S.screen === "waiting") enterStep();
      else if (S.screen === "ready") startTrial();
      else if (S.screen === "break") advanceStep();
      break;
    case "pause":
      S.paused = !S.paused;
      $("pause").hidden = !S.paused;
      if (["ready", "rating", "break"].includes(S.screen)) {
        setPhase(S.paused ? "locked" : "pointer", S.paused ? "paused" : S.screen);
      }
      break;
    case "redo":
      if (S.screen === "trial") finishTrial("redo");
      break;
    case "next": // experimenter force-submits the phrase, even if empty
      if (S.screen === "trial") finishTrial("forced");
      else command("start");
      break;
  }
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const map = { s: "start", n: "next", r: "redo", p: "pause" };
  const c = map[e.key.toLowerCase()];
  if (c) command(c, {});
});

// ---------------------------------------------------------------- layout

let U = 40; // px per key unit
let O = { x: 0, y: 0 }; // px of G's center

function layout() {
  const w = innerWidth;
  const h = innerHeight;
  U = Math.min((w * 0.84) / 10, (h * 0.5) / 4.6);
  O = { x: w / 2, y: h - h * 0.05 - (Z.actionY + Z.band) * U };
  const top = h * 0.1;
  const bottom = O.y + (Z.candY - Z.band) * U - h * 0.03;
  upper.style.top = `${top}px`;
  upper.style.height = `${Math.max(80, bottom - top)}px`;
  const ratio = devicePixelRatio || 1;
  traceCanvas.width = w * ratio;
  traceCanvas.height = h * ratio;
  traceCanvas.style.width = `${w}px`;
  traceCanvas.style.height = `${h}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}

const px = (x, y) => ({ x: O.x + x * U, y: O.y + y * U });

function place(el, x0, y0, x1, y1, inset = 0) {
  const a = px(x0, y0);
  el.style.left = `${a.x + inset}px`;
  el.style.top = `${a.y + inset}px`;
  el.style.width = `${(x1 - x0) * U - 2 * inset}px`;
  el.style.height = `${(y1 - y0) * U - 2 * inset}px`;
  return el;
}

function add(cls, text, r, inset, id) {
  const el = document.createElement("div");
  el.className = cls;
  if (text != null) el.textContent = text;
  if (id) el.dataset.id = id;
  stage.appendChild(el);
  return place(el, ...r, inset);
}

// a pointer-screen target: drawn at `draw`, hit-tested over `r`
function target(id, cls, text, draw, r = draw, enabled = true, inset = 0.08 * U) {
  const el = add(cls + (enabled ? "" : " disabled"), text, draw, inset, id);
  targets.push({ id, r, el, enabled });
  return el;
}

// ---------------------------------------------------------------- render

function drawKeyboard(dim) {
  stage.classList.toggle("dim", !!dim);
  for (const [k, [x, y]] of Object.entries(window.KEY_XY)) {
    add("k" + (k === "g" ? " anchor" : ""), k.toUpperCase(), [x - 0.5, y - 0.5, x + 0.5, y + 0.5]);
  }
}

const BAR = [Z.actionY, Z.actionY + Z.band];
const LEFT_HIT = [Z.pointerX[0], Z.actionY, Z.clearX[1], Z.pointerY[1]];
const RIGHT_HIT = [Z.nextX[0], Z.actionY, Z.pointerX[1], Z.pointerY[1]];

// the bottom control bar: same place on every screen
function drawBar(left, mid, right, pointer) {
  if (left) {
    const draw = [Z.clearX[0], BAR[0], Z.clearX[1], BAR[1]];
    if (pointer) target(left.id, "slot ctrl", left.text, draw, LEFT_HIT, left.enabled !== false);
    else add("slot ctrl", left.text, draw, 0.08 * U, left.id);
  }
  add("bar-mid", mid || "", [Z.clearX[1] + 0.3, BAR[0], Z.nextX[0] - 0.3, BAR[1]]);
  if (right) {
    const draw = [Z.nextX[0], BAR[0], Z.nextX[1], BAR[1]];
    if (pointer) target(right.id, "slot ctrl next", right.text, draw, RIGHT_HIT, right.enabled !== false);
    else add("slot ctrl next", right.text, draw, 0.08 * U, right.id);
  }
}

function progressBar(n, done, curIdx) {
  const p = $("progress");
  p.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const el = document.createElement("i");
    if (i < done) el.className = "done";
    else if (i === curIdx) el.className = "cur";
    p.appendChild(el);
  }
}

function meta(left, right) {
  $("meta-left").textContent = left || "";
  $("meta-right").innerHTML = right || "";
}

const blockLabel = (s) => (s.practice ? "Practice" : `Block ${s.block} of ${S.cfg.blocks_per_condition}`);

function render() {
  stage.innerHTML = "";
  targets = [];
  upper.innerHTML = "";
  meta("", "");
  progressBar(0);
  $("status").textContent = S.error;
  $("corner").textContent = [S.code, S.session && S.session.pid, S.phone ? "phone ✓" : "phone –"].filter(Boolean).join(" · ");
  const step = cur();
  cursorEl.hidden = !["ready", "trial", "rating", "break"].includes(S.screen);

  if (S.screen === "waiting") {
    const msg = !S.session
      ? "The experimenter will set up the session."
      : !S.phone
      ? `Pair the phone with session <b style="font-family:var(--font-mono)">${S.code || "····"}</b>.`
      : "Thanks. The experimenter will start the session shortly.";
    upper.innerHTML = `
      <div class="msg-kicker">Gesture typing study</div>
      <div class="msg-title">Welcome</div>
      <div class="msg-sub">${msg}</div>
      <div class="big-code">${S.code || "····"}</div>`;
    drawKeyboard(true);
  } else if (S.screen === "ready") {
    meta(`Condition ${step.cond}`, "");
    upper.innerHTML = `
      <div class="msg-kicker">Condition ${step.cond} · ${blockLabel(step)}</div>
      <div class="msg-title">Ready?</div>
      <div class="msg-sub">${step.phrases.length - S.trialIdx} phrases${
      step.practice ? " · practice, to get used to the technique" : ""
    }<br>Type each phrase, then move down to <b style="color:var(--up)">Next</b> and lift.</div>`;
    drawKeyboard(true);
    drawBar(null, blockLabel(step), { id: "start", text: "Start ▶" }, true);
  } else if (S.screen === "trial") {
    const n = step.phrases.length;
    meta(`Condition ${step.cond} · ${blockLabel(step)}`, `Phrase ${S.trialIdx + 1} / ${n}`);
    progressBar(n, S.trialIdx, S.trialIdx);
    upper.innerHTML = `
      ${step.practice ? '<div class="practice-tag">PRACTICE</div>' : ""}
      <div class="phrase target">${step.phrases[S.trialIdx].text}</div>
      <div class="phrase typed" id="typed"></div>`;
    renderTyped();
    drawKeyboard(false);
    renderCandidates();
    drawBar({ id: "clear", text: "Clear" }, `${S.trialIdx + 1} / ${n}`, { id: "next", text: "Next ▶" }, false);
  } else if (S.screen === "feedback") {
    const r = S.lastResult;
    meta(`Condition ${step.cond}`, "");
    progressBar(step.phrases.length, S.trialIdx + 1, -1);
    upper.innerHTML = `<div class="msg-kicker">Phrase ${S.trialIdx + 1} done</div>${
      S.cfg.show_trial_feedback && r
        ? `<div class="stats"><div><b>${r.wpm.toFixed(1)}</b><span>WPM</span></div><div><b>${Math.round(r.cer * 100)}%</b><span>errors</span></div></div>`
        : ""
    }`;
    drawKeyboard(true);
  } else if (S.screen === "rating") {
    const items = S.cfg.rating_items;
    const it = items[S.ratingIdx];
    const chosen = S.answers[it.id];
    const last = S.ratingIdx === items.length - 1;
    meta(`Condition ${step.cond} · Rating`, `${S.ratingIdx + 1} / ${items.length}`);
    progressBar(items.length, S.ratingIdx, S.ratingIdx);
    upper.innerHTML = `<div class="msg-kicker">About condition ${step.cond}</div><div class="phrase" style="margin-top:.4em">${it.q}</div>`;
    const k = S.cfg.rating_scale;
    const gap = 0.18;
    const w = (10 - gap * (k - 1)) / k;
    add("opt-label", it.lo, [-5, -1.3, 0, -0.8]).style.textAlign = "left";
    add("opt-label", it.hi, [0, -1.3, 5, -0.8]).style.textAlign = "right";
    for (let v = 1; v <= k; v++) {
      const x0 = -5 + (v - 1) * (w + gap);
      target(`opt:${v}`, "opt" + (chosen === v ? " sel" : ""), String(v), [x0, -0.7, x0 + w, 0.7], undefined, true, 0);
    }
    drawBar(
      { id: "back", text: "← Back", enabled: S.ratingIdx > 0 },
      chosen ? `selected ${chosen}` : "move onto a number and lift",
      { id: "rnext", text: last ? "Done ✓" : "Next ▶", enabled: !!chosen },
      true
    );
  } else if (S.screen === "break") {
    const left = Math.max(0, S.breakUntil - Date.now());
    upper.innerHTML = `
      <div class="msg-title">Take a break</div>
      <div class="msg-sub">Rest as long as you like. When you are ready, move down to Next and lift.</div>
      <div class="msg-kicker" style="margin-top:1.5vh">Next: condition ${step.next}</div>`;
    drawKeyboard(true);
    drawBar(null, left > 0 ? `available in ${Math.ceil(left / 1000)} s` : "", { id: "bnext", text: "Next ▶", enabled: left === 0 }, true);
    if (left > 0) setTimeout(() => S.screen === "break" && render(), 500);
  } else if (S.screen === "end") {
    upper.innerHTML = `
      <div class="msg-title">All done — thank you!</div>
      <div class="msg-sub">You can now look at the phone and answer the final questions.</div>`;
    drawKeyboard(true);
  }
  updateHover();
  moveCursorEl();
}

function renderTyped() {
  const el = $("typed");
  if (el) el.innerHTML = `${escapeHtml(S.text)}<span class="caret"></span>`;
}

function renderCandidates() {
  stage.querySelectorAll(".cand").forEach((el) => el.remove());
  const y0 = Z.candY - Z.band;
  window.candidateSegments(S.cands).forEach((s, i) => {
    const empty = s.kind === "word" && !s.word;
    add(`slot cand${s.rank === 0 ? " top" : ""}${empty ? " empty" : ""}`, s.word, [s.x0, y0, s.x1, Z.candY], 0.06 * U, `seg:${i}`);
  });
  paintHover();
}

function paintHover() {
  if (S.screen !== "trial") return;
  stage.querySelectorAll(".cand").forEach((el) => el.classList.toggle("is-hover", el.dataset.id === `seg:${S.candHover}`));
  stage.querySelectorAll(".ctrl").forEach((el) => el.classList.toggle("is-hover", el.dataset.id === S.actionSlot));
}

function shake(id) {
  const el = stage.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function moveCursorEl() {
  const p = px(S.cursor.x, S.cursor.y);
  cursorEl.style.left = `${p.x}px`;
  cursorEl.style.top = `${p.y}px`;
}

function drawTrace() {
  ctx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
  if (!S.stroke || S.stroke.length < 2 || S.screen !== "trial") return;
  ctx.strokeStyle = "rgba(17,17,17,0.55)";
  ctx.lineWidth = 5;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  S.stroke.forEach(([x, y], i) => {
    const p = px(x, y);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

addEventListener("resize", layout);
layout();
