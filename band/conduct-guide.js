// The lessons on /band/conduct.html: what a conductor does, one gesture at a time.
// Each lesson says what to do, draws it, and waits until it is done; then the next.
//
// The page hands in an `api` (see conduct.js): its events (ictus, press, release,
// balance), its state, and the few things a lesson may ask of it.

const ART = {
  // ink drawings, 120 × 64, stroke = currentColor; red for the moment that counts
  point: `<path d="M14 54 L80 22"/><circle cx="96" cy="16" r="5" class="accent fill"/><path d="M8 58 q6-6 10-4"/>`,
  beat: `<path d="M60 6 L60 50"/><path d="M60 50 q0 8 8 2 l18 -20" /><circle cx="60" cy="52" r="3.5" class="accent fill"/><path d="M54 12 l6 -6 6 6"/>`,
  tempo: `<circle cx="18" cy="32" r="5" class="accent fill"/><circle cx="46" cy="32" r="5"/><circle cx="74" cy="32" r="5"/><circle cx="102" cy="32" r="5"/><path d="M8 50 H112"/>`,
  start: `<path d="M24 54 L24 22 q0-8 8-2 l10 10"/><path d="M80 10 L80 48"/><circle cx="80" cy="50" r="3.5" class="accent fill"/><path d="M34 60 h-20 M90 60 h-20"/>`,
  dynamics: `<path d="M24 26 L24 40 q0 5 5 1 l8-8"/><path d="M78 8 L78 50 q0 9 9 2 l22-24"/><circle cx="78" cy="51" r="3.5" class="accent fill"/>`,
  select: `<path d="M12 56 L70 24"/><circle cx="88" cy="18" r="16" class="accent"/><circle cx="88" cy="18" r="3" class="accent fill"/><path d="M88 46 v-8 M80 42 l8-8 8 8" />`,
  cue: `<path d="M12 56 L70 26"/><path d="M84 14 l12 0 -6 9 z" class="accent fill"/><path d="M76 40 q14 10 28 0"/>`,
  release: `<path d="M60 14 a18 18 0 1 1 -16 10"/><path d="M44 24 l-4 -10 10 2" /><circle cx="60" cy="32" r="3" class="accent fill"/>`,
};

// the lessons' chords, in C (the key of the piece they use, K. 265)
const STRINGS_CHORD = [{ section: "violin", midi: 76 }, { section: "violin", midi: 72 }, { section: "viola", midi: 67 }, { section: "cello", midi: 48 }];
const HORNS_CHORD = [{ section: "horn", midi: 67 }, { section: "horn", midi: 64 }, { section: "horn", midi: 60 }];
const TUTTI_CHORD = [...STRINGS_CHORD, ...HORNS_CHORD, { section: "flute", midi: 76 }, { section: "clarinet", midi: 67 },
  { section: "trombone", midi: 48 }, { section: "bass", midi: 36 }, { section: "timpani", midi: 48 }];
// every note the lessons play outside the score, for the orchestra to load
export const GUIDE_NOTES = TUTTI_CHORD;
export const GUIDE_PIECE = { piece: "twinkle", level: "hard" };

export class Guide {
  constructor(api) {
    this.api = api;
    this.el = document.getElementById("guide");
    this.k = this.el.querySelector(".guide-kicker");
    this.t = this.el.querySelector(".guide-title");
    this.x = this.el.querySelector(".guide-text");
    this.art = this.el.querySelector(".guide-art");
    this.p = this.el.querySelector(".guide-progress");
    this.s = this.el.querySelector(".guide-status");
    this.el.querySelector("[data-act=skip]").addEventListener("click", (e) => { e.stopPropagation(); this.next(); });
    this.el.querySelector("[data-act=leave]").addEventListener("click", (e) => { e.stopPropagation(); this.leave(); });
    this.el.addEventListener("mousedown", (e) => e.stopPropagation());
    for (const type of ["ictus", "press", "release", "balance", "centre"]) {
      api.bus.addEventListener(type, (e) => { if (this.lesson && !this.passed) this.lesson[type]?.(e.detail); });
    }
    this.lessons = this.build();
  }

  build() {
    const g = this, api = this.api, o = api.orchestra;
    let timer = null;
    const every = (seconds, fn) => { clearInterval(timer); fn(); timer = setInterval(fn, seconds * 1000); };
    const stopTimer = () => { clearInterval(timer); timer = null; };
    return [
      {
        id: "point", title: "Point", art: ART.point,
        text: "Your forearm is the baton. Hold it level, pointing at the middle of the screen, and pinch with your middle finger: that is your centre. Do it again whenever the baton drifts sideways.",
        enter() { g.dots(0, 1); },
        centre() { g.dots(1, 1); g.pass(); },
        press() { g.say("the middle finger sets the centre; the index finger is for the players"); },
      },
      {
        id: "beat", title: "The beat", art: ART.beat,
        text: "A beat is a drop and a bounce: bring the baton down and let it spring back. The bottom of the drop is the moment the players watch. Give four beats.",
        enter() { this.n = 0; g.dots(0, 4); },
        ictus() { this.n += 1; g.dots(this.n, 4); if (this.n >= 4) g.pass(); },
      },
      {
        id: "tempo", title: "Keep time", art: ART.tempo,
        text: "Beat with the clicks, one beat on each. Steady beats hold the orchestra together.",
        enter() {
          this.n = 0; this.clicks = []; g.dots(0, 6);
          const period = 60 / 84;
          let k = 0;
          every(period, () => {
            const at = o.now + 0.05;
            o.tick(at, k % 4 === 0);
            this.clicks.push(at);
            if (this.clicks.length > 8) this.clicks.shift();
            setTimeout(() => g.pulse(), 50);
            k += 1;
          });
        },
        exit: stopTimer,
        ictus({ time }) {
          const off = Math.min(...this.clicks.map((c) => Math.abs(c - time)));
          if (off < 0.11) { this.n += 1; g.say(this.n > 1 ? "with the click" : ""); }
          else { this.n = 0; g.say(time < this.clicks[this.clicks.length - 1] ? "a little early" : "a little late"); }
          g.dots(this.n, 6);
          if (this.n >= 6) { stopTimer(); g.pass(); }
        },
      },
      {
        id: "start", title: "Bring them in", art: ART.start,
        text: "Give one beat to prepare: it tells them how fast. They come in on your next beat and play four bars, as fast as you beat.",
        enter() { api.startPhrase(4); this.began = false; g.dots(0, 2); },
        update() {
          if (!this.began && o.state === "playing") { this.began = true; g.dots(1, 2); g.say("they are playing; keep beating"); }
          if (this.began && o.state === "done") { g.dots(2, 2); g.pass(); }
          if (o.state === "held") g.say("they wait for your next beat");
        },
      },
      {
        id: "dynamics", title: "Loud and soft", art: ART.dynamics,
        text: "The size of the beat is how loud they play. Bring them in again: beat small for soft, then big for loud.",
        enter() { this.soft = this.loud = false; api.startPhrase(4); g.check(["Soft", false], ["Loud", false]); },
        update() {
          const d = api.state().dynamicIndex;
          if (o.state === "playing" && d !== null) {
            if (!this.soft && d <= 1) this.soft = true;
            if (this.soft && !this.loud && d >= 4) this.loud = true;
            g.check(["Soft", this.soft], ["Loud", this.loud]);
            if (this.soft && this.loud) { g.pass(); return; }
          }
          if (o.state === "done") { g.say("once more"); api.startPhrase(4); }
        },
      },
      {
        id: "select", title: "A section forward", art: ART.select,
        text: "Point at the cellos and hold the pinch: they light up and come forward. Raise your arm while holding to make them louder, then let go.",
        enter() {
          this.loud = false; api.highlight(["cello"]); g.check(["Hold the cellos", false], ["Louder", false], ["Let go", false]);
          every(2.4, () => o.chord(STRINGS_CHORD, 2.5, 0.7));
        },
        exit() { stopTimer(); api.highlight([]); },
        press({ pointed }) {
          if (pointed && pointed !== "cello") api.note(pointed, "the cellos are on the right");
          g.check(["Hold the cellos", pointed === "cello"], ["Louder", this.loud], ["Let go", false]);
        },
        balance({ type, gain }) {
          if (type === "cello" && gain >= 1.41) this.loud = true;
          g.check(["Hold the cellos", true], ["Louder", this.loud], ["Let go", false]);
        },
        release({ selected }) {
          if (selected === "cello" && this.loud) { g.check(["Hold the cellos", true], ["Louder", true], ["Let go", true]); g.pass(); }
        },
      },
      {
        id: "cue", title: "Cue an entrance", art: ART.cue,
        text: "A section that has waited needs your signal to come in. The horns are waiting: point at them and pinch. On the timeline, red marks show where entrances are.",
        enter() { api.highlight(["horn"]); g.dots(0, 1); every(2.4, () => o.chord(STRINGS_CHORD, 2.5, 0.6)); },
        exit() { stopTimer(); api.highlight([]); },
        press({ pointed }) {
          if (pointed === "horn") {
            o.chord(HORNS_CHORD, 2.6, 0.9);
            api.ripple("horn"); api.note("horn", "on cue");
            g.dots(1, 1); g.pass();
          } else if (pointed) api.note(pointed, "not yet: the horns");
        },
      },
      {
        id: "release", title: "The release", art: ART.release,
        text: "At the end, everyone stops together on your signal. They are holding the last chord: pinch to release it.",
        enter() { g.dots(0, 1); this.ring = setTimeout(() => o.chord(TUTTI_CHORD, 12, 0.75), 300); },
        exit() { clearTimeout(this.ring); setTimeout(() => { o.silence(); o.reset(); }, 700); },
        press() { o.cutoff(); g.dots(1, 1); g.pass(); },
      },
    ];
  }

  start() {
    this.el.hidden = false;
    this.api.orchestra.reset();
    this.show(0);
  }

  show(i) {
    this.lesson?.exit?.call(this.lesson);
    this.i = i;
    this.passed = false;
    if (i >= this.lessons.length) return this.done();
    const L = this.lessons[i];
    this.lesson = L;
    this.el.classList.remove("is-passed", "is-done");
    this.k.textContent = `Lesson ${i + 1} of ${this.lessons.length}`;
    this.t.textContent = L.title;
    this.x.textContent = L.text;
    this.art.innerHTML = `<svg viewBox="0 0 120 64" aria-hidden="true">${L.art}</svg>`;
    this.s.textContent = "";
    this.api.orchestra.silence();
    this.api.orchestra.reset();
    this.api.allowTransport(false);
    L.enter?.call(L);
  }

  update(dt) { if (this.lesson && !this.passed) this.lesson.update?.call(this.lesson, dt); }

  pass() {
    if (this.passed) return;
    this.passed = true;
    this.el.classList.add("is-passed");
    this.s.textContent = "";
    this.lesson?.exit?.call(this.lesson);
    this.lesson = { ...this.lesson, exit: null };
    setTimeout(() => { if (this.passed && this.i < this.lessons.length) this.show(this.i + 1); }, 1500);
  }

  next() { this.show(this.i + 1); }

  done() {
    this.lesson = null;
    this.el.classList.add("is-done");
    this.k.textContent = "Lessons";
    this.t.textContent = "You are ready";
    this.x.textContent = "Beat, bring them in, shape loud and soft, bring sections forward, cue the entrances on the timeline, and release the last chord.";
    this.art.innerHTML = "";
    this.p.innerHTML = "";
    this.s.textContent = "";
    try { localStorage.setItem("band-conduct-learned", "1"); } catch (e) { /* not kept */ }
    setTimeout(() => this.api.finishGuide(), 2600);
  }

  leave() {
    this.lesson?.exit?.call(this.lesson);
    this.lesson = null;
    this.el.hidden = true;
    this.api.leaveGuide();
  }

  // ---- the card's progress: dots, or a checklist; a line of feedback
  dots(n, of) { this.p.innerHTML = Array.from({ length: of }, (_, i) => `<i class="${i < n ? "is-on" : ""}"></i>`).join(""); }
  check(...items) { this.p.innerHTML = items.map(([label, ok]) => `<span class="${ok ? "is-on" : ""}">${ok ? "✓" : "○"} ${label}</span>`).join(""); }
  say(text) { this.s.textContent = text; }
  pulse() { this.p.classList.remove("is-pulse"); void this.p.offsetWidth; this.p.classList.add("is-pulse"); }
}
