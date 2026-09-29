/* Study flow on top of the main display (display.js): same socket, keyboard,
   candidates and trace. The server owns the plan, the records and the phase;
   this page walks the plan and renders each screen.

   Participant input works two ways everywhere: the phone (swipe down-right to
   Next and lift while typing; a persistent pointer on the other screens) or
   the mouse. Experimenter keys on this machine: N force-submit, R redo, P pause. */
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const kickerEl = $("study-kicker");
  const titleEl = $("study-title");
  const subEl = $("study-sub");
  const statusEl = $("study-status");
  const infoEl = $("study-info-detail");
  const setupForm = $("study-setup");
  const pidInput = $("study-pid");
  const sheet = $("study-sheet");
  const clearPill = $("action-clear");
  const nextPill = $("action-next");
  const params = new URLSearchParams(location.search);

  // Server zones in key units from G's center (mirrors server.py).
  const NEXT_ZONE_X_MIN = 4;
  const CLEAR_ZONE_X = [-5, -4];
  const ACTION_ZONE_Y = 1.8;

  const S = {
    supported: false,
    phone: false,
    session: null,
    cfg: null,
    done: new Set(), // "step:trial"
    rated: new Set(),
    step: 0,
    trialIdx: 0,
    screen: "setup", // setup | ready | trial | feedback | rating | break | end
    paused: false,
    pending: null, // "open" | "start" | "finish:<status>" | "rating"
    trial: null,
    timing: null, // { shown, first, last, strokes }
    lastResult: null,
    ratingIdx: 0,
    answers: {},
    ratingLog: [],
    breakUntil: 0,
    pointer: { x: 0, y: 0 },
    error: ""
  };
  let feedbackTimer = null;
  let breakTimer = null;
  let pendingTimer = null;

  const cur = () => S.session && S.session.steps[S.step];
  const key = (step, trial) => `${step}:${trial}`;
  const condOf = (id) => (S.cfg.conditions || []).find((c) => c.id === id) || { id, label: id };

  // ---------------------------------------------------------------- fixed settings

  // Editorial look and the Remote link for the whole study; neither choice is
  // written back to the main display's saved preferences.
  applyTheme("editorial");
  if (lanModeSelect && lanModeSelect.value !== "server") {
    let saved = null;
    try { saved = localStorage.getItem("linkMode"); } catch (_) { /* storage off */ }
    lanModeSelect.value = "server";
    lanModeSelect.dispatchEvent(new Event("change"));
    try { if (saved) localStorage.setItem("linkMode", saved); } catch (_) { /* storage off */ }
  }

  // ---------------------------------------------------------------- layout

  // Next pill: the mirror of Clear, from x = 4 key units to P's right edge.
  function layoutNextPill() {
    if (!clearPill.style.left) return;
    const { keyWidth } = keyboardMetrics;
    const left = parseFloat(clearPill.style.left) + (NEXT_ZONE_X_MIN - CLEAR_ZONE_X[0]) * keyWidth;
    nextPill.style.left = `${left}px`;
    nextPill.style.width = clearPill.style.width;
    nextPill.style.top = clearPill.style.top;
    nextPill.style.height = clearPill.style.height;
    sheet.style.bottom = `${sheet.parentElement.getBoundingClientRect().height - parseFloat(clearPill.style.top) + 8}px`;
  }

  addEventListener("resize", () => { layoutNextPill(); placePointer(); });

  // element box -> key units from G's center (the server's pointer space)
  function unitRect(el) {
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const { keyWidth, keyHeight } = keyboardMetrics;
    return {
      x0: (r.left - f.left - keyboardAnchorPoint.x) / keyWidth,
      x1: (r.right - f.left - keyboardAnchorPoint.x) / keyWidth,
      y0: (r.top - f.top - keyboardAnchorPoint.y) / keyHeight,
      y1: (r.bottom - f.top - keyboardAnchorPoint.y) / keyHeight
    };
  }

  // ---------------------------------------------------------------- targets

  // A target is anything the participant can pick on a pointer screen. The
  // bottom pills take the whole corner below the action line, like the
  // server's Clear / Next zones, so a fast swipe cannot overshoot them.
  let targets = [];

  function setTargets(list) {
    targets = list;
    paintHover();
  }

  function hitTarget(p) {
    return targets.find((t) => {
      if (t.el === nextPill) return p.x >= NEXT_ZONE_X_MIN && p.y >= ACTION_ZONE_Y;
      if (t.el === clearPill) return p.x < CLEAR_ZONE_X[1] && p.y >= ACTION_ZONE_Y;
      const r = unitRect(t.el);
      return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
    });
  }

  function paintHover() {
    if (S.screen === "trial") return; // server hovers drive the bars while typing
    const hit = body.classList.contains("is-pointer") ? hitTarget(S.pointer) : null;
    for (const t of targets) t.el.classList.toggle("is-hover", t === hit && t.enabled !== false);
  }

  function shake(el) {
    el.classList.remove("is-shake");
    void el.offsetWidth;
    el.classList.add("is-shake");
  }

  function pick(t) {
    if (!t) return;
    if (t.enabled === false) return shake(t.el);
    activate(t.id);
  }

  // mouse: the same targets respond to clicks
  document.addEventListener("click", (event) => {
    if (S.paused) return;
    if (S.screen === "trial" && event.target.closest("#action-next")) return nextFromParticipant();
    const t = targets.find((x) => x.el.contains(event.target));
    if (t) pick(t);
  });

  function placePointer() {
    if (!body.classList.contains("is-pointer")) return;
    moveCursor(toDisplayPoint(S.pointer));
  }

  // ---------------------------------------------------------------- server messages

  socket.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    switch (m.type) {
      case "state-update":
      case "text-update":
        if (m.type === "state-update" && m.study) {
          const first = !S.supported;
          S.supported = true;
          S.phone = !!m.study.phonePaired;
          if (first) {
            layoutNextPill();
            if (params.get("pid") && !S.session) openSession(params.get("pid"));
          }
        }
        if (S.screen === "trial" && S.timing && (m.text || "") !== S.timing.text) {
          S.timing.text = m.text || "";
          S.timing.last = performance.now();
        }
        if (body.classList.contains("is-pointer")) placePointer(); // display.js snapped it to G
        if (S.screen === "setup" || S.screen === "ready") render();
        break;
      case "mobile-joined":
      case "mobile-left":
        S.phone = m.type === "mobile-joined";
        if (S.screen === "setup" || S.screen === "ready") render();
        break;
      case "gesture-start":
        if (S.screen === "trial" && S.timing) {
          if (S.timing.first == null) S.timing.first = performance.now();
          S.timing.strokes++;
        }
        break;
      case "action-hover":
        nextPill.classList.toggle("is-hover", m.active !== true && m.slot === "next");
        break;
      case "study-next":
        nextFromParticipant();
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
  });

  socket.addEventListener("close", () => {
    S.error = "Connection to the server lost. Reload this page and enter the same participant ID to continue.";
    render();
  });

  function onStudyUpdate(m) {
    clearTimeout(pendingTimer);
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
      S.timing = { shown: performance.now(), first: null, last: null, strokes: 0, text: "" };
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
      enterStep();
    }
  }

  // first step with work left; the break before it is shown again if that
  // step has not started yet
  function resumeStep() {
    const steps = S.session.steps;
    const doneTrials = (i) => steps[i].phrases.filter((_, t) => S.done.has(key(i, t))).length;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const complete = s.kind === "block" ? doneTrials(i) === s.phrases.length
        : s.kind === "rating" ? S.rated.has(s.cond) : s.kind === "break";
      if (complete) continue;
      const started = s.kind === "block" && doneTrials(i) > 0;
      return i > 0 && steps[i - 1].kind === "break" && !started ? i - 1 : i;
    }
    return steps.length - 1;
  }

  // ---------------------------------------------------------------- flow

  function request(payload, pending) {
    S.pending = pending;
    sendMessage(payload);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (S.pending !== pending) return;
      S.pending = null;
      S.error = "No answer from the server. Try again; nothing is lost.";
      render();
    }, 12000);
  }

  function displayInfo() {
    return { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio,
             userAgent: navigator.userAgent.slice(0, 200) };
  }

  function openSession(pid) {
    if (S.pending) return;
    request({ type: "study-open", pid, frontendVersion: window.GESTURE_CONFIG.version, display: displayInfo() }, "open");
    render();
  }

  function setPhase(phase, screen, reset = false) {
    sendMessage({ type: "study-phase", phase, screen, reset });
  }

  function enterStep() {
    const step = cur();
    clearTimeout(feedbackTimer);
    clearTimeout(breakTimer);
    S.pointer = { x: 0, y: 0 };
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
      S.error = "Connect the phone first: open Mobile and choose this session.";
      render();
      return;
    }
    request({ type: "study-trial-start", step: S.step, trial: S.trialIdx,
              frontendVersion: window.GESTURE_CONFIG.version, display: displayInfo() }, "start");
  }

  function nextFromParticipant() {
    if (S.screen !== "trial" || S.paused || S.pending || !S.trial) return;
    if (!plainText.trim()) return shake(nextPill);
    finishTrial("completed");
  }

  function finishTrial(status) {
    if (S.pending || !S.trial) return;
    const target = cur().phrases[S.trialIdx].text;
    const typed = plainText.trim();
    const t = S.timing;
    const ms = t.first != null && t.last != null ? t.last - t.first : 0;
    S.lastResult = { wpm: wpm(typed, ms), cer: cer(target, typed) };
    request({
      type: "study-trial-finish", trialId: S.trial.id, status,
      client: {
        typed, ms: Math.round(ms),
        msFromShown: t.first != null ? Math.round(t.first - t.shown) : null,
        strokes: t.strokes,
        wpm: +S.lastResult.wpm.toFixed(3),
        cer: +S.lastResult.cer.toFixed(4)
      }
    }, `finish:${status}`);
  }

  function afterFinish(saved, status) {
    S.trial = null;
    clearCanvas();
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
    S.pointer = { x: m.x, y: m.y };
    placePointer();
    paintHover();
    if (m.phase === "up") pick(hitTarget(S.pointer));
  }

  function activate(id) {
    if (S.pending || S.paused) return;
    if (id === "start") return startTrial();
    if (id === "break-next") return advanceStep();
    if (S.screen !== "rating") return;
    const items = S.cfg.rating_items;
    const item = items[S.ratingIdx];
    if (id.startsWith("opt:")) {
      const v = +id.slice(4);
      S.answers[item.id] = v;
      S.ratingLog.push({ t: Date.now(), item: item.id, v });
      render();
    } else if (id === "back" && S.ratingIdx > 0) {
      S.ratingLog.push({ t: Date.now(), item: item.id, back: true });
      S.ratingIdx--;
      render();
    } else if (id === "rating-next" && S.answers[item.id]) {
      if (S.ratingIdx < items.length - 1) {
        S.ratingIdx++;
        render();
      } else {
        request({ type: "study-rating", cond: cur().cond, answers: S.answers, log: S.ratingLog }, "rating");
      }
    }
  }

  // ---------------------------------------------------------------- experimenter

  function command(cmd) {
    switch (cmd) {
      case "pause":
        S.paused = !S.paused;
        if (["ready", "rating", "break"].includes(S.screen)) {
          setPhase(S.paused ? "locked" : "pointer", S.paused ? "paused" : S.screen);
        }
        render();
        break;
      case "redo":
        if (S.screen === "trial") finishTrial("redo");
        break;
      case "next": // force-submit the phrase, even if empty
        if (S.screen === "trial") finishTrial("forced");
        break;
    }
  }

  addEventListener("keydown", (event) => {
    if (event.repeat || event.target === pidInput) return;
    const cmd = { n: "next", r: "redo", p: "pause" }[event.key.toLowerCase()];
    if (cmd && S.session) command(cmd);
  });

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const pid = pidInput.value.trim().toUpperCase();
    if (!/^P\d{1,4}$/.test(pid)) {
      S.error = "Participant IDs look like P01.";
      render();
      return;
    }
    S.error = "";
    openSession(pid);
  });

  addEventListener("beforeunload", (event) => {
    if (S.trial) { event.preventDefault(); event.returnValue = ""; }
  });

  // ---------------------------------------------------------------- render

  const blockLabel = (s) => (s.practice ? "Practice" : `Block ${s.block} of ${S.cfg.blocks_per_condition}`);

  function pill(el, text, { target = false, enabled = true, hidden = false } = {}) {
    el.textContent = text;
    el.hidden = hidden;
    el.classList.toggle("is-target", target && enabled);
    el.classList.toggle("is-disabled", !enabled);
    el.classList.remove("is-hover");
  }

  function show({ kicker = "", title = "", titleHtml = "", sub = "" }) {
    kickerEl.textContent = kicker;
    if (titleHtml) titleEl.innerHTML = titleHtml;
    else titleEl.textContent = title;
    subEl.innerHTML = sub;
  }

  function render() {
    const screen = S.screen;
    const step = cur();
    const pointer = ["ready", "rating", "break"].includes(screen) && !S.paused;
    body.classList.toggle("is-trial", screen === "trial");
    body.classList.toggle("is-pointer", pointer);
    body.classList.toggle("is-dim", screen !== "trial");
    body.classList.toggle("is-paused", S.paused);
    setupForm.hidden = screen !== "setup";
    sheet.hidden = screen !== "rating";
    statusEl.textContent = S.error;
    infoEl.textContent = S.session
      ? [S.session.pid, step && step.cond ? `Condition ${step.cond} · ${condOf(step.cond).label}` : ""].filter(Boolean).join(" · ")
      : "";
    pill(clearPill, "Clear");
    pill(nextPill, "Next");
    let list = [];

    if (screen === "setup") {
      show({
        kicker: "User study",
        title: S.pending === "open" ? "Opening…" : "Participant",
        sub: S.supported ? "Enter the participant ID to begin, or to resume an earlier session."
          : "Connecting to the server…"
      });
      pidInput.disabled = setupForm.querySelector("button").disabled = !S.supported || !!S.pending;
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
      if (!pidInput.value && !pidInput.disabled) pidInput.focus();
    } else if (screen === "ready") {
      const left = step.phrases.length - S.trialIdx;
      show({
        kicker: `Condition ${step.cond} · ${condOf(step.cond).label} · ${blockLabel(step)}`,
        title: "Ready?",
        sub: !S.phone
          ? `Open <strong>Mobile</strong> on the phone and choose session <strong>${currentRoomCode || "····"}</strong>.`
          : `${left} phrase${left === 1 ? "" : "s"}${step.practice ? ", to get used to the technique" : ""}. `
            + "Type each phrase, then swipe down to <strong>Next</strong> and lift."
      });
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "Start", { target: true, enabled: S.phone });
      list = [{ id: "start", el: nextPill, enabled: S.phone }];
    } else if (screen === "trial") {
      const n = step.phrases.length;
      show({
        kicker: `${blockLabel(step)} · Phrase ${S.trialIdx + 1} of ${n}`,
        title: step.phrases[S.trialIdx].text
      });
      pill(nextPill, "Next", { target: true });
    } else if (screen === "feedback") {
      const r = S.lastResult;
      show({
        kicker: `Phrase ${S.trialIdx + 1} saved`,
        title: "Saved",
        titleHtml: S.cfg.show_trial_feedback && r
          ? `<span class="study-stats"><b>${r.wpm.toFixed(1)}<span>WPM</span></b><b>${Math.round(r.cer * 100)}%<span>errors</span></b></span>`
          : ""
      });
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
    } else if (screen === "rating") {
      const items = S.cfg.rating_items;
      const item = items[S.ratingIdx];
      const chosen = S.answers[item.id];
      const last = S.ratingIdx === items.length - 1;
      show({
        kicker: `About condition ${step.cond} · ${condOf(step.cond).label} · ${S.ratingIdx + 1} of ${items.length}`,
        title: item.q
      });
      sheet.innerHTML = "";
      const labels = document.createElement("div");
      labels.className = "study-scale-labels";
      labels.innerHTML = `<span></span><span></span>`;
      labels.children[0].textContent = item.lo;
      labels.children[1].textContent = item.hi;
      const scale = document.createElement("div");
      scale.className = "study-scale";
      for (let v = 1; v <= S.cfg.rating_scale; v++) {
        const cell = document.createElement("div");
        cell.className = `study-cell${chosen === v ? " is-selected" : ""}`;
        cell.textContent = v;
        scale.appendChild(cell);
        list.push({ id: `opt:${v}`, el: cell });
      }
      sheet.append(labels, scale);
      pill(clearPill, "Back", { target: true, enabled: S.ratingIdx > 0, hidden: S.ratingIdx === 0 });
      pill(nextPill, last ? "Done" : "Next", { target: true, enabled: !!chosen });
      list.push({ id: "back", el: clearPill, enabled: S.ratingIdx > 0 },
                { id: "rating-next", el: nextPill, enabled: !!chosen });
    } else if (screen === "break") {
      const left = Math.max(0, S.breakUntil - Date.now());
      const next = condOf(step.next);
      show({
        kicker: `Next · Condition ${next.id} · ${next.label}`,
        title: "Take a break",
        sub: left > 0 ? `Rest for a moment. Next opens in ${Math.ceil(left / 1000)} s.`
          : "When you are ready, swipe down to <strong>Next</strong> and lift."
      });
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "Next", { target: true, enabled: left === 0 });
      list = [{ id: "break-next", el: nextPill, enabled: left === 0 }];
      clearTimeout(breakTimer);
      if (left > 0) breakTimer = setTimeout(() => S.screen === "break" && render(), Math.min(left, 1000));
    } else if (screen === "end") {
      show({ kicker: S.session.pid, title: "All done — thank you!", sub: "You can put the phone down." });
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
    }
    setTargets(list);
    if (pointer) placePointer();
  }

  // ---------------------------------------------------------------- metrics

  // MacKenzie's text-entry WPM: (|T| - 1) / seconds * 60 / 5, timed from the
  // first stroke to the last change of the text.
  function wpm(text, ms) {
    return ms > 0 && text.length > 1 ? ((text.length - 1) / (ms / 1000)) * 12 : 0;
  }

  // character error rate: edit distance / target length
  function cer(target, typed) {
    const a = target;
    const b = typed;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return a.length ? prev[b.length] / a.length : 0;
  }

  layoutNextPill();
  render();
})();
