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

   Everything else reacts to the "study:*" events from study.js. Motion stays off the text itself (only the keyboard shakes),
   and prefers-reduced-motion drops the shake and most of the ink. */
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
  const SHOUTS = { 5: "Sharp.", 10: "Fluent.", 20: "Unstoppable.", 40: "Inkstorm." };
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
    frozen: false, // a wrong word is waiting to be fixed
    blockBest: 0,
    target: [],
    prev: [],
    hit: new Set(), // indices of target words already stamped
    trial: { hits: 0, saves: 0, breaks: 0, max: 0, points: 0, bonus: 0 }
  };
  const newBlock = () => ({ n: 0, perfect: 0, cer: [], breaks: 0, points: 0 });
  S.block = newBlock();

  // ---------------------------------------------------------------- combo engine

  const correctUpTo = (words, n) => words.slice(0, n).every((w, i) => w === S.target[i]);

  document.addEventListener("study:trial-start", (e) => {
    S.target = e.detail.target.split(" ");
    S.prev = [];
    S.hit = new Set();
    S.frozen = false;
    S.trial = { hits: 0, saves: 0, breaks: 0, max: S.combo, points: 0, bonus: 0 };
    S.lastHitAt = performance.now();
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
    const points = 100 * MULT[tier] + Math.max(0, Math.min(100, Math.round((perMinute - 20) * 2)));
    S.trial.points += points;
    stampWord(word, tier);
    flashKeys(word);
    const p = cursorPoint();
    splash(p.x, p.y, tier, 1);
    floatPoints(p.x, p.y, `+${points}`, tier);
    addScore(points);
    shake(tier);
    paintTitle();
    paintCombo(true);
    setHotInk(tier);
    sound.hit(S.combo, tier);
    if (SHOUTS[S.combo]) {
      shout(SHOUTS[S.combo], tier);
      sound.milestone(S.combo);
    }
  }

  function onSave(i, word) {
    S.frozen = false;
    S.trial.saves++;
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
    sound.crash();
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
    splash(box.left - f.left + box.width / 2, box.top - f.top + box.height / 2, Math.max(2, tier), 2.2);
    shake(Math.max(2, tier));
    sound.finish(tier);
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
      return { combo: { score: S.trial.points, max: S.trial.max, hits: S.trial.hits, saves: S.trial.saves, breaks: S.trial.breaks } };
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
      sound.grade(g);
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

  let drops = [];
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

  // drops and short strokes of ink, black with more red as the combo climbs
  function splash(x, y, tier, scale) {
    const n = Math.round((reduced ? 4 : 10 + tier * 7) * scale);
    const redShare = [0.05, 0.15, 0.35, 0.6, 0.85][tier];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (2 + Math.random() * (3 + tier * 1.4)) * Math.sqrt(scale);
      drops.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.2,
        r: 1 + Math.random() * (2 + tier * 0.6),
        life: 1, decay: 0.022 + Math.random() * 0.03,
        streak: Math.random() < 0.35,
        color: Math.random() < redShare ? RED : INK
      });
    }
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  }

  function step() {
    ctx.clearRect(0, 0, ink.width, ink.height);
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
    if (drops.length) requestAnimationFrame(step);
    else running = false;
  }

  // ---------------------------------------------------------------- sound

  // Synthesized with Web Audio, no files: a woody key strike over a low thump,
  // pitched up a pentatonic step per combo, so a run climbs like a scale.
  const sound = (() => {
    let ac = null;
    let master = null;
    let noise = null;
    let on = (() => { try { return localStorage.getItem("funnySound") !== "off"; } catch (_) { return true; } })();

    function audio() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
        } catch (_) {
          return null;
        }
        const comp = ac.createDynamicsCompressor();
        master = ac.createGain();
        master.gain.value = 0.7;
        master.connect(comp).connect(ac.destination);
        noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    // browsers start audio only after a user action: any click or key unlocks it
    ["pointerdown", "keydown"].forEach((t) => addEventListener(t, () => on && audio(), { passive: true }));

    const PENTA = [0, 2, 4, 7, 9];
    const noteHz = (step) => 196 * 2 ** ((12 * Math.floor(step / 5) + PENTA[step % 5]) / 12);

    function tone(freq, { type = "triangle", t = 0, attack = 0.002, decay = 0.2, gain = 0.3, bend = 0 } = {}) {
      const a = audio();
      if (!a || !on) return;
      const t0 = a.currentTime + t;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t0 + decay);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + decay + 0.05);
    }

    function click({ t = 0, freq = 3200, q = 1.2, decay = 0.03, gain = 0.25 } = {}) {
      const a = audio();
      if (!a || !on) return;
      const t0 = a.currentTime + t;
      const src = a.createBufferSource();
      src.buffer = noise;
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = a.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      src.connect(bp).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + decay + 0.02);
    }

    return {
      get on() { return on; },
      set on(v) {
        on = v;
        try { localStorage.setItem("funnySound", v ? "on" : "off"); } catch (_) { /* storage off */ }
        if (v) audio();
      },
      hit(combo, tier) {
        const f = noteHz(Math.min(combo - 1, 24));
        click({ gain: 0.18 + tier * 0.04 });
        tone(f, { decay: 0.16 + tier * 0.03, gain: 0.22 });
        tone(f * 2, { type: "sine", decay: 0.08, gain: 0.06 });
        tone(95, { type: "sine", decay: 0.12 + tier * 0.02, gain: 0.25 + tier * 0.05, bend: 0.55 }); // the weight
      },
      milestone(combo) {
        const f = noteHz(Math.min(combo, 24));
        [1, 1.26, 1.5, 2].forEach((m, i) => tone(f * m, { t: i * 0.05, decay: 0.5, gain: 0.12, type: "sine" }));
      },
      finish(tier) {
        // a bell: inharmonic partials, long decay
        const base = 880 * (tier >= 3 ? 1.12 : 1);
        [[1, 0.2], [2.76, 0.08], [5.4, 0.04]].forEach(([m, g]) => tone(base * m, { type: "sine", decay: 1.2, gain: g }));
        click({ freq: 5000, decay: 0.02, gain: 0.12 });
      },
      save() {
        tone(noteHz(4), { decay: 0.12, gain: 0.1, type: "sine" });
      },
      miss() {
        tone(150, { type: "sine", decay: 0.09, gain: 0.12, bend: 0.8 });
      },
      crash() {
        tone(110, { type: "sine", decay: 0.35, gain: 0.3, bend: 0.5 });
        click({ freq: 400, q: 0.7, decay: 0.2, gain: 0.2 });
      },
      grade(g) {
        // a heavy stamp, then a chord that brightens with the grade
        tone(70, { type: "sine", decay: 0.3, gain: 0.45, bend: 0.5 });
        click({ freq: 900, q: 0.8, decay: 0.08, gain: 0.3 });
        const chord = { S: [1, 1.26, 1.5, 2, 2.52], A: [1, 1.26, 1.5, 2], B: [1, 1.26, 1.5], C: [1, 1.19] }[g];
        chord.forEach((m, i) => tone(262 * m, { t: 0.08 + i * 0.06, decay: 0.9, gain: 0.1, type: "sine" }));
      }
    };
  })();

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
