/* Page transitions (preview): Demo grows vines over the page, Game burns
   through it. The page you leave plays the first half until the screen is
   covered, then navigates; the page you arrive on starts covered (the same
   picture, rebuilt from the same seed) and plays the second half. */
(() => {
  const KEY = "ar-tx";
  const LAST = "ar-tx-last";
  const SPEED = "ar-tx-speed";
  const SCALE = 4; // the masks are worked out on a grid this many px wide
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MS = { vine: { cover: 760, reveal: 680 }, fire: { cover: 720, reveal: 700 } };
  const slow = () => Number(sessionStorage.getItem(SPEED)) || 1;

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
  // when each grid cell is reached: by distance from the origin, with a ragged edge
  function front(w, h, ox, oy, seed) {
    const n = fbm(w, h, Math.max(w, h) / 5, seed);
    const far = Math.max(Math.hypot(ox, oy), Math.hypot(w - ox, oy), Math.hypot(ox, h - oy), Math.hypot(w - ox, h - oy));
    const f = new Float32Array(w * h);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = 0.78 * Math.hypot(x - ox, y - oy) / far + 0.22 * (n[i] - 0.5) * 2.6;
        f[i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return { f, lo, hi };
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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
  function blit(o, g, extra) {
    g.ctx.putImageData(g.img, 0, 0);
    const ctx = o.ctx;
    ctx.save();
    if (extra) extra(ctx);
    ctx.drawImage(g.c, 0, 0, o.W, o.H);
    ctx.restore();
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

  // ---- particles: sparks, ash, falling leaves
  function sparkColour(life) {
    if (life > 0.75) return "rgb(255, 236, 160)";
    if (life > 0.5) return "rgb(255, 176, 50)";
    if (life > 0.25) return "rgb(240, 110, 32)";
    return `rgba(190, 48, 20, ${life * 4})`;
  }
  function leafShape(ctx, x, y, a, size, colour) {
    ctx.save();
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
  function particles(ctx, list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= p.decay;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.t = (p.t || 0) + 1;
      if (p.kind === "spark") {
        p.vy += 0.11; p.vx *= 0.985;
        p.x += p.vx; p.y += p.vy;
        ctx.strokeStyle = sparkColour(p.life);
        ctx.lineWidth = 1.1 + p.life * 1.8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (p.kind === "ash") {
        p.vy -= 0.015;
        p.x += p.vx + Math.sin(p.t * 0.09 + p.ph) * 0.7;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life * 1.6) * 0.8;
        ctx.fillStyle = p.colour;
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
        ctx.restore();
      } else {
        p.vy += 0.08; p.vx *= 0.99;
        p.x += p.vx + Math.sin(p.t * 0.07 + p.ph) * 0.9;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.globalAlpha = Math.min(1, p.life * 2);
        leafShape(ctx, p.x, p.y, p.rot, p.s, p.colour);
        ctx.globalAlpha = 1;
      }
    }
  }
  function pick(rim) {
    const i = rim[(Math.random() * rim.length) | 0];
    return i;
  }

  // ---- fire: the page chars from the origin, a glowing edge ahead of it
  const HOT = [[255, 246, 196], [255, 198, 74], [244, 118, 34], [176, 42, 18], [58, 22, 14]];
  function heat(k) {
    const x = clamp01(k) * (HOT.length - 1), i = Math.min(HOT.length - 2, x | 0);
    return mix(HOT[i], HOT[i + 1], x - i);
  }
  const char = (t) => mix([16, 10, 8], [46, 26, 17], clamp01((t - 0.5) * 2.4 + 0.5));
  const FE = 0.05, SCORCH = 0.05, EMBER = 0.08;

  // cover: burnt behind the front; reveal: a hole behind the front, char ahead
  function paintFire(g, glow, tex, f, T, reveal, rim) {
    const D = g.img.data, G = glow.img.data;
    for (let i = 0, n = f.length; i < n; i++) {
      const d = T - f[i], j = i * 4;
      let c, a = 255, ga = 0;
      if (!reveal) {
        if (d > FE) c = char(tex[i]);
        else if (d > 0) {
          const k = d / FE;
          c = mix(heat(k), char(tex[i]), k * k);
          ga = (1 - k) * 255;
          if (k < 0.35 && Math.random() < 0.03) rim.push(i);
        } else if (d > -SCORCH) {
          c = [104, 56, 24];
          a = Math.pow(1 + d / SCORCH, 2) * 170;
        } else a = 0;
      } else {
        if (d > FE) a = 0;
        else if (d > 0) {
          const k = 1 - d / FE; // 0 at the hole
          c = mix(heat(k * 0.9), char(tex[i]), k * k);
          ga = (1 - k) * 255;
          a = Math.min(255, 140 + k * 600);
          if (k < 0.4 && Math.random() < 0.03) rim.push(i);
        } else if (d > -EMBER) {
          const k = Math.pow(1 + d / EMBER, 2);
          c = mix(char(tex[i]), [122, 32, 12], k * 0.8);
        } else c = char(tex[i]);
      }
      if (a) { D[j] = c[0]; D[j + 1] = c[1]; D[j + 2] = c[2]; }
      D[j + 3] = a;
      if (ga) { const h = heat(1 - ga / 255); G[j] = h[0]; G[j + 1] = h[1]; G[j + 2] = h[2]; }
      G[j + 3] = ga;
    }
  }
  function drawFire(o, g, glow) {
    blit(o, g);
    blit(o, glow, (ctx) => { ctx.filter = "blur(9px)"; ctx.globalAlpha = 0.75; });
  }
  function emberSpray(list, o, rim, sparks, ash) {
    if (!rim.length) return;
    for (let n = 0; n < sparks; n++) {
      const i = pick(rim), w = Math.ceil(o.W / SCALE);
      const x = (i % w) * SCALE, y = ((i / w) | 0) * SCALE;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 2 + Math.random() * 4.5;
      list.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.02 + Math.random() * 0.03 });
    }
    for (let n = 0; n < ash; n++) {
      const i = pick(rim), w = Math.ceil(o.W / SCALE);
      list.push({ kind: "ash", x: (i % w) * SCALE, y: ((i / w) | 0) * SCALE, vx: (Math.random() - 0.5) * 1.2,
        vy: -0.4 - Math.random() * 1.2, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.2,
        s: 2.5 + Math.random() * 4, ph: Math.random() * 6, life: 1, decay: 0.012 + Math.random() * 0.015,
        colour: Math.random() < 0.5 ? "#2a1a12" : "#4a3428" });
    }
  }

  async function fireCover(o, st) {
    const g = grid(o.W, o.H), glow = grid(o.W, o.H);
    const tex = fbm(g.w, g.h, Math.max(g.w, g.h) / 7, st.seed);
    const { f, lo, hi } = front(g.w, g.h, st.x / SCALE, st.y / SCALE, st.seed + 1);
    const list = [];
    await run(MS.fire.cover * slow(), (p) => {
      const e = p * p * (1.6 - 0.6 * p); // catches, then runs
      const T = lo - 0.02 + e * (hi + FE + 0.03 - lo);
      const rim = [];
      paintFire(g, glow, tex, f, T, false, rim);
      o.ctx.clearRect(0, 0, o.W, o.H);
      drawFire(o, g, glow);
      emberSpray(list, o, rim, 7, 0);
      particles(o.ctx, list);
    });
  }
  async function fireReveal(o, st) {
    const g = grid(o.W, o.H), glow = grid(o.W, o.H);
    const tex = fbm(g.w, g.h, Math.max(g.w, g.h) / 7, st.seed);
    const { f, lo, hi } = front(g.w, g.h, g.w / 2, g.h / 2, st.seed + 2);
    const list = [];
    const start = lo - EMBER - 0.02, end = hi + FE + 0.02;
    const at = (p) => start + p * (end - start);
    const frame = (p, spray) => {
      const rim = [];
      paintFire(g, glow, tex, f, at(p), true, rim);
      o.ctx.clearRect(0, 0, o.W, o.H);
      drawFire(o, g, glow);
      if (spray) emberSpray(list, o, rim, 4, 5);
      particles(o.ctx, list);
    };
    frame(0, false); // covered, before the first paint
    await ready();
    await run(MS.fire.reveal * slow(), (p) => frame(1 - Math.pow(1 - p, 1.6), true));
    await drain(o, list);
  }

  // ---- vines: stems and leaves grow out from the origin, green fills in behind
  const FILL = (t) => mix([18, 66, 44], [30, 112, 74], clamp01((t - 0.5) * 2.4 + 0.5));
  const VE = 0.03;
  function paintVineFill(g, tex, f, T) {
    const D = g.img.data;
    for (let i = 0, n = f.length; i < n; i++) {
      const d = T - f[i], j = i * 4;
      let c = null, a = 255;
      if (d > VE) c = FILL(tex[i]);
      else if (d > 0) c = mix([52, 168, 110], FILL(tex[i]), d / VE);
      else if (d > -0.012) { c = [52, 168, 110]; a = (1 + d / 0.012) * 255; } else a = 0;
      if (c) { D[j] = c[0]; D[j + 1] = c[1]; D[j + 2] = c[2]; }
      D[j + 3] = a;
    }
  }
  const STEM = "#2e9a66";
  const LEAVES = ["#3cb37d", "#2f9e69", "#5cc28f", "#25915f", "#1f7a50"];
  function vines(W, H, ox, oy, seed) {
    const r = rng(seed ^ 0x5bd1e995), segs = [], leaves = [], diag = Math.hypot(W, H);
    const inside = (x, y) => x > -60 && y > -60 && x < W + 60 && y < H + 60;
    function walk(x, y, h, s, depth, maxLen, w0) {
      const base = h, ph = r() * 6.28, fr = 0.015 + r() * 0.03, step = 6;
      const span = maxLen === Infinity ? diag * 1.1 : maxLen;
      let len = 0, side = r() < 0.5 ? 1 : -1, nextLeaf = 8 + r() * 12;
      while (len < maxLen && inside(x, y)) {
        h += (r() - 0.5) * 0.42 + Math.sin(len * fr + ph) * 0.07;
        h += (base - h) * 0.06;
        const nx = x + Math.cos(h) * step, ny = y + Math.sin(h) * step;
        const w = Math.max(0.9, w0 * (1 - len / span));
        segs.push({ x0: x, y0: y, x1: nx, y1: ny, s: s + len, w });
        if (len >= nextLeaf) {
          side = -side;
          leaves.push({ x: nx, y: ny, a: h + side * (0.8 + r() * 0.6), size: (depth ? 8 : 10) + r() * 8,
            s: s + len, c: LEAVES[(r() * LEAVES.length) | 0] });
          nextLeaf = len + 11 + r() * 15;
        }
        if (depth < 2 && len > 20 && r() < 0.035) {
          walk(nx, ny, h + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), s + len, depth + 1, 50 + r() * (depth ? 80 : 200), w * 0.6);
        }
        x = nx; y = ny; len += step;
      }
      if (depth > 0) { // a tendril curls at the tip
        const turn = (r() < 0.5 ? -1 : 1) * (0.32 + r() * 0.12);
        for (let k = 0, st = 4; k < 16; k++, st *= 0.92) {
          h += turn;
          const nx = x + Math.cos(h) * st, ny = y + Math.sin(h) * st;
          segs.push({ x0: x, y0: y, x1: nx, y1: ny, s: s + len, w: 0.9 });
          x = nx; y = ny; len += st;
        }
      }
    }
    const N = Math.round(16 + diag / 75);
    for (let i = 0; i < N; i++) walk(ox, oy, (i / N) * Math.PI * 2 + (r() - 0.5) * 0.3, 0, 0, Infinity, 3.4 + r() * 1.8);
    segs.sort((a, b) => a.s - b.s);
    leaves.sort((a, b) => a.s - b.s);
    return { segs, leaves, max: Math.max(segs[segs.length - 1].s, leaves.length ? leaves[leaves.length - 1].s : 0) };
  }
  function stems(ctx, V, from, to) {
    ctx.strokeStyle = STEM;
    ctx.lineCap = "round";
    for (let i = from; i < to; i++) {
      const s = V.segs[i];
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    }
  }
  const GROW = 70; // px of stem over which a new leaf opens
  // the vines layer as it is when the screen is covered
  function vineLayer(o, st) {
    const g = grid(o.W, o.H);
    const tex = fbm(g.w, g.h, Math.max(g.w, g.h) / 7, st.seed);
    const V = vines(o.W, o.H, st.x, st.y, st.seed);
    return { g, tex, V };
  }
  async function vineCover(o, st) {
    const { g, tex, V } = vineLayer(o, st);
    const { f, lo, hi } = front(g.w, g.h, st.x / SCALE, st.y / SCALE, st.seed + 1);
    const plant = canvas(o.W, o.H, o.dpr);
    let si = 0, li = 0;
    const frame = (R, T) => {
      let to = si;
      while (to < V.segs.length && V.segs[to].s <= R) to++;
      stems(plant.ctx, V, si, to);
      si = to;
      while (li < V.leaves.length && V.leaves[li].s <= R - GROW) {
        const l = V.leaves[li++];
        leafShape(plant.ctx, l.x, l.y, l.a, l.size, l.c);
      }
      paintVineFill(g, tex, f, T);
      o.ctx.clearRect(0, 0, o.W, o.H);
      blit(o, g);
      o.ctx.drawImage(plant.c, 0, 0, o.W, o.H);
      for (let k = li; k < V.leaves.length && V.leaves[k].s <= R; k++) {
        const l = V.leaves[k], t = (R - l.s) / GROW;
        leafShape(o.ctx, l.x, l.y, l.a, l.size * (1 - Math.pow(1 - t, 3)), l.c);
      }
    };
    await run(MS.vine.cover * slow(), (p) => {
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const pf = Math.max(0, (e - 0.2) / 0.8);
      frame(e * (V.max + GROW), lo - 0.02 + pf * (hi + VE + 0.03 - lo));
    });
  }
  async function vineReveal(o, st) {
    const { g, tex, V } = vineLayer(o, st);
    const layer = canvas(o.W, o.H, o.dpr);
    paintVineFill(g, tex, new Float32Array(g.w * g.h), 1);
    g.ctx.putImageData(g.img, 0, 0);
    layer.ctx.drawImage(g.c, 0, 0, o.W, o.H);
    stems(layer.ctx, V, 0, V.segs.length);
    for (const l of V.leaves) leafShape(layer.ctx, l.x, l.y, l.a, l.size, l.c);

    const hole = grid(o.W, o.H);
    const { f, lo, hi } = front(hole.w, hole.h, hole.w / 2, hole.h / 2, st.seed + 2);
    const list = [];
    const frame = (p, fall) => {
      const T = lo - 0.02 + p * (hi + 0.05 - lo), D = hole.img.data, rim = [];
      for (let i = 0, n = f.length; i < n; i++) {
        const d = T - f[i];
        D[i * 4 + 3] = d > 0 ? Math.min(255, (d / 0.012) * 255) : 0;
        if (d > 0 && d < 0.02 && Math.random() < 0.02) rim.push(i);
      }
      o.ctx.clearRect(0, 0, o.W, o.H);
      o.ctx.drawImage(layer.c, 0, 0, o.W, o.H);
      blit(o, hole, (ctx) => { ctx.globalCompositeOperation = "destination-out"; });
      if (fall && rim.length) {
        for (let n = 0; n < 6; n++) {
          const i = pick(rim);
          const x = (i % hole.w) * SCALE, y = ((i / hole.w) | 0) * SCALE;
          const out = Math.atan2(y - o.H / 2, x - o.W / 2);
          list.push({ kind: "leaf", x, y, vx: Math.cos(out) * (1 + Math.random() * 2.5), vy: Math.sin(out) * 1.5 - 1.5 * Math.random(),
            rot: Math.random() * 6.3, spin: (Math.random() - 0.5) * 0.18, s: 8 + Math.random() * 8, ph: Math.random() * 6,
            life: 1, decay: 0.018 + Math.random() * 0.02, colour: LEAVES[(Math.random() * LEAVES.length) | 0] });
        }
      }
      particles(o.ctx, list);
    };
    frame(0, false);
    await ready();
    await run(MS.vine.reveal * slow(), (p) => frame(1 - Math.pow(1 - p, 2), true));
    await drain(o, list);
  }

  // ---- the two halves
  function ready() {
    return new Promise((done) => {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(done));
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
      else go();
    });
  }
  async function drain(o, list) {
    // the cover is gone; leftover sparks and leaves finish on a cleared canvas
    let left = 90;
    while (list.length && left--) {
      await new Promise(requestAnimationFrame);
      o.ctx.clearRect(0, 0, o.W, o.H);
      particles(o.ctx, list);
    }
    o.c.remove();
  }
  async function cover(fx, x, y) {
    const st = { fx, x, y, seed: (Math.random() * 1e9) | 0, w: innerWidth, h: innerHeight };
    const o = overlay(true);
    if (fx === "fire") await fireCover(o, st);
    else await vineCover(o, st);
    return st;
  }
  function reveal(st) {
    const o = overlay(false);
    return st.fx === "fire" ? fireReveal(o, st) : vineReveal(o, st);
  }
  async function go(fx, href, x, y) {
    if (calm) { location.href = href; return; }
    const st = await cover(fx, x, y);
    const saved = JSON.stringify({ ...st, at: Date.now() });
    sessionStorage.setItem(KEY, saved);
    sessionStorage.setItem(LAST, saved);
    location.href = href;
  }

  // arriving: start covered if the page we came from left a transition
  let arrived = null;
  try {
    arrived = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch { arrived = null; }
  if (arrived && Date.now() - arrived.at < 8000 && !calm && document.body) reveal(arrived);

  // coming back with the browser's Back: drop a cover left from leaving
  addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".tx-overlay").forEach((c) => c.remove());
  });

  window.ArTransition = {
    go,
    replay() {
      try {
        const st = JSON.parse(sessionStorage.getItem(LAST));
        if (st) reveal({ ...st, seed: st.seed });
      } catch {}
    },
    setSpeed(k) { sessionStorage.setItem(SPEED, String(k)); },
    speed: slow,
  };
})();
