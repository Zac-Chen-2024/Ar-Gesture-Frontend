/* Study flow on top of the main display (display.js): same socket, keyboard,
   candidates and trace. The server owns the plan, the records and the phase;
   this page walks the plan and renders each screen.

   A phrase ends by itself the moment the text equals it (it turns green, then
   the next one comes). Next fills the bottom bar for when a phrase will not
   come out: with a different text it asks once more before submitting. There
   is no Clear. Each phrase, block and the whole study end on a short summary.

   Participant input works two ways everywhere: the phone (swipe down to Next
   and lift while typing; a persistent pointer on the other screens) or the
   mouse. Experimenter keys on this machine: N force-submit, R redo, P pause. */
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  // which independent collection this page feeds (the server's study_store.VARIANTS)
  const VARIANT = body.dataset.variant || "study";
  // Extensions (e.g. /study-funny) listen to "study:*" events on document and
  // may add to the saved client summary and the result lines through these.
  const hooks = () => window.STUDY_HOOKS || {};
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(`study:${name}`, { detail }));
  const kickerEl = $("study-kicker");
  const titleEl = $("study-title");
  const subEl = $("study-sub");
  const statusEl = $("study-status");
  const infoEl = $("study-info-detail");
  const setupForm = $("study-setup");
  const beginBtn = $("study-begin");
  const resumeBtn = $("study-resume");
  // the participant this browser has not finished yet, offered on the start screen
  const ACTIVE_KEY = VARIANT === "study" ? "studyActivePid" : `studyActivePid:${VARIANT}`;
  const activePid = () => { try { return localStorage.getItem(ACTIVE_KEY); } catch (_) { return null; } };
  const setActivePid = (pid) => { try { pid ? localStorage.setItem(ACTIVE_KEY, pid) : localStorage.removeItem(ACTIVE_KEY); } catch (_) { /* storage off */ } };
  const sheet = $("study-sheet");
  const flash = $("study-flash");
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
    results: [], // finished trials: { step, cond, practice, block, status, target, text, wpm, cer, strokes, words, perfect }
    confirmNext: false, // a mismatching Next was asked once
    mode: null, // collections with modes (funny): "blocks" | "endless"
    run: null, // the endless run number (server-assigned)
    lives: 0,
    confirmStop: false, // endless: a Stop was asked once
    endReason: "", // endless: lives | stopped | complete
    matchTimer: null,
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

  const hasModes = () => !!(S.cfg && S.cfg.endless && (S.cfg.modes || []).includes("endless"));
  const endless = () => S.mode === "endless";
  // an endless run looks like one open-ended block to the rest of the page
  const endlessStep = () => ({ kind: "block", cond: S.cfg.endless.id, practice: false, block: S.run, phrases: [] });
  const cur = () => (endless() ? endlessStep() : S.session && S.session.steps[S.step]);
  const key = (step, trial) => `${step}:${trial}`;
  const condOf = (id) => [...(S.cfg.conditions || []), ...(S.cfg.endless ? [S.cfg.endless] : [])].find((c) => c.id === id) || { id, label: id };

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

  // Next pill: the whole bottom bar (Q's left edge to P's right edge), or the
  // mirror of Back on the rating screens.
  const nextIsFull = () => S.screen !== "rating" && !halves();
  // an endless run while typing: Stop on the left half, Next on the right
  const halves = () => S.screen === "trial" && endless();

  function layoutNextPill() {
    if (!clearPill.style.left) return;
    const { keyWidth } = keyboardMetrics;
    const clearLeft = parseFloat(clearPill.style.left);
    const full = nextIsFull();
    const half = halves();
    clearPill.style.width = `${(half ? 5 : CLEAR_ZONE_X[1] - CLEAR_ZONE_X[0]) * keyWidth}px`;
    nextPill.style.left = `${full ? clearLeft : clearLeft + (half ? 5 : NEXT_ZONE_X_MIN - CLEAR_ZONE_X[0]) * keyWidth}px`;
    nextPill.style.width = full ? `${10 * keyWidth}px` : clearPill.style.width;
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
      if (t.el === nextPill) return p.y >= ACTION_ZONE_Y && (nextIsFull() || p.x >= NEXT_ZONE_X_MIN);
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
    if (halves() && event.target.closest("#action-clear")) return stopFromParticipant();
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
          onTextChange();
        }
        if (body.classList.contains("is-pointer")) placePointer(); // display.js snapped it to G
        // display.js relabels the left pill "Clear" with the candidates; endless keeps "Stop"
        if (halves()) clearPill.textContent = S.confirmStop ? "Swipe to Stop again to end the run" : "Stop";
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
        clearPill.classList.toggle("is-hover", halves() && m.slot === "stop");
        break;
      case "study-stop":
        stopFromParticipant();
        break;
      case "study-next":
        // a swipe down to Next is not a typing stroke
        if (S.screen === "trial" && S.timing && S.timing.strokes > 0) S.timing.strokes--;
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
      // the text moved on between the match and the save: keep typing
      if (S.pending === "finish:matched") S.error = "";
      else S.error = m.error;
      S.pending = null;
      body.classList.remove("is-matched");
      render();
      return;
    }
    S.error = "";
    if (m.account) emit("account", m.account);
    if (m.session) applySession(m.session);
    if (S.pending === "start" && m.trial) {
      S.pending = null;
      S.trial = m.trial;
      if (endless()) {
        S.run = m.trial.block;
        S.trialIdx = m.trial.trial;
      }
      S.timing = { shown: performance.now(), first: null, last: null, strokes: 0, text: "" };
      S.screen = "trial";
      render();
      emit("trial-start", { target: target(), practice: cur().practice, mode: S.mode, index: S.trialIdx });
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
    S.results = (session.results || []).map(fromServer);
    setActivePid(session.pid);
    emit("session", { session });
    if (S.pending === "open") S.pending = null;
    if (S.pending === "rating" && S.rated.has(cur().cond)) {
      S.pending = null;
      advanceStep();
      return;
    }
    if (first) {
      if (hasModes()) return chooseMode();
      S.step = resumeStep();
      enterStep();
    }
  }

  // ---------------------------------------------------------------- modes

  function chooseMode() {
    clearTimeout(feedbackTimer);
    S.mode = null;
    S.screen = "mode";
    S.pointer = { x: 0, y: 0 };
    setPhase("pointer", "mode", true);
    render();
  }

  function startMode(mode) {
    S.mode = mode;
    if (mode === "blocks") {
      S.step = resumeStep();
      enterStep();
      return;
    }
    S.run = null;
    S.lives = S.cfg.endless.lives || 3;
    S.trialIdx = 0;
    S.screen = "ready";
    S.pointer = { x: 0, y: 0 };
    setPhase("pointer", "ready", true);
    render();
  }

  const runLength = () => S.cfg.endless.length || 500;

  // an endless run ends: out of lives, stopped, or every phrase done
  function runOver(reason) {
    S.endReason = reason;
    emit("run-over", { reason });
    S.screen = "gameover";
    S.pointer = { x: 0, y: 0 };
    setPhase("pointer", "gameover", true);
    render();
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

  // no pid: the server assigns the next participant ID; `extra` carries what
  // a collection needs to open (funny: the player's account)
  function openSession(pid, extra = {}) {
    if (S.pending) return;
    request({ type: "study-open", variant: VARIANT, ...(pid ? { pid } : {}), ...extra, frontendVersion: window.GESTURE_CONFIG.version, display: displayInfo() }, "open");
    render();
  }

  // for extensions that bring their own start screen (funny's login)
  window.STUDY_API = {
    open: (extra) => openSession(null, extra),
    get ready() { return S.supported && !S.pending; },
    refresh: () => render()
  };

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
      setPhase(hasModes() ? "pointer" : "locked", "end", true); // with modes the end leads back to them
      setActivePid(null);
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
    const where = endless() ? { endless: true, run: S.run } : { step: S.step, trial: S.trialIdx };
    request({ type: "study-trial-start", ...where,
              frontendVersion: window.GESTURE_CONFIG.version, display: displayInfo() }, "start");
  }

  // the phrase being typed (an endless phrase is known once the server picks it)
  const phraseText = () => (endless() ? (S.trial ? S.trial.target : S.lastResult ? S.lastResult.target : "") : cur().phrases[S.trialIdx].text);
  const target = phraseText;
  const matches = () => plainText.trim() === target();

  // the text equals the phrase: green for a moment, then save as matched
  function onTextChange() {
    emit("text", { text: plainText.trim(), target: target() });
    clearTimeout(S.matchTimer);
    body.classList.remove("is-matched");
    if (S.confirmNext || S.confirmStop) {
      S.confirmNext = false;
      S.confirmStop = false;
      render();
    }
    if (!S.cfg.auto_advance || S.pending || S.paused || !matches()) return;
    body.classList.add("is-matched");
    S.matchTimer = setTimeout(() => {
      if (S.screen === "trial" && matches() && !S.pending) finishTrial("matched");
      else body.classList.remove("is-matched");
    }, 450);
  }

  // endless: Stop ends the run, asked once more like a mismatching Next
  function stopFromParticipant() {
    if (!halves() || S.paused || S.pending || !S.trial) return;
    if (!S.confirmStop) {
      S.confirmStop = true;
      S.confirmNext = false;
      render();
      shake(clearPill);
      return;
    }
    finishTrial("stopped");
  }

  function nextFromParticipant() {
    if (S.screen !== "trial" || S.paused || S.pending || !S.trial) return;
    if (S.confirmStop) {
      S.confirmStop = false;
      render();
    }
    if (matches()) return finishTrial("matched");
    if (!plainText.trim()) return shake(nextPill);
    if (!S.confirmNext) {
      S.confirmNext = true; // a different text: ask once more
      render();
      shake(nextPill);
      return;
    }
    finishTrial("completed");
  }

  function finishTrial(status) {
    if (S.pending || !S.trial) return;
    clearTimeout(S.matchTimer);
    const step = cur();
    const phrase = target();
    const typed = plainText.trim();
    const t = S.timing;
    const ms = t.first != null && t.last != null ? t.last - t.first : 0;
    const words = phrase.split(" ").length;
    S.lastResult = {
      step: endless() ? -1 : S.step, trial: S.trialIdx, cond: step.cond, practice: step.practice, block: step.block,
      status, target: phrase, text: typed, ms,
      wpm: wpm(typed, ms), cer: cer(phrase, typed), strokes: t.strokes, words,
      perfect: status === "matched" && t.strokes === words
    };
    request({
      type: "study-trial-finish", trialId: S.trial.id, status,
      client: {
        typed, ms: Math.round(ms),
        msFromShown: t.first != null ? Math.round(t.first - t.shown) : null,
        strokes: t.strokes, words,
        perfect: S.lastResult.perfect,
        wpm: +S.lastResult.wpm.toFixed(3),
        cer: +S.lastResult.cer.toFixed(4),
        ...(hooks().clientExtra ? hooks().clientExtra(S.lastResult) : {})
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
    if (status === "stopped") {
      S.confirmStop = false;
      return runOver("stopped");
    }
    S.done.add(key(saved.step, saved.trial));
    if (endless() && status !== "matched") {
      S.lives--; // a phrase not typed to the end costs a life
      emit("life-lost", { lives: S.lives });
    }
    S.feedback = status === "forced" ? null : phraseSummary(S.lastResult);
    emit("trial-end", { status, result: S.lastResult });
    S.results.push(S.lastResult);
    S.confirmNext = false;
    body.classList.remove("is-matched");
    S.screen = "feedback";
    render();
    const showStats = S.cfg.show_trial_feedback && S.feedback;
    feedbackTimer = setTimeout(afterFeedback, showStats ? S.cfg.feedback_ms : 500);
  }

  function afterFeedback() {
    if (S.paused) {
      feedbackTimer = setTimeout(afterFeedback, 300);
      return;
    }
    if (endless()) {
      if (S.lives <= 0) return runOver("lives");
      if (S.trialIdx + 1 >= runLength()) return runOver("complete");
      // every 50 phrases: a milestone and a life back (up to 2 over the start)
      if ((S.trialIdx + 1) % 50 === 0) {
        const max = (S.cfg.endless.lives || 3) + 2;
        S.lives = Math.min(max, S.lives + 1);
        emit("milestone", { phrases: S.trialIdx + 1, lives: S.lives });
      }
      S.trialIdx++;
      return startTrial();
    }
    const step = cur();
    const next = step.phrases.findIndex((_, t) => !S.done.has(key(S.step, t)));
    if (next >= 0) {
      S.trialIdx = next;
      startTrial();
    } else if (S.cfg.show_trial_feedback) {
      S.screen = "summary"; // the block's summary; the participant moves on
      setPhase("pointer", "summary", true);
      S.pointer = { x: 0, y: 0 };
      render();
    } else {
      advanceStep();
    }
  }

  // ---------------------------------------------------------------- pointer screens

  const POINTER_SCREENS = ["ready", "rating", "break", "summary", "mode", "gameover"];
  const isPointer = (screen) => POINTER_SCREENS.includes(screen) || (screen === "end" && hasModes());

  function onPointer(m) {
    if (!isPointer(S.screen) || S.paused) return;
    S.pointer = { x: m.x, y: m.y };
    placePointer();
    paintHover();
    if (m.phase === "up") pick(hitTarget(S.pointer));
  }

  function activate(id) {
    if (S.pending || S.paused) return;
    if (id === "start") return startTrial();
    if (id === "break-next" || id === "summary-next") return advanceStep();
    if (id.startsWith("mode:")) return startMode(id.slice(5));
    if (id === "back-to-modes") return chooseMode();
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
        if (isPointer(S.screen)) {
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
    if (event.repeat || event.target.tagName === "INPUT") return;
    const cmd = { n: "next", r: "redo", p: "pause" }[event.key.toLowerCase()];
    if (cmd && S.session) command(cmd);
  });

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    S.error = "";
    const firstMode = $("study-first-mode")?.value;
    if (VARIANT === "study" && !firstMode) return;
    openSession(null, VARIANT === "study" ? { firstMode } : {});
  });
  resumeBtn.addEventListener("click", () => {
    S.error = "";
    openSession(activePid());
  });

  addEventListener("beforeunload", (event) => {
    if (S.trial) { event.preventDefault(); event.returnValue = ""; }
  });

  // ---------------------------------------------------------------- render

  // who is playing: the player's name where there are accounts (funny), else the ID
  const who = () => (S.session ? S.session.username || S.session.pid : "");

  const blockLabel = (s) => (s.practice ? "Practice" : `Block ${s.block} of ${S.cfg.blocks_per_condition}`);

  function pill(el, text, { target = false, enabled = true, hidden = false } = {}) {
    el.textContent = text;
    el.hidden = hidden;
    el.classList.toggle("is-target", target && enabled);
    el.classList.toggle("is-disabled", !enabled);
    el.classList.remove("is-hover");
  }

  function show({ kicker = "", kickerHtml = "", title = "", titleHtml = "", sub = "" }) {
    if (kickerHtml) kickerEl.innerHTML = kickerHtml;
    else kickerEl.textContent = kicker;
    if (titleHtml) titleEl.innerHTML = titleHtml;
    else titleEl.textContent = title;
    subEl.innerHTML = sub;
  }

  function render() {
    const screen = S.screen;
    const step = cur();
    const pointer = isPointer(screen) && !S.paused;
    body.classList.toggle("is-trial", screen === "trial");
    body.classList.toggle("is-pointer", pointer);
    body.classList.toggle("is-dim", screen !== "trial" && screen !== "feedback");
    if (screen !== "feedback") flash.innerHTML = "";
    body.classList.toggle("is-paused", S.paused);
    body.dataset.screen = screen;
    emit("screen", { screen, step });
    setupForm.hidden = screen !== "setup";
    sheet.hidden = !["rating", "summary", "end", "mode", "gameover"].includes(screen);
    sheet.className = `study-sheet is-${screen}`;
    sheet.innerHTML = "";
    statusEl.textContent = S.error;
    infoEl.textContent = S.session
      ? [who(), screen === "mode" ? "" : endless() ? "Endless" : step && step.cond ? `Condition ${step.cond} · ${condOf(step.cond).label}` : ""].filter(Boolean).join(" · ")
      : "";
    pill(clearPill, "Clear");
    pill(nextPill, "Next");
    let list = [];

    if (screen === "setup" && hooks().setup) {
      // the extension draws its own start screen (funny: log in)
      setupForm.hidden = true;
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
      hooks().setup({ supported: S.supported, pending: S.pending, error: S.error, kicker: kickerEl, title: titleEl, sub: subEl });
    } else if (screen === "setup") {
      const resume = activePid();
      show({
        kicker: "User study",
        title: S.pending === "open" ? "Opening…" : "Participant",
        sub: !S.supported ? "Connecting to the server…"
          : resume ? `<strong>${resume}</strong> has not finished on this computer. Continue, or start the next participant.`
          : "The next participant number is assigned automatically."
      });
      beginBtn.disabled = resumeBtn.disabled = !S.supported || !!S.pending;
      if ($("study-first-mode")) $("study-first-mode").disabled = !S.supported || !!S.pending;
      resumeBtn.hidden = !resume;
      resumeBtn.textContent = resume ? `Continue ${resume}` : "";
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
    } else if (screen === "mode") {
      show({ kicker: who(), title: "Choose a mode" });
      sheet.innerHTML = modesHtml();
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
      list = [...sheet.querySelectorAll("[data-mode]")].map((el) => ({ id: `mode:${el.dataset.mode}`, el }));
    } else if (screen === "ready" && endless()) {
      show({
        kicker: `Endless · ${S.cfg.endless.input_mode === "center" ? "Center" : "Continuous"} word start`,
        title: "Ready?",
        sub: !S.phone
          ? `Open <strong>Mobile</strong> on the phone and choose session <strong>${currentRoomCode || "····"}</strong>.`
          : `Up to ${runLength()} phrases. Swipe down-right for <strong>Next</strong>, down-left to <strong>Stop</strong> the run. `
            + `A phrase you submit with errors costs a life; lose ${S.lives} and the run is over.`
      });
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "Start", { target: true, enabled: S.phone });
      list = [{ id: "start", el: nextPill, enabled: S.phone }];
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
      show({ kickerHtml: progressHtml(step), title: phraseText() });
      if (endless()) {
        pill(clearPill, S.confirmStop ? "Swipe to Stop again to end the run" : "Stop", { target: true });
        clearPill.classList.toggle("is-confirm", S.confirmStop);
      } else {
        pill(clearPill, "", { hidden: true });
      }
      pill(nextPill, S.confirmNext ? (endless() ? "Not matching · Next again to submit" : "Does not match yet · swipe down again to submit as it is") : "Next", { target: true });
      nextPill.classList.toggle("is-confirm", S.confirmNext);
    } else if (screen === "feedback") {
      // the phrase stays; the output line shows how it went
      const f = S.cfg.show_trial_feedback ? S.feedback : null;
      show({ kickerHtml: progressHtml(step), title: phraseText() });
      sheet.hidden = true;
      flash.innerHTML = f ? feedbackHtml(f) : "";
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "", { hidden: true });
    } else if (screen === "summary") {
      const b = blockSummary(S.step);
      show({ kicker: `Condition ${step.cond} · ${condOf(step.cond).label}`, title: `${step.practice ? "Practice" : `Block ${step.block}`} complete` });
      sheet.innerHTML = summaryHtml(b);
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "Continue", { target: true });
      list = [{ id: "summary-next", el: nextPill }];
    } else if (screen === "rating") {
      const items = S.cfg.rating_items;
      const item = items[S.ratingIdx];
      const chosen = S.answers[item.id];
      const last = S.ratingIdx === items.length - 1;
      show({
        kicker: `About condition ${step.cond} · ${condOf(step.cond).label} · ${S.ratingIdx + 1} of ${items.length}`,
        title: item.q
      });
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
      show({ kicker: who(), title: "All done — thank you!", sub: hasModes() ? "" : "You can put the phone down." });
      sheet.innerHTML = endHtml();
      pill(clearPill, "", { hidden: true });
      if (hasModes()) {
        pill(nextPill, "Back to modes", { target: true });
        list = [{ id: "back-to-modes", el: nextPill }];
      } else {
        pill(nextPill, "", { hidden: true });
      }
    } else if (screen === "gameover") {
      const b = runSummary();
      const title = { lives: "Game over", stopped: "Run ended", complete: `All ${runLength()} done!` }[S.endReason] || "Run over";
      show({ kicker: `Endless · run ${S.run}`, title, sub: `${b.n} phrase${b.n === 1 ? "" : "s"}` });
      sheet.innerHTML = summaryHtml(b);
      pill(clearPill, "", { hidden: true });
      pill(nextPill, "Continue", { target: true });
      list = [{ id: "back-to-modes", el: nextPill }];
    }
    flash.hidden = !flash.innerHTML;
    if (screen !== "trial") {
      nextPill.classList.remove("is-confirm");
      clearPill.classList.remove("is-confirm");
    }
    layoutNextPill();
    setTargets(list);
    if (pointer) placePointer();
  }

  // ---------------------------------------------------------------- metrics

  // MacKenzie's text-entry WPM: (|T| - 1) / seconds * 60 / 5, timed from the
  // first stroke to the last change of the text.
  function wpm(text, ms) {
    return ms > 0 && text.length > 1 ? ((text.length - 1) / (ms / 1000)) * 12 : 0;
  }

  // character error rate: edit distance / max(|target|, |typed|), the same as
  // the server's export_study.py
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
    const len = Math.max(a.length, b.length);
    return len ? prev[b.length] / len : 0;
  }

  // ---------------------------------------------------------------- statistics

  // Phrases the experimenter forced through count as phrases but never in the
  // speed or accuracy figures; submitted-with-errors phrases count for accuracy.
  // Participants only ever compare with themselves in the same condition, so
  // the feedback cannot tilt the ratings of another condition; the end screen
  // (after every rating) is the one place conditions sit side by side.

  function fromServer(r) {
    const c = r.client || {};
    const words = r.target.split(" ").length;
    const text = c.typed ?? r.text ?? "";
    return { step: r.step, trial: r.trial, cond: r.cond, practice: r.practice, block: r.block,
             status: r.status, target: r.target, text, ms: c.ms || 0,
             wpm: c.wpm || 0, cer: c.cer ?? cer(r.target, text), strokes: c.strokes ?? 0, words,
             perfect: c.perfect ?? (r.status === "matched" && c.strokes === words) };
  }

  // speed (averages, trends, bests) counts only phrases typed to the end: a
  // short, mismatching submission would otherwise read as a record
  const scored = (r) => r.status === "matched" && r.wpm > 0;
  const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);

  function phraseSummary(r) {
    const before = S.results.filter((x) => x.cond === r.cond && scored(x));
    const avg = mean(before.map((x) => x.wpm));
    const best = Math.max(0, ...before.map((x) => x.wpm));
    let streak = r.perfect ? 1 : 0;
    if (r.perfect) {
      for (let i = S.results.length - 1; i >= 0 && S.results[i].cond === r.cond && S.results[i].perfect; i--) streak++;
    }
    return {
      ...r,
      headline: r.perfect ? "Perfect" : r.status === "matched" ? "Matched" : "Submitted",
      delta: before.length && scored(r) ? r.wpm - avg : null,
      newBest: before.length >= 2 && scored(r) && r.wpm > best,
      streak
    };
  }

  // an endless run summarized like a block
  function runSummary() {
    return summarize(S.results.filter((x) => x.step === -1 && x.block === S.run), [], "");
  }

  function blockSummary(step) {
    const rows = S.results.filter((x) => x.step === step);
    const prevStep = S.session.steps.slice(0, step).map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === "block" && s.cond === S.session.steps[step].cond).pop();
    const prev = prevStep ? S.results.filter((x) => x.step === prevStep.i && scored(x)) : [];
    return summarize(rows, prev, prevStep ? (prevStep.s.practice ? "practice" : `block ${prevStep.s.block}`) : "");
  }

  function summarize(rows, prev, prevLabel) {
    const ok = rows.filter(scored);
    const bestRow = ok.reduce((a, x) => (!a || x.wpm > a.wpm ? x : a), null);
    const avg = mean(ok.map((x) => x.wpm));
    const prevAvg = mean(prev.map((x) => x.wpm));
    return {
      avg, accuracy: 1 - mean(rows.filter((x) => x.status !== "forced").map((x) => x.cer)),
      perfect: rows.filter((x) => x.perfect).length, n: rows.length,
      series: rows.map((x) => (scored(x) ? x.wpm : 0)),
      best: bestRow,
      change: prev.length && ok.length ? avg / prevAvg - 1 : null,
      prevLabel
    };
  }

  // ---- icons (inline SVG, stroke = currentColor)
  const svg = (cls, body) => `<svg class="study-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    check: svg("is-check", '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>'),
    up: svg("is-up", '<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg("is-down", '<path d="M12 5v14M6 13l6 6 6-6"/>'),
    star: svg("is-star", '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    heart: svg("is-heart", '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    heartFull: svg("is-heart is-full", '<path fill="currentColor" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    flame: svg("is-flame", '<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.3 2.4-5 3.4-7.9.5 1.6 1.4 2.6 2.4 3 .1-3.2 1.7-5.8 4-7.5-.6 2.7.3 4.4 1.5 6.2 1 1.4 1.7 2.9 1.7 4.6C19 18.6 16 21 12 21z"/>')
  };

  function sparkline(values) {
    const w = 240;
    const h = 44;
    const top = Math.max(...values, 1);
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => [values.length > 1 ? i * step : w / 2, h - 4 - (v / top) * (h - 10)]);
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`).join("");
    return `<svg class="study-spark" viewBox="-6 0 ${w + 12} ${h}" aria-hidden="true"><polyline points="${line}"/>${dots}</svg>`;
  }

  const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function stat(value, label, extra = "") {
    return `<div class="study-stat"><b>${value}</b><span>${label}</span>${extra}</div>`;
  }

  // one line in place of the typed text: verdict, speed, errors, trend
  function feedbackHtml(f) {
    const part = (cls, html) => `<span class="study-flash-part ${cls}">${html}</span>`;
    const parts = [
      part(f.status === "completed" ? "is-plain" : "is-good", `${f.status === "completed" ? "" : ICON.check}${f.headline}`),
      part("", `<b>${num(f.wpm)}</b><small>WPM</small>`),
      part("", `<b>${pct(f.cer)}</b><small>errors</small>`)
    ];
    if (f.newBest) parts.push(part("is-good", `${ICON.star}New best`));
    else if (f.delta != null) {
      const up = f.delta >= 0;
      parts.push(part(up ? "is-good" : "is-muted", `${up ? ICON.up : ICON.down}${Math.abs(f.delta).toFixed(1)}<small>vs avg</small>`));
    }
    if (hooks().flashExtra) parts.push(...hooks().flashExtra(f).map((html) => part("", html)));
    return parts.join('<span class="study-flash-sep" aria-hidden="true"></span>');
  }

  function summaryHtml(b) {
    const change = b.change == null ? "" : `<em class="${b.change >= 0 ? "is-up" : "is-down"}">${b.change >= 0 ? ICON.up : ICON.down}${Math.abs(Math.round(b.change * 100))}% ${b.change >= 0 ? "faster" : "slower"} than ${b.prevLabel}</em>`;
    const extra = hooks().summaryExtra ? hooks().summaryExtra(b).map(([v, label]) => stat(v, label)).join("") : "";
    return `<div class="study-stats-row">${stat(num(b.avg), "avg WPM", change)}${stat(pct(b.accuracy), "accuracy")}${stat(`${b.perfect}/${b.n}`, "perfect")}${extra}</div>
      ${b.series.length > 1 ? sparkline(b.series) : ""}
      ${b.best ? `<p class="study-best">${ICON.star}<span>Fastest · “${esc(b.best.target)}” · ${num(b.best.wpm)} WPM</span></p>` : ""}`;
  }

  // the kicker while typing: where we are, and in endless the lives left
  function progressHtml(step) {
    if (!endless()) return esc(`${blockLabel(step)} · Phrase ${S.trialIdx + 1} of ${step.phrases.length}`);
    const total = Math.max(S.cfg.endless.lives || 3, S.lives);
    const hearts = Array.from({ length: total }, (_, i) => (i < S.lives ? ICON.heartFull : ICON.heart)).join("");
    return `Endless · Phrase ${S.trialIdx + 1} of ${runLength()} <span class="study-lives" aria-label="${S.lives} lives">${hearts}</span>`;
  }

  // the two modes, side by side over the keyboard
  function modesHtml() {
    const planned = S.session.steps.filter((x) => x.kind === "block").reduce((a, x) => a + x.phrases.length, 0);
    const done = S.session.steps.reduce((a, x, i) => a + (x.kind === "block" ? x.phrases.filter((_, t) => S.done.has(key(i, t))).length : 0), 0);
    const runs = new Set(S.results.filter((x) => x.step === -1).map((x) => x.block)).size;
    const best = Math.max(0, ...S.results.filter((x) => x.step === -1 && scored(x)).map((x) => x.wpm));
    return `<div class="study-modes">
      <div class="study-mode" data-mode="blocks"><b>Blocks</b><span>Practice, then ${S.cfg.blocks_per_condition} blocks for each word start</span>
        <em>${done >= planned ? "Completed" : done ? `${done} of ${planned} phrases done` : `${planned} phrases`}</em></div>
      <div class="study-mode" data-mode="endless"><b>Endless</b><span>Up to ${runLength()} phrases, ${S.cfg.endless.lives || 3} lives, stop any time</span>
        <em>${runs ? `${runs} run${runs === 1 ? "" : "s"} · best ${num(best)} WPM` : "New"}</em></div>
    </div>`;
  }

  function endHtml() {
    const real = S.results.filter((x) => !x.practice && x.step >= 0);
    const rows = S.session.order.map((id) => {
      const rs = real.filter((x) => x.cond === id);
      return `<tr><td>${esc(`Condition ${id} · ${condOf(id).label}`)}</td><td>${num(mean(rs.filter(scored).map((x) => x.wpm)))}</td><td>${pct(1 - mean(rs.filter((x) => x.status !== "forced").map((x) => x.cer)))}</td><td>${rs.filter((x) => x.perfect).length}/${rs.length}</td></tr>`;
    }).join("");
    const best = real.filter(scored).reduce((a, x) => (!a || x.wpm > a.wpm ? x : a), null);
    return `<table class="study-table"><thead><tr><th></th><th>WPM</th><th>accuracy</th><th>perfect</th></tr></thead><tbody>${rows}</tbody></table>
      ${best ? `<p class="study-best">${ICON.star}<span>Fastest phrase · “${esc(best.target)}” · ${num(best.wpm)} WPM</span></p>` : ""}`;
  }

  layoutNextPill();
  render();
})();
