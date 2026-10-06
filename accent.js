/* The site's accent colour (the home page and Demo): vermilion, green or
   indigo, chosen from a small dot in the bottom-left corner and remembered in
   this browser. Pages without this script (Study, Game) keep their own look.
   The colour is the CSS variable --accent-main (and --accent-main-rgb for
   tints); an "accent-change" event tells scripts that draw with it. */
(() => {
  const PALETTE = {
    vermilion: { name: "Vermilion", hex: "#d6452b", rgb: "214, 69, 43" },
    green: { name: "Green", hex: "#1f7a55", rgb: "31, 122, 85" },
    indigo: { name: "Indigo", hex: "#3049b8", rgb: "48, 73, 184" }
  };
  const KEY = "accentColour";
  const read = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const save = (id) => { try { localStorage.setItem(KEY, id); } catch (_) { /* storage off */ } };
  let current = PALETTE[read()] ? read() : "vermilion";

  function apply(id) {
    current = PALETTE[id] ? id : "vermilion";
    const c = PALETTE[current];
    const root = document.documentElement;
    root.style.setProperty("--accent-main", c.hex);
    root.style.setProperty("--accent-main-rgb", c.rgb);
    root.dataset.accent = current;
    document.dispatchEvent(new CustomEvent("accent-change", { detail: c }));
  }
  apply(current);

  // the corner dot; it opens the three swatches beside it
  function mount() {
    const box = document.createElement("div");
    box.className = "accent-pick";
    box.innerHTML = `<button type="button" class="accent-dot" aria-label="Accent colour" aria-expanded="false"></button>
      <div class="accent-swatches" hidden>${Object.entries(PALETTE).map(([id, c]) =>
        `<button type="button" data-accent="${id}" title="${c.name}" aria-label="${c.name}" style="--swatch:${c.hex}"></button>`).join("")}</div>`;
    // beside Demo's style switch, else on its own in the corner
    if (document.getElementById("theme-toggle")) box.classList.add("is-beside");
    document.body.appendChild(box);
    const dot = box.querySelector(".accent-dot");
    const list = box.querySelector(".accent-swatches");
    const mark = () => list.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.accent === current));
    const open = (on) => { list.hidden = !on; dot.setAttribute("aria-expanded", String(on)); };
    mark();
    dot.addEventListener("click", (e) => { e.stopPropagation(); open(list.hidden); });
    list.addEventListener("click", (e) => {
      const id = e.target.closest("button")?.dataset.accent;
      if (!id) return;
      save(id);
      apply(id);
      mark();
      open(false);
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) open(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
  }

  const style = document.createElement("style");
  style.textContent = `
    .accent-pick { position: fixed; left: 12px; bottom: 12px; z-index: 62; display: flex; align-items: center; gap: 8px; }
    .accent-pick.is-beside { left: 38px; bottom: 4px; }
    .accent-pick button { padding: 0; border: 0; cursor: pointer; }
    .accent-dot { width: 16px; height: 16px; border-radius: 50%; background: var(--accent-main);
      box-shadow: 0 0 0 1px rgba(17, 17, 17, 0.55), inset 0 0 0 2px #faf8f3; transition: transform 140ms ease; }
    .accent-dot:hover { transform: scale(1.15); }
    .accent-swatches { display: flex; gap: 6px; padding: 4px 6px; background: #faf8f3; border: 1px solid rgba(17, 17, 17, 0.55); }
    .accent-swatches[hidden] { display: none; }
    .accent-swatches button { width: 16px; height: 16px; border-radius: 50%; background: var(--swatch); transition: transform 140ms ease; }
    .accent-swatches button:hover { transform: scale(1.15); }
    .accent-swatches button.is-on { box-shadow: 0 0 0 2px #faf8f3, 0 0 0 3px #111; }
  `;
  document.head.appendChild(style);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  window.Accent = { current: () => PALETTE[current], palette: PALETTE, set: (id) => { save(id); apply(id); } };
})();
