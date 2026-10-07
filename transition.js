/* Home -> Demo / Game. The page fades to paper and the XBLab mark draws
   itself in the middle (X, ∞, the eight, the pixels: green for Demo, red for
   Game), then the page opens. The page it opens starts on the finished mark and fades it away.
   Load this script in <head>: an arriving page is covered (with the finished
   mark, kept from the page before) before anything of it is painted. */
(() => {
  const KEY = "xbl-transition";
  const ROOT = document.currentScript.src.replace(/transition\.js.*$/, "");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FADE_IN = 200, LOGO_AT = 150, FADE_OUT = 380;
  const SIZE = "display:block;width:min(46vmin,360px);height:auto";
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

  async function go(href, colour) {
    if (calm) { location.href = href; return; }
    const o = cover(0);
    o.style.pointerEvents = "auto";
    const loading = motion(colour).catch(() => null);
    // the finished mark, small and still, for the next page to show at once
    const still = fetch(`${ROOT}brand/xblab/xblab-mark-still-${colour}.svg`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    requestAnimationFrame(() => { o.style.opacity = "1"; });
    const m = await loading;
    if (!m) { location.href = href; return; }
    o.appendChild(m.svg);
    await wait(LOGO_AT);
    m.svg.unpauseAnimations();
    await wait(m.dur + 60);
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
