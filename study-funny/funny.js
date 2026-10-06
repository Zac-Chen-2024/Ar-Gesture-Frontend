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

   Players come in by name, no password (the server keeps their runs, records
   and leaderboard places; a new name makes a new player); the page remembers
   who played last. A wrong word
   lights up the right one in the candidate bar when it is there. Long words
   hit harder and score more (x1.5 from 7 letters, x2 from 9). Endless runs
   tighten the decay clock as they go, and every 50 phrases is a milestone
   with a life back. Runs end on a personal best check and two boards (the
   last 24 hours and all time). In fever the track breaks down every third
   section and drops back in.

   Everything else reacts to the "study:*" events from study.js. Motion stays
   off the text itself, and prefers-reduced-motion drops the shake, the punch,
   the flash and most of the ink. */
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const frameEl = document.querySelector(".display-frame");
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

  // Levels: one every 3 right words in a row. Each adds to the track, may
  // change the chords, the key and the hit's instrument, and moves the look:
  // accent colour, light colour, light styles, background and small touches
  // on the page (lv-* classes). Fever is a level (21 in a row).
  //   lights: glow (edges), pulse (on the beat), beams (swinging stage beams),
  //           spot (follows the cursor), lasers (on the beat), strobe (on the
  //           beat, soft), rainbow (the accent cycles)
  //   bg:     dots, stripes, grid, stars (behind the keyboard)
  const LEVELS = [
    { name: "", accent: "#d6452b", light: "214,69,43", lights: [], bg: "", add: [], progs: ["A", "E"], key: 0, voice: "pluck", padCut: 500 },
    { name: "Warm up", accent: "#d6452b", light: "214,69,43", lights: ["glow"], bg: "", add: ["kick"], progs: ["A", "E"], key: 0, voice: "pluck", padCut: 500 },
    { name: "Groove", accent: "#d6452b", light: "214,69,43", lights: ["glow"], bg: "", add: ["hat", "pad"], progs: ["A", "E"], key: 0, voice: "pluck", padCut: 600 },
    { name: "Sharp", accent: "#e0582a", light: "224,88,42", lights: ["glow", "pulse"], bg: "", add: ["clap", "build"], progs: ["A", "E"], key: 0, voice: "square", padCut: 900 },
    { name: "Fluent", accent: "#e8772e", light: "232,119,46", lights: ["glow", "pulse"], bg: "dots", add: ["bass"], progs: ["A", "E", "H"], key: 0, voice: "square", padCut: 1300 },
    { name: "Heat", accent: "#e8772e", light: "232,119,46", lights: ["pulse", "beams"], bg: "dots", add: ["arp"], progs: ["B", "H", "E"], key: 0, voice: "square", padCut: 1800 },
    { name: "Blaze", accent: "#d6337a", light: "214,51,122", lights: ["pulse", "beams"], bg: "dots", add: ["open", "hat16"], progs: ["B", "F", "H"], key: 0, voice: "bell", padCut: 2400 },
    { name: "Fever", accent: "#d6337a", light: "214,51,122", lights: ["beams", "strobe"], bg: "stripes", add: ["roll", "sub", "crash", "kick2"], progs: ["F", "G", "B"], key: 0, voice: "bell", padCut: 4200, fever: true },
    { name: "Neon", accent: "#1fb5cc", light: "31,181,204", lights: ["beams", "spot"], bg: "stripes", add: ["hook"], progs: ["G", "F", "C"], key: 0, voice: "bell", padCut: 4600 },
    { name: "Overdrive", accent: "#1fb5cc", light: "31,181,204", lights: ["spot", "lasers"], bg: "grid", add: ["stab"], progs: ["C", "G", "D"], key: 2, voice: "stab", padCut: 4800 },
    { name: "Lightspeed", accent: "#8a5cf6", light: "138,92,246", lights: ["beams", "lasers"], bg: "grid", add: ["ride"], progs: ["D", "B", "C"], key: 2, voice: "stab", padCut: 5000 },
    { name: "Unstoppable", accent: "#8a5cf6", light: "138,92,246", lights: ["beams", "lasers", "strobe"], bg: "grid", add: [], progs: ["G", "F", "D"], key: 2, voice: "stab", padCut: 5200 },
    { name: "Supernova", accent: "#e9b21f", light: "233,178,31", lights: ["beams", "spot", "strobe"], bg: "stars", add: [], progs: ["H", "D", "G"], key: 4, voice: "glass", padCut: 5400 },
    { name: "Stellar", accent: "#e9b21f", light: "233,178,31", lights: ["beams", "spot", "lasers", "strobe"], bg: "stars", add: ["perc"], progs: ["H", "C", "G", "B"], key: 4, voice: "glass", padCut: 5600 },
    { name: "Mythic", accent: "rainbow", light: "", lights: ["beams", "spot", "lasers", "strobe", "rainbow"], bg: "stars", add: [], progs: ["G", "H", "D", "F"], key: 5, voice: "stab", padCut: 5800 },
    { name: "Inkstorm", accent: "rainbow", light: "", lights: ["beams", "spot", "lasers", "strobe", "rainbow", "fast"], bg: "stars", add: [], progs: ["C", "G", "H", "B"], key: 7, voice: "glass", padCut: 6000 }
  ];
  // the track's layers accumulate level by level
  LEVELS.forEach((l, i) => { l.layers = new Set([...(i ? LEVELS[i - 1].layers : []), ...l.add]); });
  const levelOf = (n) => Math.min(LEVELS.length - 1, Math.floor(n / 3));
  const tierOf = (n) => Math.min(4, Math.floor(levelOf(n) / 3)); // intensity 0-4: ink, shake, heat
  const FEVER_AT = 3 * LEVELS.findIndex((l) => l.fever);
  const multOf = (n) => 1 + Math.floor(levelOf(n) / 2); // x1 ... x8
  // ms before the combo halves; an endless run tightens it as it goes (to 65%)
  const windowFor = (combo) => [5000, 4500, 4000, 3600, 3300][tierOf(combo)] * (S.endlessAt == null ? 1 : Math.max(0.65, 1 - S.endlessAt / 500 * 0.35));
  const timerBar = comboEl.querySelector(".funny-timer i");
  const INK = "#111111";
  let RED = "#d6452b"; // the current accent (canvas colours follow the level)

  const PERFECT_BONUS = 500;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const S = {
    score: 0, // the session's points (restored from the server on resume)
    shown: 0, // the number on screen while it rolls
    lastHitAt: 0,
    block: null, // { n, perfect, cer: [], breaks, points }
    combo: 0,
    level: 0,
    endlessAt: null, // the phrase index in an endless run
    bestBefore: 0, // the player's best endless run before this one
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
    // after display.js has drawn the candidates
    if (m.type === "state-update" || m.type === "gesture-end") setTimeout(hintCandidate, 0);
  });

  // a wrong word: the right one glows in the candidate bar, when it is there
  function hintCandidate() {
    document.querySelectorAll(".funny-hint").forEach((el) => el.classList.remove("funny-hint"));
    if (!S.frozen || body.dataset.screen !== "trial") return;
    const want = S.target[S.prev.length - 1];
    const seg = want && [...document.querySelectorAll("#candidate-strip .candidate-seg")].find((el) => el.textContent.trim() === want);
    if (seg) seg.classList.add("funny-hint");
  }

  const haptic = (pattern) => sendMessage({ type: "study-haptic", pattern });

  // ---------------------------------------------------------------- combo engine

  const correctUpTo = (words, n) => words.slice(0, n).every((w, i) => w === S.target[i]);

  document.addEventListener("study:trial-start", (e) => {
    S.target = e.detail.target.split(" ");
    S.prev = [];
    S.hit = new Set();
    S.frozen = false;
    S.trial = { hits: 0, saves: 0, breaks: 0, decays: 0, max: S.combo, points: 0, bonus: 0 };
    S.endlessAt = e.detail.mode === "endless" ? e.detail.index : null;
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
    // long words hit harder: one step more of everything, and more points
    const big = word.length >= 9 ? 2 : word.length >= 7 ? 1.5 : 1;
    const tier = Math.min(4, tierOf(S.combo) + (big > 1 ? 1 : 0));
    // points: the multiplier by level, plus speed (words per minute for this word)
    const now = performance.now();
    const perMinute = 60000 / Math.max(1, now - S.lastHitAt);
    S.lastHitAt = now;
    const feverNow = !S.fever && S.combo >= FEVER_AT;
    if (feverNow) S.fever = true; // points double from this word on
    const points = Math.round((100 * multOf(S.combo) + Math.max(0, Math.min(100, Math.round((perMinute - 20) * 2)))) * (S.fever ? 2 : 1) * big);
    S.clock = windowFor(S.combo);
    S.trial.points += points;
    // everything the participant sees and hears lands on the grid: the next
    // eighth note of the track (the score is counted now; only the show waits)
    const combo = S.combo;
    const pathNow = path.slice();
    const p = cursorPoint();
    const land = () => {
      stampWord(word, tier);
      flashKeys(word);
      burstAlong(pathNow, tier);
      splash(p.x, p.y, tier, 1);
      ring(p.x, p.y, 40 + tier * 22, tier >= 3 ? RED : INK);
      floatPoints(p.x, p.y, big > 1 ? `+${points} · ${big === 2 ? "huge" : "long"} ×${big}` : `+${points}`, tier, big === 2);
      if (big > 1) ring(p.x, p.y, 120 + tier * 30, RED);
      addScore(points);
      shake(tier);
      punch(0.006 + tier * 0.003);
      paintTitle();
      paintCombo(true);
      setHotInk(tier);
      heat(tier);
      const pan = Math.max(-1, Math.min(1, (p.x / frameEl.clientWidth) * 2 - 1));
      sound.hit(combo, tier, pan);
      haptic([14 + tier * 7]);
      if (feverNow) enterFever();
      if (levelOf(combo) !== S.level && S.combo >= combo) {
        setLevel(levelOf(combo), true);
        ring(p.x, p.y, 220, RED);
      }
    };
    const wait = sound.quantize();
    if (wait) setTimeout(land, wait);
    else land();
  }

  function onSave(i, word) {
    S.frozen = false;
    hintCandidate();
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
    setTimeout(hintCandidate, 0);
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
    body.classList.remove("is-breakdown");
    heat(0);
    sound.crash();
    sound.stop(true); // tape stop
    setLevel(0, false);
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
    // the finisher (on the grid too): the phrase ripples, a line sweeps, big ink
    setTimeout(finisher, sound.quantize() + 60);
  });

  function finisher() {
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
  }

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
      body.classList.remove("is-breakdown");
      heat(0);
      if (S.fever) exitFever(true);
      setLevel(0, false);
      sound.stop();
    }
    scoreEl.hidden = screen === "setup" || !screen;
    if (screen === "summary" || screen === "gameover") stampGrade();
    else gradeEl.hidden = true;
    if (screen === "end" || screen === "gameover") {
      const mode = screen === "gameover" ? "endless" : "blocks";
      sendMessage({ type: "study-leaderboard", mode, period: "day" });
      sendMessage({ type: "study-leaderboard", mode, period: "all" });
    }
    if (screen === "ready") {
      S.awaitBest = true; // the best run so far, to beat in this one
      sendMessage({ type: "study-leaderboard", mode: "endless", period: "all" });
    }
    if (screen === "trial" || screen === "feedback") wrapTitle();
    paintCombo();
  });

  // results: the phrase's points are saved with the trial (the leaderboard
  // adds them up); the perfect bonus is settled here, when the phrase is saved
  window.STUDY_HOOKS = {
    clientExtra: (r) => {
      if (r.status === "redo" || r.status === "stopped") {
        // a redone or stopped attempt scores nothing
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
    // no login step: the start screen opens the player by itself
    setup: (info) => {
      info.kicker.textContent = "Game";
      const failed = info.error && autoTried === "guest";
      info.title.textContent = failed ? "Could not start" : "Getting ready…";
      info.sub.textContent = !info.supported ? "Connecting to the server…" : failed ? "Reload the page to try again." : "";
      setTimeout(autoOpen, 0);
    },
    summaryExtra: () => [[fmt(S.block.points), "points"], [`×${S.blockBest}`, "best combo"]]
  };

  // endless: a run over - a new personal best is celebrated; every phrase
  // done is the big finish
  document.addEventListener("study:run-over", (e) => {
    const record = S.block.points > S.bestBefore && S.block.points > 0;
    if (record) {
      setTimeout(() => {
        const hero = $("study-sheet").querySelector(".result-hero");
        const note = document.createElement("em");
        note.className = "funny-record";
        note.textContent = S.bestBefore ? `New best · was ${fmt(S.bestBefore)}` : "First run";
        if (hero) hero.append(note);
      }, 0);
      shout("New best!", 12);
    }
    if (e.detail.reason !== "complete" && !record) return;
    inkFlash(4);
    speedLines(4);
    sound.grade("S");
    haptic([60, 40, 60, 40, 60, 40, 240]);
  });

  // endless: every 50 phrases, a milestone and a life back
  document.addEventListener("study:milestone", (e) => {
    shout(`${e.detail.phrases}!`, 12);
    inkFlash(3);
    speedLines(4);
    sound.milestone();
    haptic([40, 40, 40, 40, 120]);
    const box = decodedEl.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    floatPoints(box.left - f.left + box.width / 2, box.top - f.top, "+1 life", 4, true);
  });

  // endless: a life lost - red flash, a heavy thud, a long buzz
  document.addEventListener("study:life-lost", () => {
    inkFlash(4);
    punch(0.03);
    shake(4);
    sound.crash();
    haptic([220]);
  });

  // resume: the session's points so far
  document.addEventListener("study:session", (e) => {
    S.score = (e.detail.session.results || []).reduce((a, r) => a + ((r.client && r.client.combo && r.client.combo.score) || 0), 0);
    S.shown = S.score;
    paintScore();
  });

  // ---------------------------------------------------------------- players

  // No login step. The last player on this computer comes back by the token
  // the server gave; a first visit plays under a made-up name (swift-fox-42).
  // The Ready screen offers "change name": a free name renames the player (the
  // runs follow), a taken one is that player.
  const remember = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) { /* storage off */ } }
  };
  let autoTried = null; // how this page last opened a player on its own: "token" | "guest"

  function autoOpen() {
    if (body.dataset.screen !== "setup" || !window.STUDY_API.ready) return;
    const failed = !!$("study-status").textContent;
    if (failed && autoTried === "token") {
      remember.set("funnyToken", null); // a token the server no longer knows: start as a guest
      remember.set("funnyName", null);
    } else if (autoTried) {
      return;
    }
    const token = remember.get("funnyToken");
    autoTried = token ? "token" : "guest";
    window.STUDY_API.open({ account: token ? { action: "token", token } : { action: "guest" } });
  }

  document.addEventListener("study:account", (e) => {
    remember.set("funnyToken", e.detail.token);
    remember.set("funnyName", e.detail.username);
    nameEl.querySelector(".funny-name-now").textContent = e.detail.username;
    nameForm.hidden = true;
    setTimeout(() => window.STUDY_API.refresh(), 0); // the header shows the new name
  });

  // the name, top left on the Ready screen, with a way to change it
  const nameEl = document.createElement("div");
  nameEl.className = "funny-name";
  nameEl.hidden = true;
  nameEl.innerHTML = `<span class="funny-name-now"></span> <a href="#" class="funny-name-change">change name</a>
    <form class="funny-name-form" hidden><input name="name" maxlength="16" placeholder="New name" autocomplete="username" spellcheck="false"><button type="submit">OK</button></form>`;
  $("study-info-detail").parentElement.appendChild(nameEl);
  const nameForm = nameEl.querySelector("form");
  nameEl.querySelector(".funny-name-change").addEventListener("click", (e) => {
    e.preventDefault();
    nameForm.hidden = !nameForm.hidden;
    if (!nameForm.hidden) nameForm.querySelector("input").focus();
  });
  nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = nameForm.querySelector("input").value.trim();
    if (!username || !window.STUDY_API.ready) return;
    window.STUDY_API.open({ account: { action: "rename", token: remember.get("funnyToken"), username } });
  });
  new MutationObserver(() => {
    nameEl.hidden = body.dataset.screen !== "ready";
    if (nameEl.hidden) nameForm.hidden = true;
    nameEl.querySelector(".funny-name-now").textContent = remember.get("funnyName") || "";
  }).observe(body, { attributes: true, attributeFilter: ["data-screen"] });

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
    if (m.type !== "study-update" || !m.leaderboard) return;
    const b = m.leaderboard;
    if (S.awaitBest && body.dataset.screen === "ready" && b.mode === "endless" && b.period === "all") {
      S.awaitBest = false;
      S.bestBefore = b.me ? b.me.score : 0;
      return;
    }
    if (!["end", "gameover"].includes(body.dataset.screen)) return;
    // one board, today's top five (own row last when outside it); all time is one line
    const sheet = $("study-sheet");
    let boards = sheet.querySelector(".funny-boards");
    if (!boards) {
      boards = document.createElement("div");
      boards.className = "funny-boards";
      boards.innerHTML = '<div data-period="day"></div><p class="funny-alltime" data-period="all"></p>';
      sheet.appendChild(boards);
    }
    if (b.period === "all") {
      boards.querySelector('[data-period="all"]').textContent = b.me
        ? `All time · #${b.me.rank} of ${b.total} · your best ${fmt(b.me.score)}`
        : `All time · ${b.total} player${b.total === 1 ? "" : "s"} · not on the board yet`;
    } else {
      const rows = b.top.slice(0, 5);
      if (b.me && !rows.some((r) => r.me)) rows.push(b.me);
      boards.querySelector('[data-period="day"]').innerHTML = `<div class="funny-board">
        <h3>${b.mode === "endless" ? "Today's best runs" : "Today"}${b.me ? ` <em>#${b.me.rank} of ${b.total}</em>` : ""}</h3>
        <ol>${rows.map((r) => `<li class="${r.me ? "is-me" : ""}"><span class="rank">${r.rank}</span><span class="pid">${esc(r.pid)}</span><b>${fmt(r.score)}</b></li>`).join("")}</ol></div>`;
    }
    if (b.period === "day" && b.me && b.me.rank <= 3) sound.grade("S");
  });

  // ---------------------------------------------------------------- fever

  function enterFever() {
    S.fever = true;
    body.classList.add("is-fever");
    animate(); // the motes need the loop
    shout("Fever ×2", 7);
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
    }
  }

  // ---------------------------------------------------------------- levels

  let rainbowHue = 0;

  // a level's look and music; up = reached by a hit (announced)
  function setLevel(lv, up) {
    if (lv === S.level && !up) return;
    const L = LEVELS[lv];
    S.level = lv;
    body.dataset.level = lv;
    for (let k = 1; k <= 4; k++) body.classList.toggle(`lv-${k * 4}`, lv >= k * 4); // lv-4, lv-8, lv-12, lv-16
    if (L.accent !== "rainbow") {
      RED = L.accent;
      body.style.setProperty("--fx-accent", L.accent);
      body.style.setProperty("--fx-light", L.light);
    }
    lightsEl.dataset.lights = L.lights.join(" ");
    bgEl.dataset.bg = L.bg;
    setHotInk(tierOf(S.combo));
    sound.level({ layers: L.layers, progs: L.progs, key: L.key, voice: L.voice, padCut: L.padCut, fever: lv >= FEVER_AT / 3, level: lv });
    if (up && lv > 0 && !L.fever) { // fever announces itself
      shout(L.name, lv);
      if (lv % 3 === 0) speedLines(tierOf(S.combo));
      sound.levelUp(lv);
      haptic([25, 30, 25, 30, 60]);
    }
    if (L.lights.includes("rainbow")) requestAnimationFrame(cycleRainbow);
    paintCombo(); // the label shows the level
  }

  // the rainbow levels cycle the accent (and the canvas colours with it)
  function cycleRainbow() {
    if (!LEVELS[S.level].lights.includes("rainbow")) return;
    rainbowHue = (rainbowHue + (LEVELS[S.level].lights.includes("fast") ? 2.4 : 1.2)) % 360;
    RED = `hsl(${rainbowHue}, 78%, 56%)`;
    body.style.setProperty("--fx-accent", RED);
    const h = rainbowHue / 60;
    const x = 1 - Math.abs((h % 2) - 1);
    const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h) % 6];
    body.style.setProperty("--fx-light", `${Math.round(r * 230)},${Math.round(g * 230)},${Math.round(b * 230)}`);
    requestAnimationFrame(cycleRainbow);
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
    setLevel(levelOf(S.combo), false);
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
    comboEl.querySelector("span").textContent = S.level ? `combo · lv ${S.level}` : "combo";
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

  function shout(text, level) {
    placeCombo();
    shoutEl.style.top = comboEl.style.top;
    shoutEl.textContent = text;
    shoutEl.dataset.tier = Math.min(4, Math.floor(level / 3));
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
    if (S.level >= 3) {
      body.style.setProperty("--trace-color", RED.startsWith("hsl") ? "#d6452b" : RED);
      body.style.setProperty("--trace-width", String(4 + tier * 0.8));
    } else {
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

  // ---------------------------------------------------------------- effects and sound (funny-fx.js, funny-audio.js)

  const { splash, burstAlong, ring, speedLines, spawnMote, animate, lasers, punch, heat, inkFlash, lightsEl, bgEl, stageEl } =
    window.FunnyFX.bind({
      accent: () => RED,
      tier: () => tierOf(S.combo),
      fever: () => S.fever,
      cursor: () => cursorPoint(),
      onResize: () => placeCombo()
    });
  const sound = window.FunnyAudio;

  // Start / Next / Stop have no bar behind them: while the cursor is on one,
  // the word throws sparks (game.css makes it grow)
  const sparkTargets = ["action-next", "action-clear"].map((id) => $(id)).filter(Boolean);
  let sparkOn = null;
  let sparkTimer = null;
  function sparkFrom(el, burst) {
    const r = el.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    const spread = Math.min(r.width, 160);
    splash(r.left - f.left + r.width / 2 + (Math.random() - 0.5) * spread,
      r.top - f.top + r.height / 2, burst ? 3 : 2, burst ? 1.1 : 0.35);
  }
  function watchSparks() {
    const on = sparkTargets.find((el) => el.classList.contains("is-hover") && el.offsetParent) || null;
    if (on === sparkOn) return;
    sparkOn = on;
    clearInterval(sparkTimer);
    sparkTimer = null;
    if (!on) return;
    sparkFrom(on, true);
    sparkTimer = setInterval(() => sparkFrom(on, false), 90);
  }
  const sparkWatch = new MutationObserver(watchSparks);
  sparkTargets.forEach((el) => sparkWatch.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] }));

  // fever breakdowns: the lights calm down; the drop hits
  sound.onSection = ({ breakdown, drop }) => {
    if (!["trial", "feedback"].includes(body.dataset.screen)) return;
    body.classList.toggle("is-breakdown", breakdown);
    if (breakdown) shout("Breakdown", 7);
    if (drop) {
      shout("Drop!", 12);
      inkFlash(4);
      speedLines(4);
      punch(0.03);
      haptic([30, 30, 30, 30, 120]);
    }
  };

  // the track's kick drives the picture: the combo nods on every beat, and in
  // fever the edges flare, the keys' lines flash red and motes kick up
  sound.onBeat = (pos, bar) => {
    if (!sound.playing || !["trial", "feedback"].includes(body.dataset.screen)) return;
    restartClass(comboEl, "on-beat");
    if (reduced) return;
    const L = LEVELS[S.level].lights;
    if (L.includes("pulse") || L.includes("strobe")) restartClass(lightsEl, "on-beat");
    if (L.includes("strobe")) restartClass(stageEl, "on-beat");
    if (L.includes("lasers") && (bar + pos / 4) % 2 < 1) lasers();
    if (S.fever) {
      keyboardEl.classList.add("beat-flash");
      setTimeout(() => keyboardEl.classList.remove("beat-flash"), 110);
      for (let i = 0; i < 5; i++) spawnMote(true);
    }
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
  // study.js drew its own start screen before this file loaded
  window.STUDY_API.refresh();
})();
