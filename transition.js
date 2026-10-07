/* Home -> Demo / Game. Where you click, a small sprig grows (Demo) or a puff
   of sparks flies (Game) while the page fades to paper; then the XBLab mark
   draws itself in the middle (X, ∞, the eight, the pixels) and the page
   opens. The page it opens starts on the finished mark and fades it away.
   Load this script in <head>: an arriving page is covered (with the finished
   mark, kept from the page before) before anything of it is painted. */
(() => {
  const KEY = "xbl-transition";
  const ROOT = document.currentScript.src.replace(/transition\.js.*$/, "");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FADE_IN = 200, LOGO_AT = 170, FADE_OUT = 380;
  const SIZE = "display:block;width:min(46vmin,360px);height:auto";
  const GREEN = "#25915f", GREEN_DARK = "#1c6f49";
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function cover(opacity) {
    const o = document.createElement("div");
    o.className = "xbl-transition";
    o.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:#faf8f3;display:grid;place-items:center;opacity:${opacity};transition:opacity ${FADE_IN}ms ease`;
    // on <html> itself, so it can go up before <body> exists
    (document.body || document.documentElement).appendChild(o);
    return o;
  }
  // the mark's motion as inline svg, paused at its start
  async function motion(colour) {
    const res = await fetch(`${ROOT}brand/xblab/xblab-mark-motion-${colour}.svg`);
    if (!res.ok) throw new Error(res.status);
    const box = document.createElement("div");
    box.innerHTML = await res.text();
    const svg = box.querySelector("svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.cssText = SIZE;
    svg.pauseAnimations();
    svg.setCurrentTime(0);
    const dur = parseFloat(svg.querySelector("animate").getAttribute("dur")) * 1000;
    return { svg, dur };
  }

  // ---- the little flourish where you clicked, drawn over the fading page
  function flourish(kind, x, y) {
    const c = document.createElement("canvas"), dpr = Math.min(devicePixelRatio || 1, 2);
    c.className = "xbl-transition";
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483001;pointer-events:none;transition:opacity 220ms ease";
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    const t0 = performance.now();
    const leaf = (px, py, a, size, colour) => {
      if (size <= 0.2) return;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.scale(size / 11, size / 11);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(2.5, -3.4, 7.5, -3.6, 11, 0);
      ctx.bezierCurveTo(7.5, 2.2, 2.5, 2.2, 0, 0);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.restore();
    };
    // a sprig: a curving stem with four leaves opening along it
    const sprig = (g) => {
      const pt = (t) => ({ x: x + 16 * Math.sin(t * 2.2) * t, y: y - 64 * t });
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let t = 0.04; t <= g + 0.001; t += 0.04) { const p = pt(t); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
      [[0.3, -1], [0.5, 1], [0.7, -1], [0.92, 1]].forEach(([t, side], i) => {
        const p = pt(t), q = pt(t + 0.02), k = Math.max(0, Math.min(1, (g - t) / 0.25));
        leaf(p.x, p.y, Math.atan2(q.y - p.y, q.x - p.x) + side, 12 * ease(k), i % 2 ? GREEN_DARK : GREEN);
      });
    };
    // sparks: gold, orange, red, cooling to ember (the home page's quench)
    const sparks = [];
    if (kind === "sparks") {
      for (let i = 0; i < 34; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, v = 5 * (0.4 + Math.random());
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.022 + Math.random() * 0.03 });
      }
    }
    const heat = (l) => (l > 0.75 ? "rgb(245,178,30)" : l > 0.5 ? "rgb(240,120,32)" : l > 0.25 ? "rgb(214,69,43)" : `rgba(140,36,20,${l * 4})`);
    (function frame(now) {
      if (!c.isConnected) return;
      const ms = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (kind === "sprig") sprig(ease(Math.min(1, ms / 340)));
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.vy += 0.2; s.vx *= 0.985;
        s.x += s.vx; s.y += s.vy;
        s.life -= s.decay;
        ctx.strokeStyle = heat(Math.max(0, s.life));
        ctx.lineWidth = 1.4 + s.life * 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x - s.vx * 2.2, s.y - s.vy * 2.2);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      if (ms < 1200) requestAnimationFrame(frame);
    })(t0);
    return c;
  }

  async function go(href, colour, x, y) {
    if (calm) { location.href = href; return; }
    const o = cover(0);
    o.style.pointerEvents = "auto";
    const fx = flourish(colour === "red" ? "sparks" : "sprig", x ?? innerWidth / 2, y ?? innerHeight / 2);
    const loading = motion(colour).catch(() => null);
    // the finished mark, small and still, for the next page to show at once
    const still = fetch(`${ROOT}brand/xblab/xblab-mark-still-${colour}.svg`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    requestAnimationFrame(() => { o.style.opacity = "1"; });
    const m = await loading;
    if (!m) { location.href = href; return; }
    o.appendChild(m.svg);
    await wait(LOGO_AT);
    m.svg.unpauseAnimations();
    await wait(200);
    fx.style.opacity = "0"; // the flourish gives way to the mark
    await wait(Math.max(0, m.dur - 200) + 60);
    sessionStorage.setItem(KEY, JSON.stringify({ colour, at: Date.now(), still: await still }));
    location.href = href;
  }

  // arriving: cover the page with the finished mark, then fade it away
  let arrived = null;
  try {
    arrived = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch { arrived = null; }
  if (arrived && Date.now() - arrived.at < 8000 && !calm) {
    const o = cover(1);
    o.style.transition = `opacity ${FADE_OUT}ms ease`;
    o.innerHTML = arrived.still || ""; // in place before the first paint
    const svg = o.querySelector("svg");
    if (svg) { svg.removeAttribute("width"); svg.removeAttribute("height"); svg.style.cssText = SIZE; }
    (async () => {
      if (document.readyState === "loading") await new Promise((done) => document.addEventListener("DOMContentLoaded", done, { once: true }));
      await wait(90);
      o.style.opacity = "0";
      await wait(FADE_OUT);
      o.remove();
    })();
  }
  // back to the home page with the browser's Back: drop what was left from leaving
  addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".xbl-transition").forEach((o) => o.remove());
  });

  window.XBLTransition = { go };
})();
