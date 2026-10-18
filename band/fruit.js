// /band/fruit.html: slice fruit with the Neural Band, drawn in the Editorial style:
// ink line work on paper, the Game red for the blade and the melon's flesh.
//
// The forearm's direction is the blade (relative, like a mouse: it stops at the
// board's edges). A swing faster than SLICE_DPS through a fruit cuts it; a slower
// pass only touches. An index pinch starts a round; a middle-finger pinch brings
// the blade back to the middle. The mouse plays too (right button: the middle).
//
// The band's raw events come from a band room on the server (band_relay.py), as on
// /band/raw.html. ?ws=ws://localhost:8790 points it at another server.
(() => {
  const BAND_URL = new URLSearchParams(location.search).get("ws") || window.GESTURE_CONFIG.backendWsUrl;
  const SLICE_DPS = 100;  // deg/s of forearm turn
  const TRAIL_MS = 160;
  const LIVES = 3;
  const INK = "#111111", PAPER = "#faf8f3";
  const RED = getComputedStyle(document.documentElement).getPropertyValue("--accent-main").trim() || "#d6452b";
  const KINDS = ["melon", "orange", "apple", "lemon", "plum"];
  const SIZE = { melon: 52, orange: 40, apple: 40, lemon: 36, plum: 30, bomb: 36 };

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const canvas = $("board"), ctx = canvas.getContext("2d");
  const kickerEl = $("kicker"), titleEl = $("title"), subEl = $("sub"), statusEl = $("status"), startBtn = $("start");
  const detailEl = $("detail"), codeEl = $("band-code"), bandStatusEl = $("band-status"), badge = $("band-badge");
  const reach = $("reach");

  let W = 0, H = 0, scale = 1;
  function resize() {
    const ratio = devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * ratio; canvas.height = H * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    scale = Math.min(W, H) / 820;
  }
  addEventListener("resize", resize);
  resize();

  const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } } };
  let span = Number(store.get("band-fruit-span", 50));
  let best = Number(store.get("band-fruit-best", 0));
  function syncReach() {
    reach.querySelectorAll("button").forEach((b) => {
      const on = Number(b.dataset.value) === span;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  reach.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    e.stopPropagation();
    span = Number(b.dataset.value);
    store.set("band-fruit-span", span);
    syncReach();
  });
  syncReach();

  const heart = (full) => `<svg viewBox="0 0 24 24" fill="${full ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
  function renderDetail() {
    const hearts = state === "play"
      ? `<span class="band-lives" aria-label="${lives} lives">${Array.from({ length: LIVES }, (_, i) => heart(i < lives)).join("")}</span>` : "";
    detailEl.innerHTML = `Best ${best}${hearts}`;
  }

  // ---- sound: a short filtered noise for a cut (after a click or a key unlocks audio) ----
  let audio = null;
  const unlock = () => { if (!audio) { try { audio = new AudioContext(); } catch (e) { audio = null; } } };
  addEventListener("pointerdown", unlock); addEventListener("keydown", unlock);
  function burst(freq, ms, gain) {
    if (!audio || audio.state !== "running") return;
    const n = Math.floor(audio.sampleRate * ms / 1000);
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 0.9;
    const g = audio.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(audio.destination); src.start();
  }

  // ---- blade ----
  const blade = { x: 0, y: 0, trail: [] }; // trail: {x, y, at (ms), fast}
  let lastAim = null, lastAimT = null, maxSpeed = 0;
  function centreBlade() { blade.x = W / 2; blade.y = H * 0.72; blade.trail = []; lastAim = null; }
  centreBlade();

  function moveBlade(dx, dy, dps) {
    blade.x = Math.max(0, Math.min(W, blade.x + dx));
    blade.y = Math.max(0, Math.min(H, blade.y + dy));
    const fast = dps >= SLICE_DPS;
    if (state === "play") maxSpeed = Math.max(maxSpeed, dps);
    blade.trail.push({ x: blade.x, y: blade.y, at: performance.now(), fast });
  }

  let handSign = 1;
  function aimOf(v) {
    // [w, x, y, z]; the forearm is the band's +y in the world frame; azimuth grows to the left
    const [w, x, y, z] = v;
    const fx = 2 * (x * y - w * z) * handSign, fy = (1 - 2 * (x * x + z * z)) * handSign, fz = 2 * (y * z + w * x) * handSign;
    return { right: -Math.atan2(fy, fx) * 180 / Math.PI, up: Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI };
  }

  function onBandEvent(e) {
    const t = e.t / 1e6;
    if (e.event === "quat" && Array.isArray(e.v)) {
      if (e.late) { lastAim = null; return; } // where the arm was, not where it is
      const aim = aimOf(e.v);
      if (lastAim && t > lastAimT) {
        let dR = aim.right - lastAim.right;
        if (dR > 180) dR -= 360;
        if (dR < -180) dR += 360;
        const dU = aim.up - lastAim.up;
        const pxPerDeg = W / span;
        moveBlade(dR * pxPerDeg, -dU * pxPerDeg, Math.hypot(dR, dU) / (t - lastAimT));
      }
      lastAim = aim; lastAimT = t;
    } else if (e.event === "gesture" && e.action === "press" && !e.late) {
      if (e.finger === "index") pinch();
      else if (e.finger === "middle") centreBlade();
    }
  }

  let mouseLast = null;
  addEventListener("mousemove", (e) => {
    const now = performance.now();
    if (mouseLast) {
      const dt = Math.max(1, now - mouseLast.at) / 1000;
      blade.x = mouseLast.x; blade.y = mouseLast.y;
      const deg = Math.hypot(e.clientX - mouseLast.x, e.clientY - mouseLast.y) / (W / span);
      moveBlade(e.clientX - blade.x, e.clientY - blade.y, deg / dt);
    } else { blade.x = e.clientX; blade.y = e.clientY; }
    mouseLast = { x: e.clientX, y: e.clientY, at: now };
  });
  startBtn.addEventListener("click", (e) => { e.stopPropagation(); start(); });

  // ---- band room ----
  let bandSocket = null;
  function setBand(code, status, paired) {
    if (code !== undefined) codeEl.textContent = code;
    bandStatusEl.textContent = status;
    badge.classList.toggle("is-paired", paired);
  }
  function connectBand() {
    const ws = new WebSocket(BAND_URL);
    bandSocket = ws;
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", role: "display", kind: "band" })));
    ws.addEventListener("message", (event) => {
      if (ws !== bandSocket) return;
      let m;
      try { m = JSON.parse(event.data); } catch (e) { return; }
      if (m.type === "room-created") setBand(m.code, "waiting for band…", false);
      else if (m.type === "band-joined") { handSign = m.deviceInfo?.hand === "left" ? -1 : 1; lastAim = null; setBand(undefined, "band live", true); }
      else if (m.type === "band-left") setBand(undefined, "waiting for band…", false);
      else if (m.type === "band-status") {
        if (m.hand) handSign = m.hand === "left" ? -1 : 1;
        setBand(undefined, m.connected === false ? "band not connected" : "band live", m.connected !== false);
      } else if (m.type === "band-batch") for (const e of m.events || []) onBandEvent(e);
    });
    ws.addEventListener("close", () => {
      if (ws !== bandSocket) return;
      setBand("····", "reconnecting…", false);
      setTimeout(connectBand, 1500);
    });
  }
  connectBand();

  // ---- the round ----
  let state = "menu"; // menu | play | over
  let fruits = [], pieces = [], drops = [], popups = [];
  let score = 0, lives = LIVES, sliced = 0, missed = 0, startedAt = 0, nextWave = 0, dark = 0;
  let comboCount = 0, comboAt = 0;

  function prompt(kicker, title, sub, button, status) {
    kickerEl.textContent = kicker; titleEl.textContent = title; subEl.textContent = sub;
    startBtn.textContent = button; startBtn.hidden = !button; statusEl.textContent = status;
  }

  // the index finger starts a round; during one it does nothing
  function pinch() { if (state !== "play") start(); }
  addEventListener("mousedown", (e) => { if (e.button === 2) centreBlade(); });
  addEventListener("contextmenu", (e) => e.preventDefault());

  function start() {
    state = "play";
    body.classList.add("is-playing");
    fruits = []; pieces = []; drops = []; popups = [];
    score = 0; lives = LIVES; sliced = 0; missed = 0; maxSpeed = 0;
    startedAt = performance.now(); nextWave = startedAt + 800;
    prompt("Score", "0", "", "", "");
    centreBlade();
    renderDetail();
  }

  function end(reason) {
    state = "over";
    body.classList.remove("is-playing");
    if (score > best) { best = score; store.set("band-fruit-best", best); }
    const total = sliced + missed;
    const parts = [`${sliced} sliced`, `${missed} missed`];
    if (total) parts.push(`${Math.round(sliced / total * 100)}% hit`);
    parts.push(`fastest swing ${Math.round(maxSpeed)}°/s`);
    prompt(reason === "bomb" ? "Bomb" : "Game over", String(score), parts.join(" · "), "Play again", "or pinch to play again");
    renderDetail();
  }

  function spawnWave(now) {
    const elapsed = (now - startedAt) / 1000;
    const count = 1 + Math.floor(Math.random() * Math.min(4, 1 + elapsed / 15));
    const g = 900 * scale;
    for (let i = 0; i < count; i++) {
      const bomb = elapsed > 12 && Math.random() < Math.min(0.22, 0.08 + elapsed / 400);
      const kind = bomb ? "bomb" : KINDS[Math.floor(Math.random() * KINDS.length)];
      const r = SIZE[kind] * scale;
      const x = W * (0.15 + Math.random() * 0.7);
      const peak = H * (0.3 + Math.random() * 0.3); // below the prompt
      const vy = -Math.sqrt(2 * g * (H + r - peak));
      const vx = (W / 2 - x) / 1.6 * (0.4 + Math.random() * 0.8);
      fruits.push({ kind, bomb, x, y: H + r, vx, vy, g, r, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 3, born: now + i * 140 });
    }
    nextWave = now + Math.max(650, 2000 - elapsed * 25) * (0.75 + Math.random() * 0.5);
  }

  function segmentDistance(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(ax + u * dx - px, ay + u * dy - py);
  }

  function slice(f, a, b, now) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (f.bomb) {
      dark = 0.9;
      burst(140, 600, 0.5);
      for (let i = 0; i < 40; i++) drops.push(drop(f.x, f.y, i % 3 ? INK : RED, 700 * scale));
      end("bomb");
      return;
    }
    burst(1100, 130, 0.22);
    sliced += 1;
    score += 1;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    for (const side of [-1, 1]) {
      pieces.push({ ...f, side, angle, x: f.x + nx * side * 3, y: f.y + ny * side * 3,
                    vx: f.vx + nx * side * 150 * scale, vy: f.vy * 0.4 + ny * side * 150 * scale - 60 * scale,
                    spin: side * 1.2, life: 1 });
    }
    for (let i = 0; i < 12; i++) drops.push(drop(f.x, f.y, f.kind === "melon" ? RED : INK, 360 * scale));
    comboCount = now - comboAt < 260 ? comboCount + 1 : 1;
    comboAt = now;
    if (comboCount >= 3) {
      score += 1;
      popups.push({ text: comboCount === 3 ? "Triple" : `${comboCount} in a row`, x: f.x, y: f.y - f.r * 1.4, life: 1 });
    }
    titleEl.textContent = String(score);
  }

  function drop(x, y, color, speed) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, life: 1, size: (1.4 + Math.random() * 2.6) * scale };
  }

  // ---- drawing: ink line work on paper ----
  function ink(width = 1.6) { ctx.strokeStyle = INK; ctx.lineWidth = width * Math.max(0.8, scale); ctx.lineCap = "round"; ctx.lineJoin = "round"; }

  function outline(kind, r) {
    ctx.beginPath();
    if (kind === "apple") {
      ctx.moveTo(0, -r * 0.62);
      ctx.bezierCurveTo(r * 0.55, -r * 1.05, r * 1.15, -r * 0.45, r * 0.9, r * 0.25);
      ctx.bezierCurveTo(r * 0.7, r * 0.95, r * 0.25, r * 1.0, 0, r * 0.82);
      ctx.bezierCurveTo(-r * 0.25, r * 1.0, -r * 0.7, r * 0.95, -r * 0.9, r * 0.25);
      ctx.bezierCurveTo(-r * 1.15, -r * 0.45, -r * 0.55, -r * 1.05, 0, -r * 0.62);
    } else if (kind === "lemon") {
      ctx.ellipse(0, 0, r * 1.05, r * 0.74, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
  }

  function drawWhole(f) {
    const { kind, r } = f;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    if (kind === "bomb") {
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ink(2); ctx.beginPath(); ctx.moveTo(r * 0.45, -r * 0.8); ctx.quadraticCurveTo(r * 0.9, -r * 1.5, r * 1.35, -r * 1.2); ctx.stroke();
      ctx.fillStyle = (performance.now() / 120) % 2 < 1 ? RED : PAPER;
      ctx.beginPath(); ctx.arc(r * 1.38, -r * 1.22, 3.2 * scale + 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = PAPER;
    outline(kind, r); ctx.fill();
    ink(); outline(kind, r); ctx.stroke();
    ctx.save(); outline(kind, r); ctx.clip();
    ink(1.1);
    if (kind === "melon") {
      for (const k of [-0.62, -0.2, 0.22, 0.64]) {
        ctx.beginPath(); ctx.moveTo(k * r, -r); ctx.bezierCurveTo(k * r + r * 0.28, -r * 0.3, k * r - r * 0.28, r * 0.3, k * r, r); ctx.stroke();
      }
    } else if (kind === "orange") {
      ctx.fillStyle = INK;
      for (let i = 0; i < 14; i++) {
        const a = i * 2.39996, d = r * (0.25 + (i % 5) * 0.14);
        ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 0.9 * scale + 0.3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === "plum") {
      ctx.beginPath(); ctx.moveTo(-r * 0.1, -r); ctx.bezierCurveTo(r * 0.35, -r * 0.3, r * 0.35, r * 0.3, -r * 0.1, r); ctx.stroke();
    } else if (kind === "lemon") {
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 0.5, 0, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke();
    }
    ctx.restore();
    // stem and leaf
    if (kind === "apple" || kind === "orange" || kind === "plum") {
      const top = kind === "apple" ? -r * 0.62 : -r;
      ink(1.6);
      ctx.beginPath(); ctx.moveTo(0, top); ctx.quadraticCurveTo(r * 0.05, top - r * 0.25, r * 0.12, top - r * 0.38); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(r * 0.32, top - r * 0.24, r * 0.22, r * 0.09, -0.5, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === "lemon") {
      ink(1.6);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * 1.05, 0); ctx.lineTo(s * r * 1.2, 0); ctx.stroke(); }
    }
    ctx.restore();
  }

  // a half, seen from its cut face: rim, flesh, and a few marks
  function drawHalf(p) {
    const { kind, r } = p;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + p.rot * 0.3);
    ctx.beginPath();
    ctx.rect(-r * 1.6, p.side < 0 ? -r * 1.6 : 0, r * 3.2, r * 1.6);
    ctx.clip();
    ctx.fillStyle = PAPER;
    outline(kind, r); ctx.fill();
    if (kind === "melon") {
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK;
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + 0.3, d = r * (0.35 + (i % 3) * 0.15);
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, 1.6 * scale + 0.6, 3 * scale + 0.8, a, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === "orange" || kind === "lemon") {
      ink(1.1);
      const rx = kind === "lemon" ? r * 0.88 : r * 0.82, ry = kind === "lemon" ? r * 0.6 : r * 0.82;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * rx * 0.95, Math.sin(a) * ry * 0.95); ctx.stroke();
      }
    } else if (kind === "apple") {
      ink(1.1);
      ctx.beginPath(); ctx.ellipse(0, r * 0.1, r * 0.28, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = INK;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * 0.09, r * 0.08, 1.4 * scale + 0.5, 2.8 * scale + 0.7, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === "plum") {
      ink(1.1);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.3, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ink(); outline(kind, r); ctx.stroke();
    // the cut itself, inside the skin
    ctx.save(); outline(kind, r); ctx.clip();
    ink(1.4);
    ctx.beginPath(); ctx.moveTo(-r * 1.2, 0); ctx.lineTo(r * 1.2, 0); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawBlade(now) {
    blade.trail = blade.trail.filter((p) => now - p.at <= TRAIL_MS);
    const pts = blade.trail;
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const k = Math.max(0, Math.min(1, 1 - (now - b.at) / TRAIL_MS));
      ctx.strokeStyle = b.fast ? RED : INK;
      ctx.globalAlpha = b.fast ? k : 0.25 * k;
      ctx.lineWidth = (b.fast ? 4 : 1.5) * k * Math.max(0.8, scale) + 0.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = RED;
    ctx.beginPath(); ctx.arc(blade.x, blade.y, 4 * Math.max(0.8, scale), 0, Math.PI * 2); ctx.fill();
  }

  // ---- frame ----
  let last = performance.now();
  function frame() {
    // one clock for the frame and the blade's samples (rAF's stamp can precede them)
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);

    if (state === "play") {
      if (now >= nextWave) spawnWave(now);
      const fresh = blade.trail.filter((p) => now - p.at <= 50);
      for (let i = 1; i < fresh.length && state === "play"; i++) {
        const a = fresh[i - 1], b = fresh[i];
        if (!b.fast) continue;
        for (const f of fruits) {
          if (f.cut || now < f.born) continue;
          if (segmentDistance(a.x, a.y, b.x, b.y, f.x, f.y) <= f.r) {
            f.cut = true;
            slice(f, a, b, now);
            if (state !== "play") break;
          }
        }
      }
      fruits = fruits.filter((f) => !f.cut);
    }

    for (const f of fruits) {
      if (now < f.born) continue;
      f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.spin * dt;
      drawWhole(f);
      if (state === "play" && f.vy > 0 && f.y - f.r > H && !f.gone) {
        f.gone = true;
        if (!f.bomb) {
          missed += 1; lives -= 1; renderDetail();
          if (lives <= 0) end("missed");
        }
      }
    }
    fruits = fruits.filter((f) => !f.gone && f.y - f.r <= H + 40);

    for (const p of pieces) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt; p.life -= dt * 0.55;
      drawHalf(p);
    }
    pieces = pieces.filter((p) => p.life > 0 && p.y - p.r < H + 200);

    for (const d of drops) {
      d.vy += 900 * scale * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt * 1.5;
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drops = drops.filter((d) => d.life > 0);

    for (const p of popups) {
      p.life -= dt * 0.9; p.y -= 30 * dt;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = RED;
      ctx.font = `italic ${Math.round(26 * scale + 8)}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    popups = popups.filter((p) => p.life > 0);

    drawBlade(now);

    if (dark > 0) {
      ctx.fillStyle = `rgba(17, 17, 17, ${dark})`;
      ctx.fillRect(0, 0, W, H);
      dark = Math.max(0, dark - dt * 1.8);
    }
    requestAnimationFrame(frame);
  }

  renderDetail();
  requestAnimationFrame(frame);
})();
