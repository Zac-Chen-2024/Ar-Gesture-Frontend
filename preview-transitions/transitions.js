/* Page transitions (preview, five schemes to choose from). Restrained: the
   page you leave is covered with paper, the page you arrive on starts as
   paper and comes through; only thin lines in the mode's colour (Demo green,
   Game red) and a few leaves / sparks mark the way. The leaving half ends on
   a picture the arriving half starts from (rebuilt from the same seed). */
(() => {
  const KEY = "ar-tx";
  const LAST = "ar-tx-last";
  const SPEED = "ar-tx-speed";
  const SCHEME = "ar-tx-scheme";
  const SCALE = 4; // ragged masks are worked out on a grid this many px wide
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PAPER = "#faf8f3";
  const PAPER_RGB = [250, 248, 243];
  const INK = { vine: "#25915f", fire: "#d6452b" };
  const LEAVES = ["#25915f", "#1c6f49"];
  const slow = () => Number(sessionStorage.getItem(SPEED)) || 1;
  const chosen = () => sessionStorage.getItem(SCHEME) || "A";

  // ---- seeded randomness and value noise
  function rng(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function fbm(w, h, cell, seed, octaves = 4) {
    const out = new Float32Array(w * h);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const c = Math.max(1.5, cell / (1 << o));
      const gw = Math.ceil(w / c) + 2, gh = Math.ceil(h / c) + 2;
      const r = rng(seed * 31 + o * 977);
      const g = new Float32Array(gw * gh);
      for (let i = 0; i < g.length; i++) g[i] = r();
      for (let y = 0; y < h; y++) {
        const fy = y / c, iy = fy | 0, ty = smooth(fy - iy);
        for (let x = 0; x < w; x++) {
          const fx = x / c, ix = fx | 0, tx = smooth(fx - ix), i = iy * gw + ix;
          const a = g[i] + (g[i + 1] - g[i]) * tx;
          const b = g[i + gw] + (g[i + gw + 1] - g[i + gw]) * tx;
          out[y * w + x] += (a + (b - a) * ty) * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  const farthest = (x, y, W, H) => Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
  // when each grid cell is reached: by distance from the origin, a gently ragged edge
  function front(w, h, ox, oy, seed) {
    const n = fbm(w, h, Math.max(w, h) / 4, seed);
    const far = farthest(ox, oy, w, h);
    const f = new Float32Array(w * h);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = 0.86 * Math.hypot(x - ox, y - oy) / far + 0.14 * (n[i] - 0.5) * 2.6;
        f[i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return { f, lo, hi };
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ease = {
    out: (p) => 1 - Math.pow(1 - p, 3),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  };

  // ---- canvases
  function canvas(W, H, dpr) {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    return { c, ctx };
  }
  function overlay(blocking) {
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    const o = canvas(W, H, dpr);
    o.c.className = "tx-overlay";
    o.c.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;pointer-events:${blocking ? "auto" : "none"}`;
    document.body.appendChild(o.c);
    return Object.assign(o, { W, H, dpr });
  }
  function grid(W, H) {
    const w = Math.ceil(W / SCALE), h = Math.ceil(H / SCALE);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    return { c, ctx, img: ctx.createImageData(w, h), w, h };
  }
  function blit(o, g, op) {
    g.ctx.putImageData(g.img, 0, 0);
    o.ctx.save();
    if (op) o.ctx.globalCompositeOperation = op;
    o.ctx.drawImage(g.c, 0, 0, o.W, o.H);
    o.ctx.restore();
  }
  function paper(o, alpha = 1) {
    o.ctx.globalAlpha = clamp01(alpha);
    o.ctx.fillStyle = PAPER;
    o.ctx.fillRect(0, 0, o.W, o.H);
    o.ctx.globalAlpha = 1;
  }
  function run(ms, frame) {
    return new Promise((done) => {
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - t0) / ms);
        frame(p);
        if (p < 1) requestAnimationFrame(tick);
        else done();
      })(t0);
    });
  }
  function ready() {
    return new Promise((done) => {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(done));
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
      else go();
    });
  }

  // ---- small things: leaves, sparks (the home page's quench colours)
  function leaf(ctx, x, y, a, size, colour, alpha = 1) {
    if (size <= 0.2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(size / 11, size / 11);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(2.5, -3.4, 7.5, -3.6, 11, 0);
    ctx.bezierCurveTo(7.5, 2.2, 2.5, 2.2, 0, 0);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();
  }
  function sparkColour(life) {
    if (life > 0.75) return "rgb(245, 178, 30)";
    if (life > 0.5) return "rgb(240, 120, 32)";
    if (life > 0.25) return "rgb(214, 69, 43)";
    return `rgba(140, 36, 20, ${life * 4})`;
  }
  function spark(list, x, y, { up = 0, spread = Math.PI, speed = 3.2 } = {}) {
    const a = -Math.PI / 2 + up + (Math.random() - 0.5) * spread, v = speed * (0.4 + Math.random());
    list.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.025 + Math.random() * 0.03 });
  }
  function falling(list, x, y) {
    list.push({ kind: "leaf", x, y, vx: (Math.random() - 0.5) * 1.6, vy: -0.6 * Math.random(), rot: Math.random() * 6.3,
      spin: (Math.random() - 0.5) * 0.12, s: 7 + Math.random() * 3, ph: Math.random() * 6, life: 1,
      decay: 0.016 + Math.random() * 0.014, colour: LEAVES[(Math.random() * 2) | 0] });
  }
  function particles(ctx, list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= p.decay;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.t = (p.t || 0) + 1;
      if (p.kind === "spark") {
        p.vy += 0.16; p.vx *= 0.985;
        p.x += p.vx; p.y += p.vy;
        ctx.strokeStyle = sparkColour(p.life);
        ctx.lineWidth = 1 + p.life * 1.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 2, p.y - p.vy * 2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        p.vy += 0.05; p.vx *= 0.99;
        p.x += p.vx + Math.sin(p.t * 0.07 + p.ph) * 0.6;
        p.y += p.vy;
        p.rot += p.spin;
        leaf(ctx, p.x, p.y, p.rot, p.s, p.colour, Math.min(1, p.life * 2));
      }
    }
  }
  function onScreen(o, x, y) { return x >= 0 && y >= 0 && x <= o.W && y <= o.H; }

  // ---- thin vines (scheme B): a few stems from the origin to the edges
  function vines(W, H, ox, oy, seed) {
    const r = rng(seed ^ 0x5bd1e995), segs = [], leaves = [], diag = Math.hypot(W, H);
    const inside = (x, y) => x > -30 && y > -30 && x < W + 30 && y < H + 30;
    function walk(x, y, h, s, depth, maxLen, w0) {
      const base = h, ph = r() * 6.28, fr = 0.01 + r() * 0.015, step = 5;
      const span = maxLen === Infinity ? diag : maxLen;
      let len = 0, side = r() < 0.5 ? 1 : -1, nextLeaf = 26 + r() * 20;
      while (len < maxLen && inside(x, y)) {
        h += (r() - 0.5) * 0.16 + Math.sin(len * fr + ph) * 0.035;
        h += (base - h) * 0.03;
        const nx = x + Math.cos(h) * step, ny = y + Math.sin(h) * step;
        segs.push({ x0: x, y0: y, x1: nx, y1: ny, s: s + len, w: Math.max(1, w0 * (1 - len / span)) });
        if (len >= nextLeaf) {
          side = -side;
          leaves.push({ x: nx, y: ny, a: h + side * (0.8 + r() * 0.4), size: 7 + r() * 3, s: s + len, c: LEAVES[(r() * 2) | 0] });
          nextLeaf = len + 34 + r() * 30;
        }
        if (!depth && len > 60 && r() < 0.008) walk(nx, ny, h + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.4), s + len, 1, 40 + r() * 70, 1.3);
        x = nx; y = ny; len += step;
      }
      if (depth) { // a tendril curls at the tip
        const turn = (r() < 0.5 ? -1 : 1) * 0.38;
        for (let k = 0, st = 3.2; k < 14; k++, st *= 0.9) {
          h += turn;
          const nx = x + Math.cos(h) * st, ny = y + Math.sin(h) * st;
          segs.push({ x0: x, y0: y, x1: nx, y1: ny, s: s + len, w: 1 });
          x = nx; y = ny; len += st;
        }
      }
    }
    const N = 7;
    const r0 = r() * 6.28;
    for (let i = 0; i < N; i++) walk(ox, oy, r0 + (i / N) * Math.PI * 2 + (r() - 0.5) * 0.4, 0, 0, Infinity, 2);
    segs.sort((a, b) => a.s - b.s);
    leaves.sort((a, b) => a.s - b.s);
    return { segs, leaves, max: segs[segs.length - 1].s };
  }
  const OPEN = 50; // px of stem over which a leaf opens
  function drawVines(ctx, V, R, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK.vine;
    ctx.lineCap = "round";
    for (const s of V.segs) {
      if (s.s > R) break;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    }
    ctx.restore();
    for (const l of V.leaves) {
      if (l.s > R) break;
      leaf(ctx, l.x, l.y, l.a, l.size * ease.out(clamp01((R - l.s) / OPEN)), l.c, alpha);
    }
  }

  // ---- the big stroke (scheme C): a swipe across the screen through the origin
  function strokePath(W, H, y0, seed) {
    const r = rng(seed ^ 0x2c1b3c6d), A = Math.min(H * 0.09, 70), f1 = 1.1 + r() * 0.6, f2 = 2.6 + r() * 1.2;
    const p1 = r() * 6.28, p2 = r() * 6.28, cy = Math.min(H * 0.72, Math.max(H * 0.28, y0));
    const at = (x) => cy + A * Math.sin((x / W) * 6.28 * f1 + p1) + A * 0.35 * Math.sin((x / W) * 6.28 * f2 + p2);
    const pts = [];
    let L = 0, px = null, py = null;
    for (let x = -0.04 * W; x <= 1.04 * W; x += 6) {
      const y = at(x);
      if (px !== null) L += Math.hypot(x - px, y - py);
      pts.push({ x, y, s: L });
      px = x; py = y;
    }
    const leaves = [];
    for (let s = 40, side = 1; s < L - 20; s += 44 + r() * 20, side = -side) {
      const i = pts.findIndex((p) => p.s >= s), p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)];
      leaves.push({ x: p.x, y: p.y, a: Math.atan2(q.y - p.y, q.x - p.x) + side * 0.9, size: 9 + r() * 3, s, c: LEAVES[(r() * 2) | 0] });
    }
    return { pts, L, leaves };
  }
  function drawStroke(ctx, P, from, to, colour) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false, tip = null;
    for (const p of P.pts) {
      if (p.s < from) continue;
      if (p.s > to) break;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      tip = p;
    }
    ctx.stroke();
    ctx.restore();
    return tip;
  }
  function pointAt(P, s) {
    return P.pts.find((p) => p.s >= s) || P.pts[P.pts.length - 1];
  }
  // a small sprig (scheme E)
  function sprig(ctx, x, y, g, alpha) {
    if (g <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK.vine;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    const pt = (t) => ({ x: x + 14 * Math.sin(t * 2.2) * t, y: y - 52 * t });
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let t = 0.05; t <= g + 0.001; t += 0.05) { const p = pt(t); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
    ctx.restore();
    [[0.3, -1], [0.5, 1], [0.7, -1], [0.92, 1]].forEach(([t, side], i) => {
      const p = pt(t), q = pt(t + 0.02);
      const k = clamp01((g - t) / 0.25);
      leaf(ctx, p.x, p.y, Math.atan2(q.y - p.y, q.x - p.x) + side * 1.0, 10 * ease.out(k), LEAVES[i % 2], alpha);
    });
  }

  // ---- the five schemes. cover(o, st, S, p): the leaving half; reveal: the arriving half
  const SCHEMES = {
    // A. Wipe: one thin line crosses the screen and leaves paper behind; on the
    //    new page it crosses again and leaves the page behind
    A: {
      ms: { cover: 460, reveal: 460 },
      cover(o, st, S, p) {
        const x = -30 + ease.inOut(p) * (o.W + 60), c = o.ctx;
        c.fillStyle = PAPER;
        c.fillRect(0, 0, Math.max(0, x - 36), o.H);
        const g = c.createLinearGradient(x - 36, 0, x, 0);
        g.addColorStop(0, PAPER);
        g.addColorStop(1, "rgba(250, 248, 243, 0)");
        c.fillStyle = g;
        c.fillRect(x - 36, 0, 36, o.H);
        wipeLine(o, st, x, S);
      },
      reveal(o, st, S, p) {
        const x = -30 + ease.inOut(p) * (o.W + 60), c = o.ctx;
        c.fillStyle = PAPER;
        c.fillRect(x + 36, 0, o.W, o.H);
        const g = c.createLinearGradient(x, 0, x + 36, 0);
        g.addColorStop(0, "rgba(250, 248, 243, 0)");
        g.addColorStop(1, PAPER);
        c.fillStyle = g;
        c.fillRect(x, 0, 36, o.H);
        wipeLine(o, st, x, S);
      },
    },
    // B. Sprigs / embers: a ragged edge spreads from the button; Demo sends a
    //    few thin vines ahead of it, Game's edge is a thin glowing line
    B: {
      ms: { cover: 620, reveal: 560 },
      setup(o, st, S, phase) {
        S.g = grid(o.W, o.H);
        const c = phase === "cover" ? [st.x / SCALE, st.y / SCALE] : [S.g.w / 2, S.g.h / 2];
        Object.assign(S, front(S.g.w, S.g.h, c[0], c[1], st.seed + (phase === "cover" ? 1 : 2)));
        if (st.fx === "vine") S.V = vines(o.W, o.H, st.x, st.y, st.seed);
      },
      cover(o, st, S, p) {
        const e = ease.inOut(p), D = S.g.img.data, fire = st.fx === "fire";
        const pf = fire ? e : clamp01((e - 0.15) / 0.85);
        const T = S.lo - 0.03 + pf * (S.hi + 0.05 - S.lo), rim = [];
        for (let i = 0, n = S.f.length; i < n; i++) {
          const d = T - S.f[i], j = i * 4;
          let c = PAPER_RGB, a = 0;
          if (fire) {
            if (d > 0.014) a = 255;
            else if (d > 0) { c = mix([240, 120, 32], PAPER_RGB, d / 0.014); a = 255; if (Math.random() < 0.004) rim.push(i); }
            else if (d > -0.03) { c = [224, 160, 96]; a = (1 + d / 0.03) * 70; }
          } else if (d > 0.01) a = 255;
          else if (d > 0) a = (d / 0.01) * 255;
          D[j] = c[0]; D[j + 1] = c[1]; D[j + 2] = c[2]; D[j + 3] = a;
        }
        blit(o, S.g);
        if (S.V) drawVines(o.ctx, S.V, e * (S.V.max + OPEN));
        for (const i of rim.slice(0, 2)) spark(S.list, (i % S.g.w) * SCALE, ((i / S.g.w) | 0) * SCALE);
      },
      reveal(o, st, S, p) {
        const e = ease.out(p), D = S.g.img.data, fire = st.fx === "fire";
        const T = S.lo - 0.05 + e * (S.hi + 0.06 - S.lo), rim = [];
        if (!fire) { // paper and the grown vines, a hole opening in the middle
          paper(o);
          drawVines(o.ctx, S.V, S.V.max + OPEN, 1 - ease.out(p));
        }
        for (let i = 0, n = S.f.length; i < n; i++) {
          const d = T - S.f[i], j = i * 4;
          let c = PAPER_RGB, a = 0;
          if (fire) {
            if (d > 0.014) a = 0;
            else if (d > 0) { c = mix(PAPER_RGB, [240, 120, 32], d / 0.014); a = 255; if (Math.random() < 0.004) rim.push(i); }
            else if (d > -0.03) { c = mix(PAPER_RGB, [236, 196, 150], (1 + d / 0.03) * 0.6); a = 255; } else a = 255;
          } else {
            a = d > 0 ? Math.min(255, (d / 0.01) * 255) : 0;
            if (d > 0 && d < 0.01 && Math.random() < 0.0015) rim.push(i);
          }
          D[j] = c[0]; D[j + 1] = c[1]; D[j + 2] = c[2]; D[j + 3] = a;
        }
        blit(o, S.g, fire ? null : "destination-out");
        for (const i of rim.slice(0, fire ? 2 : 1)) {
          const x = (i % S.g.w) * SCALE, y = ((i / S.g.w) | 0) * SCALE;
          if (fire) spark(S.list, x, y); else falling(S.list, x, y);
        }
      },
    },
    // C. Trace: one big swipe is drawn across the screen as the page goes to
    //    paper (leaves open along it / sparks fly from the pen); on the new
    //    page it lifts from its tail
    C: {
      ms: { cover: 620, reveal: 520 },
      setup(o, st, S) { S.P = strokePath(o.W, o.H, st.y, st.seed); },
      cover(o, st, S, p) {
        const e = ease.inOut(p), s = e * S.P.L;
        paper(o, e * 1.25);
        const tip = drawStroke(o.ctx, S.P, 0, s, INK[st.fx]);
        if (st.fx === "vine") {
          for (const l of S.P.leaves) if (l.s <= s) leaf(o.ctx, l.x, l.y, l.a, l.size * ease.out(clamp01((s - l.s) / 60)), l.c);
        } else if (tip && onScreen(o, tip.x, tip.y)) {
          spark(S.list, tip.x, tip.y, { speed: 2.6 });
          spark(S.list, tip.x, tip.y, { speed: 2.6 });
        }
        if (tip) dot(o.ctx, tip, INK[st.fx]);
      },
      reveal(o, st, S, p) {
        const e = ease.inOut(p), s = e * S.P.L;
        paper(o, 1 - ease.out(clamp01(p * 1.6)));
        drawStroke(o.ctx, S.P, s, S.P.L, INK[st.fx]);
        if (st.fx === "vine") {
          for (const l of S.P.leaves) if (l.s > s) leaf(o.ctx, l.x, l.y, l.a, l.size, l.c);
        } else {
          const t = pointAt(S.P, s);
          if (p < 1 && onScreen(o, t.x, t.y)) spark(S.list, t.x, t.y, { speed: 2 });
        }
        dot(o.ctx, S.P.pts[S.P.pts.length - 1], INK[st.fx]);
      },
    },
    // D. Iris: a circle of paper opens from the button, its rim a thin line
    //    (a ring of leaves / a glowing ring); on the new page the paper opens
    //    from the middle
    D: {
      ms: { cover: 520, reveal: 500 },
      cover(o, st, S, p) {
        const r = ease.inOut(p) * (farthest(st.x, st.y, o.W, o.H) + 30), c = o.ctx;
        c.fillStyle = PAPER;
        c.beginPath();
        c.arc(st.x, st.y, Math.max(0, r), 0, Math.PI * 2);
        c.fill();
        ring(o, st, S, st.x, st.y, r);
      },
      reveal(o, st, S, p) {
        const cx = o.W / 2, cy = o.H / 2, r = ease.out(p) * (farthest(cx, cy, o.W, o.H) + 30), c = o.ctx;
        c.fillStyle = PAPER;
        c.beginPath();
        c.rect(0, 0, o.W, o.H);
        c.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
        c.fill("evenodd");
        ring(o, st, S, cx, cy, r);
      },
    },
    // E. Fade: the page fades to paper and back; only a small sprig grows at
    //    the button (Demo) or a puff of sparks leaves it (Game)
    E: {
      ms: { cover: 420, reveal: 380 },
      setup(o, st, S, phase) {
        if (phase === "cover" && st.fx === "fire") for (let i = 0; i < 26; i++) spark(S.list, st.x, st.y, { speed: 4.6 });
      },
      cover(o, st, S, p) {
        paper(o, ease.inOut(p));
        if (st.fx === "vine") sprig(o.ctx, st.x, st.y, ease.out(p), 1);
      },
      reveal(o, st, S, p) {
        paper(o, 1 - ease.inOut(p));
        if (st.fx === "vine") sprig(o.ctx, st.x, st.y, 1, 1 - ease.out(p));
      },
    },
  };
  function wipeLine(o, st, x, S) {
    const c = o.ctx;
    c.save();
    if (st.fx === "fire") { c.shadowColor = "rgba(240, 120, 32, 0.9)"; c.shadowBlur = 10; }
    c.strokeStyle = INK[st.fx];
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, o.H);
    c.stroke();
    c.restore();
    if (st.fx === "fire" && x > 0 && x < o.W && Math.random() < 0.6) spark(S.list, x, Math.random() * o.H, { up: 0.6, spread: 1.6, speed: 2.4 });
  }
  function dot(ctx, p, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  function ring(o, st, S, cx, cy, r) {
    const c = o.ctx;
    c.save();
    if (st.fx === "fire") { c.shadowColor = "rgba(240, 120, 32, 0.9)"; c.shadowBlur = 12; }
    c.strokeStyle = INK[st.fx];
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
    c.stroke();
    c.restore();
    if (st.fx === "vine") {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + r * 0.004;
        leaf(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, a + Math.PI / 2 + (k % 2 ? 0.9 : -0.9) - Math.PI / 2, 9, LEAVES[k % 2]);
      }
    } else {
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (onScreen(o, x, y)) spark(S.list, x, y, { speed: 2.6 });
      }
    }
  }

  // ---- the two halves
  async function play(phase, st) {
    const o = overlay(phase === "cover");
    const sc = SCHEMES[st.scheme] || SCHEMES.A;
    const S = { list: [] };
    if (sc.setup) sc.setup(o, st, S, phase);
    const draw = (p) => {
      o.ctx.clearRect(0, 0, o.W, o.H);
      sc[phase](o, st, S, p);
      particles(o.ctx, S.list);
    };
    if (phase === "reveal") { draw(0); await ready(); }
    await run(sc.ms[phase] * slow(), draw);
    if (phase === "reveal") {
      // leftover sparks and leaves finish over the page
      for (let left = 90; S.list.length && left; left--) {
        await new Promise(requestAnimationFrame);
        o.ctx.clearRect(0, 0, o.W, o.H);
        particles(o.ctx, S.list);
      }
      o.c.remove();
    }
  }
  async function go(fx, href, x, y) {
    if (calm) { location.href = href; return; }
    const st = { fx, scheme: chosen(), x, y, seed: (Math.random() * 1e9) | 0 };
    await play("cover", st);
    const saved = JSON.stringify({ ...st, at: Date.now() });
    sessionStorage.setItem(KEY, saved);
    sessionStorage.setItem(LAST, saved);
    location.href = href;
  }

  // arriving: start as paper if the page we came from left a transition
  let arrived = null;
  try {
    arrived = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch { arrived = null; }
  if (arrived && Date.now() - arrived.at < 8000 && !calm && document.body) play("reveal", arrived);

  // coming back with the browser's Back: drop a cover left from leaving
  addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".tx-overlay").forEach((c) => c.remove());
  });

  window.ArTransition = {
    go,
    replay() {
      try {
        const st = JSON.parse(sessionStorage.getItem(LAST));
        if (st) play("reveal", st);
      } catch {}
    },
    last() {
      try { return JSON.parse(sessionStorage.getItem(LAST)); } catch { return null; }
    },
    setSpeed(k) { sessionStorage.setItem(SPEED, String(k)); },
    speed: slow,
    setScheme(s) { sessionStorage.setItem(SCHEME, s); },
    scheme: chosen,
  };
})();
