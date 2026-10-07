/* Home -> Demo / Game.
   Leaving: the page fades to paper and the XBLab mark draws itself in the
   middle (X, ∞, the solid eight; green for Demo, red for Game).
   Arriving: the page opens covered, the solid mark already on it; one thin
   scan line runs down the whole screen. Above it the page shows through a
   narrow band of pixels; where it crosses the mark's right half, the half
   turns to pixels. Then the mark gives way.
   Load this script in <head>: an arriving page is covered (with the mark,
   kept from the page before) before anything of it is painted. */
(() => {
  const KEY = "xbl-transition";
  const ROOT = document.currentScript.src.replace(/transition\.js.*$/, "");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PAPER = "#faf8f3", ACCENT = { green: "#25915f", red: "#d6452b" };
  const FADE_IN = 200, SCAN = 640, MARK_OUT = 280;
  const CELL = 12, BAND = 56; // the pixels at the scan's edge
  const MARK = "position:absolute;left:50%;top:50%;width:min(46vmin,360px);aspect-ratio:1;transform:translate(-50%,-50%)";
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const file = (name) => fetch(`${ROOT}brand/xblab/${name}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });

  function cover(opacity) {
    const o = document.createElement("div");
    o.className = "xbl-transition";
    o.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:${PAPER};opacity:${opacity};transition:opacity ${FADE_IN}ms ease;pointer-events:none`;
    // on <html> itself, so it can go up before <body> exists
    (document.body || document.documentElement).appendChild(o);
    return o;
  }
  function svgOf(text) {
    const box = document.createElement("div");
    box.innerHTML = text;
    const svg = box.querySelector("svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    return svg;
  }
  function frames(ms, fn) {
    return new Promise((done) => {
      const t0 = performance.now();
      (function step(now) {
        const p = Math.min(1, (now - t0) / ms);
        fn(p);
        if (p < 1) requestAnimationFrame(step); else done();
      })(t0);
    });
  }

  // ---- leaving
  async function go(href, colour) {
    if (calm) { location.href = href; return; }
    const o = cover(0);
    o.style.pointerEvents = "auto";
    let draw, solid, pixels;
    try {
      [draw, solid, pixels] = await Promise.all([
        file(`xblab-mark-draw-${colour}.svg`), file(`xblab-mark-solid-${colour}.svg`), file(`xblab-mark-pixels-${colour}.svg`)]);
    } catch { location.href = href; return; }
    const mark = document.createElement("div");
    mark.style.cssText = MARK;
    const svg = svgOf(draw);
    svg.querySelector("rect")?.remove(); // its own paper ground: the cover is the ground
    svg.pauseAnimations();
    svg.setCurrentTime(0);
    mark.appendChild(svg);
    o.appendChild(mark);
    requestAnimationFrame(() => { o.style.opacity = "1"; });
    await wait(FADE_IN - 50);
    svg.unpauseAnimations();
    await wait(parseFloat(svg.querySelector("animate").getAttribute("dur")) * 1000 + 30);
    sessionStorage.setItem(KEY, JSON.stringify({ colour, at: Date.now(), solid, pixels }));
    location.href = href;
  }

  // ---- arriving
  async function arrive(t) {
    const o = cover(1);
    const mark = document.createElement("div");
    mark.style.cssText = MARK;
    const solid = svgOf(t.solid), pixels = svgOf(t.pixels);
    pixels.style.clipPath = "inset(0 0 100% 0)";
    mark.append(solid, pixels);
    o.appendChild(mark);
    if (document.readyState === "loading") await new Promise((done) => document.addEventListener("DOMContentLoaded", done, { once: true }));
    await wait(60);

    // the paper is now drawn on a canvas, so it can fall away pixel by pixel
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    o.insertBefore(canvas, mark);
    o.style.background = "transparent";

    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    const seed = Array.from({ length: cols * rows }, () => Math.random());
    const m = mark.getBoundingClientRect(), accent = ACCENT[t.colour] || ACCENT.green;
    await frames(SCAN, (p) => {
      const y = (H + BAND) * inOut(p) - 2;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = PAPER;
      for (let r = 0; r < rows; r++) {
        const top = r * CELL;
        if (top >= y) break;
        const into = (y - (top + CELL)) / BAND; // 0 at the line, 1 at the band's top
        if (into >= 1) continue;
        for (let c = 0; c < cols; c++) if (seed[r * cols + c] > into) ctx.fillRect(c * CELL, top, CELL, CELL);
      }
      ctx.fillRect(0, Math.max(0, y), W, H);
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
      ctx.restore();
      const rel = Math.max(0, Math.min(m.height, y - m.top));
      solid.style.clipPath = `inset(${rel}px 0 0 0)`;
      pixels.style.clipPath = `inset(0 0 ${m.height - rel}px 0)`;
    });
    canvas.remove();
    await frames(MARK_OUT, (p) => { mark.style.opacity = String(1 - p); });
    o.remove();
  }

  let arrived = null;
  try {
    arrived = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch { arrived = null; }
  if (arrived && Date.now() - arrived.at < 8000 && arrived.solid && arrived.pixels && !calm) {
    arrive(arrived).catch(() => document.querySelectorAll(".xbl-transition").forEach((o) => o.remove()));
  }
  // back to the home page with the browser's Back: drop what was left from leaving
  addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".xbl-transition").forEach((o) => o.remove());
  });

  window.XBLTransition = { go };
})();
