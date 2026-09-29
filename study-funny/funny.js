/* Funny layer over the study display (/study-funny). Every word typed right
   lands like a stamp: the word presses into the output line, ink flies from
   the end of the stroke, the keyboard takes the hit, and a rising note plays.
   Words in a row build a combo; at 5 / 10 / 20 / 40 the ink turns red, the
   hits get heavier and a word is stamped across the prompt.

   Combo rule (per word, since a stroke enters a word): a right word adds one;
   a wrong word freezes the combo until it is fixed from the candidate bar
   (no point, no loss); deleting a word or typing on past a wrong one breaks
   it. The combo carries across phrases within a block.

   Points: 100 x the combo multiplier (1-5 by tier) per word, plus up to 100
   for speed, and 500 for a phrase typed right in one stroke per word. The
   points go into each trial's saved client summary, which the server ranks
   for the leaderboard on the end screen. Each block ends on an S / A / B / C
   grade stamp.

   Sound is a small synth: each hit is a pluck on the current chord of an
   Am-F-C-G loop (so a run plays a melody) over a sub kick, panned by where
   the stroke ended, into a short reverb. A beat builds under the combo (kick
   from 5, hats and bass from 10, claps from 20, an arpeggio from 40) and
   tape-stops when it breaks. The picture adds a burst along the whole
   stroke, a shockwave, a small punch of the frame, a red heat at the edges
   that grows with the combo, and at milestones an ink flash with speed
   lines. The phone vibrates with every hit (Android; iOS where allowed).

   Fever: at 20 in a row the page turns to ink (white on black) and points
   double, with an extra layer on the beat; it ends when the combo breaks or
   decays below 20. Decay: a bar under the combo empties in 5 s (4.5 s from
   10, 4 s in fever); every right word refills it, and when it runs out the
   combo halves. The clock stops while a stroke is in the air, while paused
   and off the typing screen.

   Everything else reacts to the "study:*" events from study.js. Motion stays
   off the text itself, and prefers-reduced-motion drops the shake, the punch,
   the flash and most of the ink. */
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const frameEl = document.querySelector(".display-frame");
  const ink = $("funny-ink");
  const ctx = ink.getContext("2d");
  const comboEl = $("funny-combo");
  const comboNum = comboEl.querySelector("b");
  const shoutEl = $("funny-shout");
  const soundBtn = $("funny-sound");
  const scoreEl = $("funny-score");
  const scoreNum = scoreEl.querySelector("b");
  const gradeEl = $("funny-grade");
  const titleEl = $("study-title");
  const decodedEl = $("decoded-text");
  const keyboardEl = document.querySelector(".keyboard-shell");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const TIERS = [5, 10, 20, 40];
  const SHOUTS = { 5: "Sharp.", 10: "Fluent.", 40: "Inkstorm." }; // 20 is the fever
  const FEVER_AT = 20;
  const windowFor = (combo) => (S.fever ? 4000 : combo >= 10 ? 4500 : 5000); // ms before the combo halves
  const timerBar = comboEl.querySelector(".funny-timer i");
  const RED = "#d6452b";
  const INK = "#111111";
  const tierOf = (n) => TIERS.filter((t) => n >= t).length; // 0..4

  const MULT = [1, 2, 3, 4, 5]; // by tier
  const PERFECT_BONUS = 500;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const S = {
    score: 0, // the session's points (restored from the server on resume)
    shown: 0, // the number on screen while it rolls
    lastHitAt: 0,
    block: null, // { n, perfect, cer: [], breaks, points }
    combo: 0,
    fever: false,
    clock: 0, // ms left before the combo halves
    stroking: false,
    frozen: false, // a wrong word is waiting to be fixed
    blockBest: 0,
    target: [],
    prev: [],
    hit: new Set(), // indices of target words already stamped
    trial: { hits: 0, saves: 0, breaks: 0, decays: 0, max: 0, points: 0, bonus: 0 }
  };
  const newBlock = () => ({ n: 0, perfect: 0, cer: [], breaks: 0, points: 0 });
  S.block = newBlock();

  // the stroke being drawn, in frame pixels (for the burst along it)
  let path = [];
  socket.addEventListener("message", (event) => {
    let m;
    try { m = JSON.parse(event.data); } catch (_) { return; }
    if (m.type === "gesture-start" && m.point) {
      path = [toDisplayPoint(m.point)];
      S.stroking = true; // the decay clock waits while a stroke is in the air
    } else if (m.type === "gesture-move" && m.point && path.length < 400) {
      path.push(toDisplayPoint(m.point));
    } else if (m.type === "gesture-end" || m.type === "gesture-cancel") {
      S.stroking = false;
    }
  });

  const haptic = (pattern) => sendMessage({ type: "study-haptic", pattern });

  // ---------------------------------------------------------------- combo engine

  const correctUpTo = (words, n) => words.slice(0, n).every((w, i) => w === S.target[i]);

  document.addEventListener("study:trial-start", (e) => {
    S.target = e.detail.target.split(" ");
    S.prev = [];
    S.hit = new Set();
    S.frozen = false;
    S.trial = { hits: 0, saves: 0, breaks: 0, decays: 0, max: S.combo, points: 0, bonus: 0 };
    S.lastHitAt = performance.now();
    S.clock = windowFor(S.combo); // reading a new phrase costs nothing
    titleEl.classList.remove("funny-sweep");
    wrapTitle();
    paintCombo();
  });

  document.addEventListener("study:text", (e) => {
    const words = e.detail.text ? e.detail.text.split(" ") : [];
    const prev = S.prev;
    S.prev = words;
    const samePrefix = (n) => words.slice(0, n).every((w, i) => w === prev[i]);
    if (words.length > prev.length && samePrefix(prev.length)) {
      for (let i = prev.length; i < words.length; i++) {
        if (words[i] === S.target[i] && correctUpTo(words, i) && !S.frozen) onHit(i, words[i]);
        else if (S.frozen) onBreak();
        else onFreeze();
      }
    } else if (words.length === prev.length && words.length && samePrefix(words.length - 1)) {
      // the last word was swapped from the candidate bar
      if (correctUpTo(words, words.length)) {
        if (S.frozen) onSave(words.length - 1, words[words.length - 1]);
      } else if (!S.frozen) {
        onFreeze();
      }
    } else if (words.length < prev.length) {
      onBreak();
      S.frozen = !correctUpTo(words, words.length);
      for (const i of [...S.hit]) if (i >= words.length) S.hit.delete(i);
      paintTitle();
      paintCombo();
    }
  });

  function onHit(i, word) {
    S.combo++;
    S.trial.hits++;
    S.trial.max = Math.max(S.trial.max, S.combo);
    S.blockBest = Math.max(S.blockBest, S.combo);
    S.hit.add(i);
    const tier = tierOf(S.combo);
    // points: the multiplier by tier, plus speed (words per minute for this word)
    const now = performance.now();
    const perMinute = 60000 / Math.max(1, now - S.lastHitAt);
    S.lastHitAt = now;
    if (!S.fever && S.combo >= FEVER_AT) enterFever();
    const points = (100 * MULT[tier] + Math.max(0, Math.min(100, Math.round((perMinute - 20) * 2)))) * (S.fever ? 2 : 1);
    S.clock = windowFor(S.combo);
    S.trial.points += points;
    stampWord(word, tier);
    flashKeys(word);
    const p = cursorPoint();
    burstAlong(path, tier);
    splash(p.x, p.y, tier, 1);
    ring(p.x, p.y, 40 + tier * 22, tier >= 3 ? RED : INK);
    floatPoints(p.x, p.y, `+${points}`, tier);
    addScore(points);
    shake(tier);
    punch(0.006 + tier * 0.003);
    paintTitle();
    paintCombo(true);
    setHotInk(tier);
    heat(tier);
    const pan = Math.max(-1, Math.min(1, (p.x / frameEl.clientWidth) * 2 - 1));
    sound.hit(S.combo, tier, pan);
    sound.bed(tier);
    haptic([14 + tier * 7]);
    if (SHOUTS[S.combo]) {
      shout(SHOUTS[S.combo], tier);
      inkFlash(tier);
      speedLines(tier);
      ring(p.x, p.y, 220, RED);
      sound.milestone(S.combo);
      haptic([35, 45, 35, 45, 90]);
    }
  }

  function onSave(i, word) {
    S.frozen = false;
    S.trial.saves++;
    S.clock = windowFor(S.combo);
    S.hit.add(i);
    stampWord(word, 0);
    paintTitle();
    paintCombo();
    sound.save();
  }

  function onFreeze() {
    S.frozen = true;
    paintCombo();
    sound.miss();
  }

  function onBreak() {
    S.frozen = false;
    if (S.combo === 0) return;
    S.trial.breaks++;
    S.block.breaks++;
    const lost = S.combo;
    S.combo = 0;
    setHotInk(0);
    comboNum.textContent = `×${lost}`;
    restartClass(comboEl, "is-break");
    if (S.fever) exitFever();
    heat(0);
    sound.crash();
    sound.bed(0, true);
    haptic([140]);
    if (!reduced) restartClass(frameEl, "funny-drain");
  }

  document.addEventListener("study:trial-end", (e) => {
    const r = e.detail.result;
    if (e.detail.status !== "forced") {
      S.block.n++;
      S.block.cer.push(r.cer);
      if (r.perfect) S.block.perfect++;
    }
    S.block.points += S.trial.points;
    if (S.trial.bonus) {
      const rr = decodedEl.getBoundingClientRect();
      const ff = frameEl.getBoundingClientRect();
      floatPoints(rr.left - ff.left + rr.width / 2, rr.top - ff.top, `Perfect +${S.trial.bonus}`, 3, true);
      addScore(S.trial.bonus);
    }
    if (e.detail.status !== "matched") return;
    // the finisher: the phrase ripples, a red line sweeps under it, big ink
    const tier = tierOf(S.combo);
    restartClass(titleEl, "funny-sweep");
    titleEl.querySelectorAll(".funny-w").forEach((w) => restartClass(w, "is-wave"));
    const box = decodedEl.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    const cx = box.left - f.left + box.width / 2;
    const cy = box.top - f.top + box.height / 2;
    splash(cx, cy, Math.max(2, tier), 2.2);
    ring(cx, cy, 320, RED);
    shake(Math.max(2, tier));
    punch(0.02);
    sound.finish(tier);
    haptic([20, 30, 20, 30, 70]);
  });

  document.addEventListener("study:screen", (e) => {
    const screen = e.detail.screen;
    if (screen === "ready") {
      S.combo = 0; // a fresh block starts from zero
      S.blockBest = 0;
      S.frozen = false;
      S.block = newBlock();
      setHotInk(0);
    }
    // the beat and the heat belong to typing
    if (!["trial", "feedback"].includes(screen)) {
      sound.bed(0);
      heat(0);
      if (S.fever) exitFever(true);
    }
    scoreEl.hidden = screen === "setup" || !screen;
    if (screen === "summary") stampGrade();
    else gradeEl.hidden = true;
    if (screen === "end") sendMessage({ type: "study-leaderboard" });
    if (screen === "trial" || screen === "feedback") wrapTitle();
    paintCombo();
  });

  // results: the phrase's points are saved with the trial (the leaderboard
  // adds them up); the perfect bonus is settled here, when the phrase is saved
  window.STUDY_HOOKS = {
    clientExtra: (r) => {
      if (r.status === "redo") {
        // a redone attempt scores nothing
        S.score -= S.trial.points;
        S.shown = S.score;
        paintScore();
        S.trial.points = 0;
      } else if (r.perfect && !S.trial.bonus) {
        S.trial.bonus = PERFECT_BONUS;
        S.trial.points += PERFECT_BONUS;
      }
      return { combo: { score: S.trial.points, max: S.trial.max, hits: S.trial.hits, saves: S.trial.saves,
                        breaks: S.trial.breaks, decays: S.trial.decays, fever: S.fever } };
    },
    flashExtra: () => (S.trial.points > 0 ? [`<b>+${fmt(S.trial.points)}</b><small>points</small>`] : []),
    summaryExtra: () => [[fmt(S.block.points), "points"], [`×${S.blockBest}`, "best combo"]]
  };

  // resume: the session's points so far
  document.addEventListener("study:session", (e) => {
    S.score = (e.detail.session.results || []).reduce((a, r) => a + ((r.client && r.client.combo && r.client.combo.score) || 0), 0);
    S.shown = S.score;
    paintScore();
  });

  // ---------------------------------------------------------------- score

  let rollFrom = 0;
  let rollStart = 0;

  function addScore(points) {
    rollFrom = S.shown;
    rollStart = performance.now();
    S.score += points;
    restartClass(scoreEl, "is-bump");
    requestAnimationFrame(roll);
  }

  // the number counts up to the new total
  function roll(now) {
    const t = Math.min(1, (now - rollStart) / 450);
    S.shown = rollFrom + (S.score - rollFrom) * (1 - (1 - t) ** 3);
    paintScore();
    if (t < 1) requestAnimationFrame(roll);
  }

  function paintScore() {
    scoreNum.textContent = fmt(S.shown);
  }

  // "+240" rises from where the stroke ended
  function floatPoints(x, y, text, tier, big = false) {
    const el = document.createElement("span");
    el.className = `funny-points${big ? " is-big" : ""}`;
    el.dataset.tier = tier;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    frameEl.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  // ---------------------------------------------------------------- grade

  // S: every phrase perfect and the combo never broke; A: 97%+ accurate with
  // most phrases perfect; B: 90%+ accurate; C: the rest
  function gradeOf(b) {
    const acc = b.cer.length ? 1 - b.cer.reduce((a, x) => a + x, 0) / b.cer.length : 0;
    if (b.n && b.perfect === b.n && !b.breaks) return "S";
    if (acc >= 0.97 && b.perfect / Math.max(1, b.n) >= 0.6) return "A";
    if (acc >= 0.9) return "B";
    return "C";
  }

  function stampGrade() {
    const g = gradeOf(S.block);
    gradeEl.innerHTML = `<b>${g}</b><span>grade</span>`;
    gradeEl.dataset.grade = g;
    gradeEl.hidden = false;
    restartClass(gradeEl, "is-on");
    setTimeout(() => {
      const r = gradeEl.getBoundingClientRect();
      const f = frameEl.getBoundingClientRect();
      splash(r.left - f.left + r.width / 2, r.top - f.top + r.height / 2, g === "S" ? 4 : g === "A" ? 3 : 1, 1.8);
      shake(g === "S" ? 4 : 2);
      punch(g === "S" ? 0.03 : 0.015);
      if (g === "S") { inkFlash(4); speedLines(4); }
      sound.grade(g);
      haptic(g === "S" ? [40, 50, 40, 50, 160] : g === "A" ? [40, 60, 90] : [60]);
    }, 180);
  }

  // ---------------------------------------------------------------- leaderboard

  socket.addEventListener("message", (event) => {
    let m;
    try { m = JSON.parse(event.data); } catch (_) { return; }
    if (m.type !== "study-update" || !m.leaderboard || body.dataset.screen !== "end") return;
    const b = m.leaderboard;
    const rows = b.top.slice();
    if (b.me && !rows.some((r) => r.me)) rows.push(b.me); // outside the top: show own row last
    const sheet = $("study-sheet");
    sheet.querySelector(".funny-board")?.remove();
    const el = document.createElement("div");
    el.className = "funny-board";
    el.innerHTML = `<h3>Leaderboard${b.me ? ` <em>you are #${b.me.rank} of ${b.total}</em>` : ""}</h3>
      <ol>${rows.map((r) => `<li class="${r.me ? "is-me" : ""}"><span class="rank">${r.rank}</span><span class="pid">${r.pid}</span><span class="combo">×${r.best_combo}</span><b>${fmt(r.score)}</b></li>`).join("")}</ol>`;
    sheet.appendChild(el);
    if (b.me && b.me.rank <= 3) sound.grade("S");
  });

  // ---------------------------------------------------------------- fever

  function enterFever() {
    S.fever = true;
    body.classList.add("is-fever");
    animate(); // the motes need the loop
    shout("Fever ×2", 4);
    inkFlash(4);
    speedLines(4);
    sound.fever(true);
    haptic([60, 40, 60, 40, 200]);
  }

  function exitFever(quiet = false) {
    S.fever = false;
    body.classList.remove("is-fever");
    if (!quiet) {
      sound.fever(false);
      haptic([90, 60, 90]);
    } else {
      sound.fever(false, true);
    }
  }

  // ---------------------------------------------------------------- decay

  let lastFrame = performance.now();
  let ticked = 0;

  function clockRuns() {
    return S.combo > 0 && body.dataset.screen === "trial" && !body.classList.contains("is-paused") && !S.stroking;
  }

  function tickClock(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (clockRuns()) {
      const before = S.clock;
      S.clock -= dt;
      // a tick in the last second, twice
      if ((before > 1000 && S.clock <= 1000) || (before > 500 && S.clock <= 500)) sound.tick();
      if (S.clock <= 0) decay();
    }
    const full = windowFor(S.combo);
    const left = Math.max(0, Math.min(1, S.clock / full));
    timerBar.style.transform = `scaleX(${S.combo > 0 ? left : 0})`;
    comboEl.classList.toggle("is-hurry", S.combo > 0 && left < 0.3);
    comboEl.classList.toggle("is-last", S.combo > 0 && S.clock < 1000 && clockRuns());
    requestAnimationFrame(tickClock);
  }
  requestAnimationFrame(tickClock);

  // time ran out: the combo halves (and fever ends below 20)
  function decay() {
    const was = S.combo;
    S.combo = Math.floor(S.combo / 2);
    S.trial.decays++;
    if (S.fever && S.combo < FEVER_AT) exitFever();
    const tier = tierOf(S.combo);
    setHotInk(tier);
    heat(tier);
    sound.decay();
    sound.bed(tier);
    haptic([50]);
    if (S.combo === 0) {
      comboNum.textContent = `×${was}`;
      restartClass(comboEl, "is-break");
    } else {
      S.clock = windowFor(S.combo);
      paintCombo();
      restartClass(comboEl, "is-decay");
    }
  }

  // ---------------------------------------------------------------- the prompt

  // the target phrase as one span per word, so stamped words can be inked
  function wrapTitle() {
    if (!["trial", "feedback"].includes(body.dataset.screen)) return;
    if (titleEl.querySelector(".funny-w") || !titleEl.textContent.trim()) return paintTitle();
    const words = titleEl.textContent.trim().split(" ");
    titleEl.innerHTML = words
      .map((w, i) => `<span class="funny-w" style="--i:${i}">${w.replace(/[&<>]/g, "")}</span>`)
      .join(" ");
    paintTitle();
  }

  function paintTitle() {
    titleEl.querySelectorAll(".funny-w").forEach((el, i) => el.classList.toggle("is-hit", S.hit.has(i)));
  }

  // the finisher's red rule goes once it has swept
  titleEl.addEventListener("animationend", (e) => {
    if (e.animationName === "funny-sweep") setTimeout(() => titleEl.classList.remove("funny-sweep"), 350);
  });

  // study.js rewrites the title on every render; wrap it again
  new MutationObserver(() => {
    if (!titleEl.querySelector(".funny-w")) wrapTitle();
  }).observe(titleEl, { childList: true });

  // ---------------------------------------------------------------- the combo counter

  function paintCombo(pop = false) {
    const show = S.combo >= 2 && ["trial", "feedback"].includes(body.dataset.screen);
    comboEl.hidden = !show && !comboEl.classList.contains("is-break");
    if (!show) return;
    comboEl.classList.remove("is-break");
    comboNum.textContent = `×${S.combo}`;
    comboEl.dataset.tier = tierOf(S.combo);
    comboEl.classList.toggle("is-frozen", S.frozen);
    placeCombo();
    if (pop) restartClass(comboEl, "is-pop");
  }

  comboEl.addEventListener("animationend", (e) => {
    if (e.animationName === "funny-break") {
      comboEl.classList.remove("is-break");
      comboEl.hidden = true;
    }
  });

  // right of the output line, at its height
  function placeCombo() {
    const r = decodedEl.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    comboEl.style.top = `${r.top - f.top + r.height / 2}px`;
  }

  // ---------------------------------------------------------------- stamp, keys, shout

  // the word just typed presses into the output line: a red copy lands on it
  function stampWord(word, tier) {
    const range = lastWordRange(word);
    if (!range) return;
    const r = range.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    const cs = getComputedStyle(decodedEl);
    const el = document.createElement("span");
    el.className = "funny-stamp";
    el.dataset.tier = tier;
    el.textContent = word;
    Object.assign(el.style, {
      left: `${r.left - f.left}px`, top: `${r.top - f.top}px`, height: `${r.height}px`,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontStyle: cs.fontStyle,
      fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, lineHeight: `${r.height}px`
    });
    frameEl.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  function lastWordRange(word) {
    const walker = document.createTreeWalker(decodedEl, NodeFilter.SHOW_TEXT);
    let node = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) node = n;
    if (!node) return null;
    const text = node.textContent.replace(/\s+$/, "");
    const start = text.lastIndexOf(word);
    if (start < 0) return null;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + word.length);
    return range;
  }

  function flashKeys(word) {
    [...word.toUpperCase()].forEach((ch, i) => {
      const key = keyboardEl.querySelector(`[data-key="${ch}"]`);
      if (!key) return;
      setTimeout(() => restartClass(key, "funny-key-hit"), i * 22);
    });
  }

  function shout(text, tier) {
    placeCombo();
    shoutEl.style.top = comboEl.style.top;
    shoutEl.textContent = text;
    shoutEl.dataset.tier = tier;
    restartClass(shoutEl, "is-on");
  }

  function shake(tier) {
    if (reduced) return;
    keyboardEl.style.setProperty("--funny-amp", `${1.5 + tier * 1.2}px`);
    restartClass(keyboardEl, "funny-shake");
  }

  // from tier 3 the trace is drawn heavier and in red (Editorial already inks
  // it red; other looks get the colour change too)
  function setHotInk(tier) {
    body.style.setProperty("--trace-color", tier >= 3 ? RED : "");
    body.style.setProperty("--trace-width", tier >= 3 ? "5.5" : "");
    if (tier < 3) {
      body.style.removeProperty("--trace-color");
      body.style.removeProperty("--trace-width");
    }
    if (typeof readTraceStyle === "function") readTraceStyle();
  }

  function restartClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function cursorPoint() {
    const c = $("cursor-marker").getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    return { x: c.left - f.left + c.width / 2, y: c.top - f.top + c.height / 2 };
  }

  // ---------------------------------------------------------------- ink

  let drops = []; // particles
  let waves = []; // shockwave rings
  let lines = []; // speed lines
  let motes = []; // fever: glowing motes drifting up the page edges
  let running = false;

  function sizeInk() {
    const r = frameEl.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    ink.width = r.width * dpr;
    ink.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", () => { sizeInk(); placeCombo(); });
  sizeInk();

  function animate() {
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  }

  function drop(x, y, vx, vy, tier, size = 1) {
    const redShare = [0.05, 0.15, 0.35, 0.6, 0.85][tier];
    drops.push({
      x, y, vx, vy,
      r: (1 + Math.random() * (2 + tier * 0.6)) * size,
      life: 1, decay: 0.022 + Math.random() * 0.03,
      streak: Math.random() < 0.35,
      color: Math.random() < redShare ? RED : INK
    });
  }

  // drops and short strokes of ink, black with more red as the combo climbs
  function splash(x, y, tier, scale) {
    const n = Math.round((reduced ? 4 : 10 + tier * 7) * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (2 + Math.random() * (3 + tier * 1.4)) * Math.sqrt(scale);
      drop(x, y, Math.cos(a) * v, Math.sin(a) * v - 1.2, tier);
    }
    animate();
  }

  // the whole word bursts: ink flies off the stroke, sideways to its direction
  function burstAlong(points, tier) {
    if (reduced || points.length < 2) return;
    const every = Math.max(1, Math.floor(points.length / (14 + tier * 6)));
    for (let i = every; i < points.length; i += every) {
      const a = points[i - every];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const v = 1.5 + Math.random() * (2 + tier);
      drop(b.x, b.y, (-dy / len) * v * side + (dx / len) * 0.8, (dx / len) * v * side + (dy / len) * 0.8 - 0.6, tier, 0.8);
    }
    animate();
  }

  function ring(x, y, radius, color) {
    if (reduced) return;
    waves.push({ x, y, radius, color, t: 0 });
    animate();
  }

  // manga speed lines, from the edges toward the middle, for a moment
  function speedLines(tier) {
    if (reduced) return;
    const w = frameEl.clientWidth;
    const h = frameEl.clientHeight;
    const cx = w / 2;
    const cy = h * 0.42;
    const n = 36 + tier * 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const far = Math.hypot(w, h) * 0.6;
      const near = far * (0.45 + Math.random() * 0.25);
      lines.push({ x0: cx + Math.cos(a) * far, y0: cy + Math.sin(a) * far, x1: cx + Math.cos(a) * near, y1: cy + Math.sin(a) * near,
                   width: 1 + Math.random() * (2 + tier), life: 1, color: Math.random() < 0.25 + tier * 0.12 ? RED : INK });
    }
    animate();
  }

  // a mote rises from an edge strip (left, right or bottom), swaying
  function spawnMote(burst = false) {
    const w = frameEl.clientWidth;
    const h = frameEl.clientHeight;
    const side = Math.random();
    const x = side < 0.4 ? Math.random() * w * 0.08 : side < 0.8 ? w - Math.random() * w * 0.08 : Math.random() * w;
    const y = side < 0.8 ? h * (0.3 + Math.random() * 0.75) : h + 4;
    const tier = tierOf(S.combo);
    motes.push({
      x, y, vy: -(0.5 + Math.random() * (burst ? 2.6 : 1.2)), phase: Math.random() * 6.3,
      sway: 0.3 + Math.random() * 0.9, r: 0.8 + Math.random() * (1.6 + tier * 0.4),
      life: 1, decay: 0.004 + Math.random() * 0.008,
      color: Math.random() < 0.35 + (tier >= 4 ? 0.2 : 0) ? RED : INK
    });
  }

  function step() {
    ctx.clearRect(0, 0, ink.width, ink.height);
    if (S.fever && !reduced && motes.length < 140) {
      const rate = tierOf(S.combo) >= 4 ? 1.6 : 0.8;
      for (let i = 0; i < Math.floor(rate + Math.random()); i++) spawnMote();
    }
    motes = motes.filter((m) => (m.life -= m.decay) > 0 && m.y > -10);
    ctx.shadowBlur = 10;
    for (const m of motes) {
      m.phase += 0.05;
      m.y += m.vy;
      m.x += Math.sin(m.phase) * m.sway;
      ctx.globalAlpha = Math.min(1, m.life * 1.6) * 0.85;
      ctx.fillStyle = ctx.shadowColor = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    lines = lines.filter((l) => (l.life -= 0.06) > 0);
    for (const l of lines) {
      ctx.globalAlpha = l.life * 0.7;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(l.x0, l.y0);
      ctx.lineTo(l.x1 + (l.x0 - l.x1) * (1 - l.life) * 0.5, l.y1 + (l.y0 - l.y1) * (1 - l.life) * 0.5);
      ctx.stroke();
    }
    waves = waves.filter((wv) => (wv.t += 0.055) < 1);
    for (const wv of waves) {
      const e = 1 - (1 - wv.t) ** 3;
      ctx.globalAlpha = (1 - wv.t) * 0.8;
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = 3.5 * (1 - wv.t) + 0.5;
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, 6 + wv.radius * e, 0, Math.PI * 2);
      ctx.stroke();
    }
    drops = drops.filter((d) => d.life > 0);
    for (const d of drops) {
      d.x += d.vx;
      d.y += d.vy;
      d.vx *= 0.9;
      d.vy = d.vy * 0.9 + 0.25;
      d.life -= d.decay;
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.fillStyle = ctx.strokeStyle = d.color;
      if (d.streak) {
        ctx.lineWidth = d.r * 0.9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.vx * 2.4, d.y - d.vy * 2.4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (drops.length || waves.length || lines.length || motes.length || S.fever) requestAnimationFrame(step);
    else running = false;
  }

  // ---------------------------------------------------------------- frame effects

  // the whole page leans in on a hit, a hair
  function punch(amount) {
    if (reduced) return;
    frameEl.style.setProperty("--funny-punch", String(1 + amount));
    restartClass(frameEl, "funny-punch");
  }

  // red heat at the edges, stronger with the combo; it pulses with the beat
  const stageEl = document.querySelector(".display-stage");
  function heat(tier) {
    stageEl.dataset.heat = tier;
  }

  // fever: slow diagonal stripes scrolling behind everything
  const stripesEl = document.createElement("div");
  stripesEl.className = "funny-stripes";
  stripesEl.setAttribute("aria-hidden", "true");
  frameEl.prepend(stripesEl);

  // a flash that inverts the page for an instant at a milestone (red above 20)
  const flashEl = document.createElement("div");
  flashEl.className = "funny-flash";
  flashEl.setAttribute("aria-hidden", "true");
  frameEl.appendChild(flashEl);
  function inkFlash(tier) {
    if (reduced) return;
    flashEl.dataset.tone = tier >= 3 ? "red" : "ink";
    restartClass(flashEl, "is-on");
  }

  // ---------------------------------------------------------------- sound

  // A small synth on Web Audio (no files). Hits are plucks on the chord of an
  // Am-F-C-G loop, climbing through its tones as the combo grows, over a sub
  // kick; everything goes through a compressor with a short reverb send. A
  // beat builds under the combo and tape-stops when it breaks.
  const sound = (() => {
    let ac = null;
    let out = null; // dry bus
    let verb = null; // reverb send
    let bedBus = null; // the track's pads and bass, ducked by the kick (side-chain)
    let echo = null; // a dotted-eighth echo for arps and leads
    let noise = null;
    let on = (() => { try { return localStorage.getItem("funnySound") !== "off"; } catch (_) { return true; } })();

    const BPM = 124;
    const BEAT = 60 / BPM;
    // Am, F, C, G as semitones from A3 (220 Hz)
    const CHORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
    const hz = (semi) => 220 * 2 ** (semi / 12);
    let chordIndex = 0;

    function audio() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
        } catch (_) {
          return null;
        }
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        const master = ac.createGain();
        master.gain.value = 0.8;
        master.connect(comp).connect(ac.destination);
        out = ac.createGain();
        out.connect(master);
        // reverb: a decaying noise impulse
        const len = ac.sampleRate * 1.6;
        const ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
        }
        const conv = ac.createConvolver();
        conv.buffer = ir;
        verb = ac.createGain();
        verb.gain.value = 0.35;
        verb.connect(conv).connect(master);
        bedBus = ac.createGain();
        bedBus.connect(out);
        // echo: dotted eighth, filtered feedback
        const delay = ac.createDelay(1.5);
        delay.delayTime.value = BEAT * 0.75;
        const fb = ac.createGain();
        fb.gain.value = 0.38;
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2600;
        const wet = ac.createGain();
        wet.gain.value = 0.55;
        delay.connect(lp).connect(fb).connect(delay);
        lp.connect(wet).connect(master);
        echo = ac.createGain();
        echo.connect(delay);
        noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    // browsers start audio only after a user action: any click or key unlocks it
    ["pointerdown", "keydown"].forEach((t) => addEventListener(t, () => on && audio(), { passive: true }));

    const ready = () => on && audio();

    function env(g, t0, gain, attack, decay) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    }

    function route(node, pan = 0, send = 0, { bus = null, delay = 0 } = {}) {
      const dest = bus === "bed" ? bedBus : out;
      const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (p) {
        p.pan.value = pan;
        node.connect(p).connect(dest);
      } else {
        node.connect(dest);
      }
      if (send) {
        const s = ac.createGain();
        s.gain.value = send;
        node.connect(s).connect(verb);
      }
      if (delay) {
        const d = ac.createGain();
        d.gain.value = delay;
        node.connect(d).connect(echo);
      }
    }

    function tone(freq, { type = "triangle", t = 0, attack = 0.002, decay = 0.2, gain = 0.3, bend = 0, pan = 0, send = 0, bus = null, delay = 0 } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t0 + attack + decay);
      env(g, t0, gain, attack, decay);
      o.connect(g);
      route(g, pan, send, { bus, delay });
      o.start(t0);
      o.stop(t0 + attack + decay + 0.05);
    }

    // a plucked synth: two detuned saws through a closing low-pass
    function pluck(freq, { t = 0, gain = 0.16, decay = 0.35, pan = 0, send = 0.3, bright = 1, bus = null, delay = 0, type = "sawtooth" } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 6;
      f.frequency.setValueAtTime(900 + 4200 * bright, t0);
      f.frequency.exponentialRampToValueAtTime(500, t0 + decay * 0.8);
      const g = ac.createGain();
      env(g, t0, gain, 0.003, decay);
      [-8, 8].forEach((cents) => {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = cents;
        o.connect(f);
        o.start(t0);
        o.stop(t0 + decay + 0.05);
      });
      f.connect(g);
      route(g, pan, send, { bus, delay });
    }

    function noiseHit({ t = 0, type = "highpass", freq = 3000, q = 0.8, decay = 0.05, gain = 0.2, pan = 0, send = 0 } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const src = ac.createBufferSource();
      src.buffer = noise;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      src.connect(f).connect(g);
      route(g, pan, send);
      src.start(t0);
      src.stop(t0 + decay + 0.02);
    }

    const kick = (t = 0, gain = 0.5) => tone(160, { type: "sine", t, decay: 0.16, gain, bend: 0.28 });
    const crashCymbal = (t = 0, gain = 0.18) => noiseHit({ t, freq: 6500, decay: 1.4, gain, send: 0.5 });

    // ---- the track under the combo: four on the floor that builds by tier
    //   1 (5+):  kick, hats, a filtered supersaw pad breathing with the kick
    //   2 (10+): offbeat bass, claps, the pad opens
    //   3 (20+, fever): the drop - open hats, a rolling arp with echo, rolling
    //            bass, deeper pumping, a crash every 4 bars
    //   4 (40+): a lead hook on top
    // The chord moves once a bar (Am F C G); hits play on the bar's chord.
    let bedTier = 0;
    let feverOn = false;
    let bedTimer = null;
    let nextBeat = 0;
    let sixteenth = 0;
    let pad = null;
    let barChord = 0;
    let onBeat = null; // visual callback, set from outside
    // the hook: chord-tone indices per sixteenth (null = rest), one bar
    const HOOK = [4, null, 3, null, 2, null, 3, 4, null, 5, 4, null, 3, null, 2, null];

    function startPad() {
      const t0 = ac.currentTime;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 3;
      f.frequency.value = 500;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.085, t0 + 0.8);
      f.connect(g);
      route(g, 0, 0.35, { bus: "bed" });
      const voices = [];
      for (let n = 0; n < 3; n++) {
        for (const cents of [-14, 0, 14]) {
          const o = ac.createOscillator();
          o.type = "sawtooth";
          o.detune.value = cents;
          o.connect(f);
          o.start(t0);
          voices.push(o);
        }
      }
      pad = { voices, f, g };
      padChord(barChord, t0);
    }

    function padChord(i, t) {
      const c = CHORDS[i];
      pad.voices.forEach((o, k) => o.frequency.setValueAtTime(hz(c[Math.floor(k / 3)]), t));
    }

    function stopPad(tape) {
      const t0 = ac.currentTime;
      const end = tape ? 0.7 : 0.4;
      if (tape) pad.voices.forEach((o) => o.frequency.exponentialRampToValueAtTime(18, t0 + end)); // tape stop
      pad.g.gain.cancelScheduledValues(t0);
      pad.g.gain.setValueAtTime(Math.max(0.0001, pad.g.gain.value), t0);
      pad.g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
      pad.voices.forEach((o) => o.stop(t0 + end + 0.05));
      pad = null;
    }

    // side-chain: the bed ducks on every kick and swells back
    function pump(t) {
      const depth = feverOn ? 0.12 : bedTier >= 2 ? 0.3 : 0.45;
      const at = ac.currentTime + t;
      bedBus.gain.cancelScheduledValues(at);
      bedBus.gain.setValueAtTime(depth, at);
      bedBus.gain.linearRampToValueAtTime(1, at + BEAT * 0.6);
    }

    function bass(freq, t, len) {
      tone(freq, { type: "sawtooth", t, attack: 0.004, decay: len, gain: 0.09, bus: "bed" });
      tone(freq / 2, { type: "sine", t, attack: 0.004, decay: len, gain: 0.16, bus: "bed" });
    }

    function scheduleBed() {
      while (nextBeat < ac.currentTime + 0.12) {
        const t = nextBeat - ac.currentTime;
        const pos = sixteenth % 16;
        const bar = Math.floor(sixteenth / 16);
        if (pos === 0) {
          barChord = bar % CHORDS.length;
          if (pad) padChord(barChord, ac.currentTime + t);
          if (feverOn && bar % 4 === 0) crashCymbal(t, 0.1);
        }
        const c = CHORDS[barChord];
        const tones = [c[0], c[1], c[2], c[0] + 12, c[1] + 12, c[2] + 12];
        if (pos % 4 === 0) {
          kick(t, 0.5 + bedTier * 0.05);
          pump(t);
          if (onBeat) setTimeout(() => onBeat(pos), Math.max(0, t * 1000));
        }
        // hats: offbeat eighths, then sixteenths, then open hats in the drop
        if (pos % 4 === 2) noiseHit({ t, freq: 8500, decay: feverOn ? 0.16 : 0.05, gain: feverOn ? 0.07 : 0.05, send: 0.1 });
        else if (bedTier >= 2 && pos % 2 === 1) noiseHit({ t, freq: 9500, decay: 0.025, gain: 0.03, pan: pos % 4 === 1 ? -0.3 : 0.3 });
        // bass: offbeat, rolling in the drop
        if (bedTier >= 2 && (pos % 4 === 2 || (feverOn && pos % 4 === 3))) bass(hz(c[0] - 12), t, BEAT * 0.22);
        // claps on 2 and 4
        if (bedTier >= 2 && (pos === 4 || pos === 12)) {
          noiseHit({ t, type: "bandpass", freq: 1400, q: 0.8, decay: 0.16, gain: 0.2, send: 0.35 });
          noiseHit({ t: t + 0.011, type: "bandpass", freq: 1700, q: 0.8, decay: 0.12, gain: 0.14 });
        }
        // the drop's arp, up and down the chord, with echo
        if (feverOn) {
          const up = [0, 1, 2, 3, 4, 5, 4, 3][pos % 8];
          pluck(hz(tones[up] + 12), { t, gain: 0.045, decay: 0.13, bright: 0.7, send: 0.15, delay: 0.35, pan: pos % 2 ? 0.35 : -0.35 });
        }
        // the hook at 40+
        if (bedTier >= 4 && HOOK[pos] !== null) {
          pluck(hz(tones[HOOK[pos]] + 12), { t, gain: 0.07, decay: 0.28, bright: 1, send: 0.3, delay: 0.4, type: "square" });
        }
        nextBeat += BEAT / 4;
        sixteenth++;
      }
    }

    return {
      get on() { return on; },
      set on(v) {
        on = v;
        try { localStorage.setItem("funnySound", v ? "on" : "off"); } catch (_) { /* storage off */ }
        if (v) audio();
        else this.bed(0);
      },

      // the melody: chord tones climbing with the combo; the chord moves every 4 hits
      hit(combo, tier, pan = 0) {
        if (!ready()) return;
        chordIndex = bedTier > 0 ? barChord : Math.floor((combo - 1) / 4) % CHORDS.length;
        const chord = CHORDS[chordIndex];
        const step = (combo - 1) % 8;
        const note = chord[step % 3] + 12 * Math.floor(step / 3);
        noiseHit({ freq: 3500, decay: 0.018, gain: 0.22 + tier * 0.03, pan }); // the snap
        pluck(hz(note + 12), { pan, gain: 0.15 + tier * 0.015, decay: 0.3 + tier * 0.05, bright: 0.5 + tier * 0.12, send: 0.25 + tier * 0.05 });
        if (tier >= 2) pluck(hz(note + 24), { pan: -pan, gain: 0.05, decay: 0.2, bright: 1 });
        kick(0, 0.45 + tier * 0.08); // the weight
      },

      set onBeat(fn) { onBeat = fn; },
      get playing() { return bedTier > 0; },

      // the track: none below 5, more layers per tier; a break tape-stops it
      bed(tier, tapeStop = false) {
        if (!ready()) return;
        if (tier === bedTier) return;
        if (tier === 0) {
          clearInterval(bedTimer);
          bedTimer = null;
          if (pad) stopPad(tapeStop);
          bedBus.gain.cancelScheduledValues(ac.currentTime);
          bedBus.gain.setValueAtTime(1, ac.currentTime);
          bedTier = 0;
          return;
        }
        bedTier = tier;
        if (!bedTimer) {
          nextBeat = ac.currentTime + 0.05;
          sixteenth = 0;
          barChord = chordIndex;
          startPad();
          bedTimer = setInterval(scheduleBed, 25);
        }
        // the pad's filter opens with the tier
        pad.f.frequency.setTargetAtTime([0, 520, 1300, 3000, 4200][tier], ac.currentTime, 0.4);
      },

      // an impact: kick, cymbal and a power chord that opens up
      milestone(combo) {
        if (!ready()) return;
        const chord = CHORDS[chordIndex];
        kick(0, 0.8);
        crashCymbal(0, 0.16 + Math.min(combo, 40) / 400);
        [0, 7, 12].forEach((iv) => pluck(hz(chord[0] + iv), { gain: 0.12, decay: 1.1, bright: 1.2, send: 0.6 }));
        [1, 1.5].forEach((m, i) => tone(hz(chord[0] + 24) * m, { type: "sine", t: 0.06 * (i + 1), decay: 0.8, gain: 0.06, send: 0.5 }));
      },

      // a run up the chord and a cymbal
      finish(tier) {
        if (!ready()) return;
        const chord = CHORDS[chordIndex];
        for (let i = 0; i < 7; i++) {
          pluck(hz(chord[i % 3] + 12 * (1 + Math.floor(i / 3))), { t: i * 0.045, gain: 0.1, decay: 0.4, bright: 1, send: 0.5, pan: (i / 6) * 1.2 - 0.6 });
        }
        crashCymbal(0.3, 0.12 + tier * 0.03);
        kick(0.3, 0.6);
      },

      save() {
        pluck(hz(CHORDS[chordIndex][2] + 12), { gain: 0.08, decay: 0.2, bright: 0.4 });
      },

      // fever: a power-up sweep into a hit / a power-down when it ends
      fever(onNow, quiet = false) {
        if (!ready()) return;
        feverOn = onNow;
        if (pad) pad.f.frequency.setTargetAtTime(onNow ? 5200 : [0, 520, 1300, 3000, 4200][bedTier], ac.currentTime, 0.25);
        if (quiet) return;
        const t0 = ac.currentTime;
        const o = ac.createOscillator();
        const f = ac.createBiquadFilter();
        const g = ac.createGain();
        o.type = "sawtooth";
        f.type = "lowpass";
        f.Q.value = 8;
        o.frequency.setValueAtTime(onNow ? 110 : 440, t0);
        o.frequency.exponentialRampToValueAtTime(onNow ? 880 : 55, t0 + 0.45);
        f.frequency.setValueAtTime(onNow ? 400 : 4000, t0);
        f.frequency.exponentialRampToValueAtTime(onNow ? 6000 : 200, t0 + 0.45);
        env(g, t0, 0.14, 0.02, 0.5);
        o.connect(f).connect(g);
        route(g, 0, 0.4);
        o.start(t0);
        o.stop(t0 + 0.6);
        if (onNow) {
          kick(0.45, 0.9);
          crashCymbal(0.45, 0.22);
        }
      },

      // the combo halves: two notes falling
      decay() {
        const root = CHORDS[chordIndex][0];
        pluck(hz(root + 12), { gain: 0.09, decay: 0.18, bright: 0.3 });
        pluck(hz(root + 5), { t: 0.09, gain: 0.09, decay: 0.3, bright: 0.2 });
      },
      tick() {
        noiseHit({ type: "bandpass", freq: 2400, q: 6, decay: 0.03, gain: 0.12 });
      },
      miss() {
        tone(150, { type: "sine", decay: 0.09, gain: 0.14, bend: 0.8 });
      },
      crash() {
        tone(110, { type: "sine", decay: 0.35, gain: 0.35, bend: 0.4 });
        noiseHit({ type: "lowpass", freq: 600, decay: 0.25, gain: 0.25 });
      },

      // a heavy stamp, then a fanfare that brightens with the grade
      grade(g) {
        if (!ready()) return;
        kick(0, 0.9);
        noiseHit({ type: "lowpass", freq: 900, decay: 0.12, gain: 0.3 });
        const up = { S: [0, 4, 7, 12, 16, 19], A: [0, 4, 7, 12], B: [0, 4, 7], C: [0, 3] }[g];
        up.forEach((iv, i) => pluck(hz(3 + iv + 12), { t: 0.1 + i * 0.07, gain: 0.11, decay: 0.7, bright: 1, send: 0.5 }));
        if (g === "S") crashCymbal(0.1 + up.length * 0.07, 0.2);
      }
    };
  })();

  // the track's kick drives the picture: the combo nods on every beat, and in
  // fever the edges flare, the keys' lines flash red and motes kick up
  sound.onBeat = () => {
    if (!sound.playing || body.dataset.screen !== "trial") return;
    restartClass(comboEl, "on-beat");
    if (!S.fever || reduced) return;
    restartClass(stageEl, "on-beat");
    keyboardEl.classList.add("beat-flash");
    setTimeout(() => keyboardEl.classList.remove("beat-flash"), 110);
    for (let i = 0; i < 5; i++) spawnMote(true);
  };

  // ---------------------------------------------------------------- sound toggle

  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  function paintSound() {
    soundBtn.innerHTML = sound.on ? ICON_ON : ICON_OFF;
    soundBtn.setAttribute("aria-pressed", String(sound.on));
    soundBtn.title = sound.on ? "Sound on" : "Sound off";
  }
  soundBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // not a study target
    sound.on = !sound.on;
    paintSound();
  });
  paintSound();
})();
