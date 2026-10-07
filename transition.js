/* Home -> Demo / Game: the home page fades to paper and the XBLab motion
   plays (green for Demo, red for Game); the page it opens starts on the
   motion's last frame and fades it away. Load this script at the top of
   <body>, so an arriving page is covered before it first paints. */
(() => {
  const KEY = "xbl-transition";
  const ROOT = document.currentScript.src.replace(/transition\.js.*$/, "");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FADE_IN = 260, FADE_OUT = 520;
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  function cover(opacity) {
    const o = document.createElement("div");
    o.className = "xbl-transition";
    o.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:#faf8f3;display:grid;place-items:center;opacity:${opacity};transition:opacity ${FADE_IN}ms ease`;
    document.body.appendChild(o);
    return o;
  }
  // the motion as inline svg (its animations start paused at 0)
  async function motion(colour) {
    const res = await fetch(`${ROOT}brand/xblab/xblab-motion-${colour}-fast.svg`);
    if (!res.ok) throw new Error(res.status);
    const box = document.createElement("div");
    box.innerHTML = await res.text();
    const svg = box.querySelector("svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.cssText = "display:block;width:min(92vw,1100px);height:auto";
    svg.pauseAnimations();
    svg.setCurrentTime(0);
    const dur = parseFloat(svg.querySelector("animate").getAttribute("dur")) * 1000;
    return { svg, dur };
  }

  async function go(href, colour) {
    if (calm) { location.href = href; return; }
    const o = cover(0);
    o.style.pointerEvents = "auto";
    let m;
    try { m = await motion(colour); } catch { location.href = href; return; }
    o.appendChild(m.svg);
    m.svg.pauseAnimations();
    m.svg.setCurrentTime(0);
    requestAnimationFrame(() => { o.style.opacity = "1"; });
    await wait(FADE_IN);
    m.svg.unpauseAnimations();
    await wait(m.dur + 120);
    sessionStorage.setItem(KEY, JSON.stringify({ colour, at: Date.now() }));
    location.href = href;
  }

  // arriving: cover the page with the motion's last frame, then fade it away
  let arrived = null;
  try {
    arrived = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch { arrived = null; }
  if (arrived && Date.now() - arrived.at < 8000 && document.body && !calm) {
    const o = cover(1);
    o.style.transition = `opacity ${FADE_OUT}ms ease`;
    motion(arrived.colour).then((m) => {
      m.svg.setCurrentTime(m.dur / 1000);
      o.appendChild(m.svg);
    }).catch(() => {}).finally(async () => {
      if (document.readyState !== "complete") await new Promise((done) => addEventListener("load", done, { once: true }));
      await wait(180);
      o.style.opacity = "0";
      await wait(FADE_OUT);
      o.remove();
    });
  }
  // back to the home page with the browser's Back: drop the cover left from leaving
  addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".xbl-transition").forEach((o) => o.remove());
  });

  window.XBLTransition = { go };
})();
