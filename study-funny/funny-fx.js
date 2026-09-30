/* The funny layer's effects (/study-funny): the ink canvas (drops, shockwave
   rings, speed lines, lasers, fever motes), the lights and background behind
   the page, and the frame effects (punch, heat, flash). funny.js binds the
   state it depends on (accent, intensity, fever, cursor) and takes the
   functions from window.FunnyFX.bind(). */
window.FunnyFX = {
  bind(ctxOf) {
    const $ = (id) => document.getElementById(id);
    const frameEl = document.querySelector(".display-frame");
    const ink = $("funny-ink");
    const ctx = ink.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const INK = "#111111";
    const restartClass = (el, cls) => {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    };

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
    addEventListener("resize", () => { sizeInk(); ctxOf.onResize(); });
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
        color: Math.random() < redShare ? ctxOf.accent() : INK
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
                     width: 1 + Math.random() * (2 + tier), life: 1, color: Math.random() < 0.25 + tier * 0.12 ? ctxOf.accent() : INK });
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
      const tier = ctxOf.tier();
      motes.push({
        x, y, vy: -(0.5 + Math.random() * (burst ? 2.6 : 1.2)), phase: Math.random() * 6.3,
        sway: 0.3 + Math.random() * 0.9, r: 0.8 + Math.random() * (1.6 + tier * 0.4),
        life: 1, decay: 0.004 + Math.random() * 0.008,
        color: Math.random() < 0.35 + (tier >= 4 ? 0.2 : 0) ? ctxOf.accent() : INK
      });
    }

    function step() {
      ctx.clearRect(0, 0, ink.width, ink.height);
      if (ctxOf.fever() && !reduced && motes.length < 140) {
        const rate = ctxOf.tier() >= 4 ? 1.6 : 0.8;
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
      if (drops.length || waves.length || lines.length || motes.length || ctxOf.fever()) requestAnimationFrame(step);
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

    // behind everything: the level's background pattern, and its lights
    const bgEl = document.createElement("div");
    bgEl.className = "funny-bg";
    bgEl.setAttribute("aria-hidden", "true");
    const lightsEl = document.createElement("div");
    lightsEl.className = "funny-lights";
    lightsEl.setAttribute("aria-hidden", "true");
    lightsEl.innerHTML = '<i class="beam is-left"></i><i class="beam is-right"></i><i class="spot"></i>';
    frameEl.prepend(bgEl, lightsEl);

    // the spot follows the cursor
    setInterval(() => {
      if (!lightsEl.dataset.lights || !lightsEl.dataset.lights.includes("spot")) return;
      const p = ctxOf.cursor();
      lightsEl.style.setProperty("--spot-x", `${p.x}px`);
      lightsEl.style.setProperty("--spot-y", `${p.y}px`);
    }, 50);

    // lasers: thin lines across the page from an edge, for a beat
    function lasers() {
      if (reduced) return;
      const w = frameEl.clientWidth;
      const h = frameEl.clientHeight;
      for (let i = 0; i < 3; i++) {
        const fromLeft = Math.random() < 0.5;
        lines.push({ x0: fromLeft ? 0 : w, y0: h * (0.2 + Math.random() * 0.7), x1: fromLeft ? w : 0, y1: h * Math.random(),
                     width: 1.2, life: 1, color: ctxOf.accent(), laser: true });
      }
      animate();
    }

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


    return { splash, burstAlong, ring, speedLines, spawnMote, animate, lasers, punch, heat, inkFlash, lightsEl, bgEl, stageEl };
  }
};
