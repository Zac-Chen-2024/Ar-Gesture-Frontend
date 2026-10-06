/* The funny layer's music and sound (/study-funny): a small synth on Web
   Audio, driven by funny.js through window.FunnyAudio. No files, no
   dependencies on the page. */
(() => {
  // ---------------------------------------------------------------- sound

  // A small synth on Web Audio (no files). The level (see LEVELS) sets what
  // the music does: which layers of the track play, the pool of chord
  // progressions, the key and the instrument of the hits.
  //
  // The track: 124 BPM, four on the floor, swung sixteenths, a four-voice pad
  // side-chained to the kick. It runs in 8-bar sections; each section plays
  // the next progression of the level's pool (sevenths, sus and add9 chords,
  // some moving every half bar); key changes wait for a section start. The
  // last bar of a section builds (snare roll, a riser, and from level 5 a
  // half-beat of silence) into a crash on the next downbeat.
  //
  // Hits land on the grid: while the track plays, a right word's sound (and
  // its whole hit) waits for the next eighth note, unless the last one was
  // under 50 ms ago. On-beat hits play chord tones, off-beat hits scale tones,
  // rising and falling over two octaves with the combo. A break tape-stops.
  window.FunnyAudio = (() => {
    let ac = null;
    let out = null; // dry bus
    let verb = null; // reverb send
    let bedBus = null; // pads and bass, ducked by the kick
    let echo = null; // dotted-eighth echo
    let noise = null;
    let on = (() => { try { return localStorage.getItem("funnySound") !== "off"; } catch (_) { return true; } })();

    const BPM = 124;
    const BEAT = 60 / BPM;
    const SIXTEENTH = BEAT / 4;
    const SWING = SIXTEENTH * 0.14; // late off-sixteenths
    // chord progressions as semitones from A3 (220 Hz); `per` = sixteenths per chord
    const PROGS = {
      A: { per: 16, chords: [[0, 3, 7], [-4, 0, 3, 7], [3, 7, 10], [-2, 2, 5]] }, // Am Fmaj7 C G
      B: { per: 16, chords: [[-4, 0, 3, 7], [-2, 2, 5], [0, 3, 7, 10], [0, 3, 7]] }, // Fmaj7 G Am7 Am
      C: { per: 16, chords: [[0, 3, 7, 10], [5, 8, 12, 15], [-2, 2, 5, 8], [3, 7, 10, 14]] }, // Am7 Dm7 G7 Cmaj7
      D: { per: 16, chords: [[-4, 0, 3, 7], [-5, -2, 2, 5], [-7, -4, 0, 3], [-9, -5, -2, 2]] }, // Fmaj7 Em7 Dm7 Cmaj7
      E: { per: 16, chords: [[0, 3, 7], [-5, -2, 2], [-4, 0, 3], [3, 7, 10]] }, // Am Em F C
      F: { per: 16, chords: [[5, 8, 12], [0, 3, 7], [1, 5, 8], [3, 7, 10]] }, // Dm Am Bb C
      G: { per: 8, chords: [[0, 3, 7], [0, 3, 7, 10], [-2, 2, 5], [-2, 2, 5, 7], [-4, 0, 3, 7], [-4, 0, 3], [-5, 0, 2], [-5, -1, 2]] }, // Am Am7 | G Gsus | Fmaj7 F | Esus4 E
      H: { per: 16, chords: [[-4, 0, 3, 5], [3, 5, 10], [-2, 2, 5], [0, 3, 7, 10]] } // Fadd9 Csus2 G Am7
    };
    const SCALE = [0, 2, 3, 5, 7, 8, 10]; // A natural minor, for off-beat melody notes
    const hz = (semi) => 220 * 2 ** (semi / 12);
    // the hook: chord-tone indices per sixteenth (null = rest), one bar
    const HOOK = [4, null, 3, null, 2, null, 3, 4, null, 5, 4, null, 3, null, 2, null];

    let cfg = { layers: new Set(), progs: ["A"], key: 0, voice: "pluck", padCut: 500, fever: false, level: 0 };
    let bar = 0;
    let timer = null;
    let nextBeat = 0;
    let trackStart = 0; // audio time of sixteenth 0 (the grid)
    let sixteenth = 0;
    let section = 0; // 8-bar sections
    let progName = "A";
    let key = 0; // the key in use (level changes apply at a section start)
    let pad = null;
    let onBeat = null;
    let onSection = null;
    let breakdown = false; // in fever, every third section drops the drums and bass
    const has = (layer) => cfg.layers.has(layer);
    const progNow = () => PROGS[progName];
    const chordAt = (six) => {
      const p = progNow();
      return p.chords[Math.floor(six / p.per) % p.chords.length].map((n) => n + key);
    };
    const chordNow = () => chordAt(Math.max(0, sixteenth - 1));

    function audio() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
        } catch (_) {
          return null;
        }
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        const master = ac.createGain();
        master.gain.value = 0.8;
        master.connect(comp).connect(ac.destination);
        out = ac.createGain();
        out.connect(master);
        const len = ac.sampleRate * 1.6;
        const ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
        }
        const conv = ac.createConvolver();
        conv.buffer = ir;
        verb = ac.createGain();
        verb.gain.value = 0.35;
        verb.connect(conv).connect(master);
        bedBus = ac.createGain();
        bedBus.connect(out);
        const delay = ac.createDelay(1.5);
        delay.delayTime.value = BEAT * 0.75;
        const fb = ac.createGain();
        fb.gain.value = 0.38;
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2600;
        const wet = ac.createGain();
        wet.gain.value = 0.55;
        delay.connect(lp).connect(fb).connect(delay);
        lp.connect(wet).connect(master);
        echo = ac.createGain();
        echo.connect(delay);
        noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    ["pointerdown", "keydown"].forEach((t) => addEventListener(t, () => on && audio(), { passive: true }));
    const ready = () => on && audio();

    function env(g, t0, gain, attack, decay) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    }

    function route(node, pan = 0, send = 0, { bus = null, delay = 0 } = {}) {
      const dest = bus === "bed" ? bedBus : out;
      const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (p) {
        p.pan.value = pan;
        node.connect(p).connect(dest);
      } else {
        node.connect(dest);
      }
      if (send) {
        const s = ac.createGain();
        s.gain.value = send;
        node.connect(s).connect(verb);
      }
      if (delay) {
        const d = ac.createGain();
        d.gain.value = delay;
        node.connect(d).connect(echo);
      }
    }

    function tone(freq, { type = "triangle", t = 0, attack = 0.002, decay = 0.2, gain = 0.3, bend = 0, pan = 0, send = 0, bus = null, delay = 0 } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t0 + attack + decay);
      env(g, t0, gain, attack, decay);
      o.connect(g);
      route(g, pan, send, { bus, delay });
      o.start(t0);
      o.stop(t0 + attack + decay + 0.05);
    }

    // two detuned oscillators through a closing low-pass
    function pluck(freq, { t = 0, gain = 0.16, decay = 0.35, pan = 0, send = 0.3, bright = 1, bus = null, delay = 0, type = "sawtooth" } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 6;
      f.frequency.setValueAtTime(900 + 4200 * bright, t0);
      f.frequency.exponentialRampToValueAtTime(500, t0 + decay * 0.8);
      const g = ac.createGain();
      env(g, t0, gain, 0.003, decay);
      [-8, 8].forEach((cents) => {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = cents;
        o.connect(f);
        o.start(t0);
        o.stop(t0 + decay + 0.05);
      });
      f.connect(g);
      route(g, pan, send, { bus, delay });
    }

    // an FM bell: a sine whose pitch is wobbled by another at 3.5x, fading
    function bell(freq, { t = 0, gain = 0.14, decay = 0.9, pan = 0, send = 0.45, delay = 0.2 } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const car = ac.createOscillator();
      const mod = ac.createOscillator();
      const idx = ac.createGain();
      const g = ac.createGain();
      car.frequency.value = freq;
      mod.frequency.value = freq * 3.5;
      idx.gain.setValueAtTime(freq * 2.2, t0);
      idx.gain.exponentialRampToValueAtTime(1, t0 + decay);
      mod.connect(idx).connect(car.frequency);
      env(g, t0, gain, 0.002, decay);
      car.connect(g);
      route(g, pan, send, { delay });
      [car, mod].forEach((o) => { o.start(t0); o.stop(t0 + decay + 0.05); });
    }

    function noiseHit({ t = 0, type = "highpass", freq = 3000, q = 0.8, decay = 0.05, gain = 0.2, pan = 0, send = 0 } = {}) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const src = ac.createBufferSource();
      src.buffer = noise;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      src.connect(f).connect(g);
      route(g, pan, send);
      src.start(t0);
      src.stop(t0 + decay + 0.02);
    }

    const kick = (t = 0, gain = 0.5) => tone(160, { type: "sine", t, decay: 0.16, gain, bend: 0.28 });
    const crashCymbal = (t = 0, gain = 0.18) => noiseHit({ t, freq: 6500, decay: 1.4, gain, send: 0.5 });

    // the hit's instrument, by level
    function voice(freq, pan, lift) {
      const c = chordNow();
      switch (cfg.voice) {
        case "square":
          pluck(freq, { pan, type: "square", gain: 0.11 + lift, decay: 0.28, bright: 0.8, send: 0.3, delay: 0.1 });
          break;
        case "bell":
          bell(freq, { pan, gain: 0.13 + lift });
          pluck(freq / 2, { pan, gain: 0.06, decay: 0.2, bright: 0.4 });
          break;
        case "stab":
          c.forEach((n, i) => pluck(hz(n + 12), { pan: pan + (i - 1) * 0.3, gain: 0.07 + lift / 2, decay: 0.22, bright: 1.3, send: 0.35 }));
          pluck(freq, { pan, gain: 0.08, decay: 0.3, bright: 1 });
          break;
        case "glass":
          bell(freq * 2, { pan, gain: 0.08, decay: 1.4, send: 0.6, delay: 0.35 });
          tone(freq, { type: "sine", pan, decay: 0.9, gain: 0.12 + lift, send: 0.5 });
          pluck(freq, { pan, gain: 0.06, decay: 0.2, bright: 1.2 });
          break;
        default:
          pluck(freq, { pan, gain: 0.15 + lift, decay: 0.32, bright: 0.6, send: 0.3 });
      }
    }

    // ---- the track
    function startPad() {
      const t0 = ac.currentTime;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 3;
      f.frequency.value = cfg.padCut;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.085, t0 + 0.8);
      f.connect(g);
      route(g, 0, 0.35, { bus: "bed" });
      // four chord voices, each a detuned pair, plus the top note an octave up
      const voices = [];
      for (let n = 0; n < 5; n++) {
        for (const cents of [-12, 12]) {
          const o = ac.createOscillator();
          o.type = "sawtooth";
          o.detune.value = cents;
          o.connect(f);
          o.start(t0);
          voices.push(o);
        }
      }
      pad = { voices, f, g };
      padChord(t0, chordNow());
    }

    function padChord(t, c) {
      const notes = [0, 1, 2, 3].map((i) => c[i] ?? c[0] + 12).concat([c[c.length - 1] + 12]);
      pad.voices.forEach((o, k) => o.frequency.setValueAtTime(hz(notes[Math.floor(k / 2)]), t));
    }

    function stopPad(tape) {
      const t0 = ac.currentTime;
      const end = tape ? 0.7 : 0.4;
      if (tape) pad.voices.forEach((o) => o.frequency.exponentialRampToValueAtTime(18, t0 + end));
      pad.g.gain.cancelScheduledValues(t0);
      pad.g.gain.setValueAtTime(Math.max(0.0001, pad.g.gain.value), t0);
      pad.g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
      pad.voices.forEach((o) => o.stop(t0 + end + 0.05));
      pad = null;
    }

    function pump(t) {
      const depth = cfg.fever ? 0.12 : has("bass") ? 0.3 : 0.45;
      const at = ac.currentTime + t;
      bedBus.gain.cancelScheduledValues(at);
      bedBus.gain.setValueAtTime(depth, at);
      bedBus.gain.linearRampToValueAtTime(1, at + BEAT * 0.6);
    }

    function bass(freq, t, len) {
      tone(freq, { type: "sawtooth", t, attack: 0.004, decay: len, gain: 0.09, bus: "bed" });
      tone(freq / 2, { type: "sine", t, attack: 0.004, decay: len, gain: 0.16, bus: "bed" });
    }

    function schedule() {
      while (nextBeat < ac.currentTime + 0.12) {
        const pos = sixteenth % 16;
        const barNow = Math.floor(sixteenth / 16);
        const inSection = barNow % 8;
        const swing = pos % 2 ? SWING : 0;
        const t = nextBeat - ac.currentTime;
        const ts = t + swing; // swung time for hats, bass and the like
        if (pos === 0) {
          bar = barNow;
          if (inSection === 0) {
            // a new section: the next progression of the level, the level's key
            if (barNow > 0) section++;
            progName = cfg.progs[section % cfg.progs.length];
            key = cfg.key;
            const was = breakdown;
            breakdown = cfg.fever && section % 3 === 2;
            if (barNow > 0 && has("crash") && !breakdown) crashCymbal(t, 0.14);
            if (barNow > 0 && has("kick") && !breakdown) kick(t, 0.8);
            if (pad) {
              // a breakdown opens the pad's filter over its 8 bars
              const at = ac.currentTime + t;
              pad.f.frequency.cancelScheduledValues(at);
              pad.f.frequency.setValueAtTime(breakdown ? 700 : cfg.padCut, at);
              if (breakdown) pad.f.frequency.exponentialRampToValueAtTime(cfg.padCut, at + BEAT * 30);
            }
            if (onSection && (breakdown || was)) setTimeout(() => onSection({ breakdown, drop: was && !breakdown }), Math.max(0, t * 1000));
          }
        }
        const c = chordAt(sixteenth);
        if (pad && sixteenth % progNow().per === 0) padChord(ac.currentTime + t, c);
        const next = chordAt(sixteenth + (progNow().per - (sixteenth % progNow().per)));
        const tones = [c[0], c[1], c[2], c[0] + 12, c[1] + 12, c[2] + 12];
        const building = inSection === 7 && has("build");
        const gap = building && cfg.level >= 5 && pos >= 14; // the breath before the drop
        const drums = !breakdown; // a breakdown keeps the pad, the arp and the hook
        if (pos % 4 === 0 && !gap) {
          if (has("kick") && drums) kick(t, 0.55);
          if (drums) pump(t);
          if (onBeat) setTimeout(() => onBeat(pos, bar), Math.max(0, t * 1000));
        }
        if (has("kick2") && pos === 14 && barNow % 2 === 1 && !gap && drums) kick(t, 0.35); // a pickup kick
        if (!gap && drums) {
          if (pos % 4 === 2 && (has("hat") || has("open"))) noiseHit({ t: ts, freq: 8500, decay: has("open") ? 0.16 : 0.05, gain: has("open") ? 0.07 : 0.05, send: 0.1 });
          if (has("hat16") && pos % 2 === 1) noiseHit({ t: ts, freq: 9500, decay: 0.025, gain: pos % 4 === 3 ? 0.035 : 0.022, pan: pos % 4 === 1 ? -0.3 : 0.3 });
          if (has("ride") && pos % 2 === 0) noiseHit({ t, type: "bandpass", freq: 7000, q: 2, decay: 0.3, gain: 0.025, send: 0.3 });
          // bass: offbeat roots, a passing note into the next chord; rolling octaves in fever
          if (has("bass")) {
            const root = c[0] - 12;
            if (has("roll")) {
              if (pos % 2 === 0 ? pos % 4 === 2 : true) bass(hz(root + (pos % 4 === 3 ? 12 : 0)), ts, SIXTEENTH * 0.9);
            } else if (pos % 4 === 2) {
              const approach = pos === 14 && next[0] !== c[0] ? next[0] - 12 + (next[0] > c[0] ? -1 : 1) : root;
              bass(hz(approach), ts, SIXTEENTH * 1.6);
            }
          }
          if (has("sub") && pos === 0) tone(hz(c[0] - 24), { type: "sine", t, decay: BEAT * 3.2, gain: 0.13, bus: "bed" });
          if (has("clap") && (pos === 4 || pos === 12) && !building) {
            noiseHit({ t, type: "bandpass", freq: 1400, q: 0.8, decay: 0.16, gain: 0.2, send: 0.35 });
            noiseHit({ t: t + 0.011, type: "bandpass", freq: 1700, q: 0.8, decay: 0.12, gain: 0.14 });
          }
          if (has("stab") && (pos === 3 || pos === 6 || pos === 11)) c.forEach((n) => pluck(hz(n + 12), { t: ts, gain: 0.035, decay: 0.12, bright: 1.1, send: 0.2 }));
          if (has("perc") && pos >= 12 && barNow % 2 === 1) tone(140 - (pos - 12) * 12, { type: "sine", t, decay: 0.12, gain: 0.18, bend: 0.6 });
        }
        if (!gap) {
          if (has("arp")) {
            const up = [0, 1, 2, 3, 4, 5, 4, 3][pos % 8];
            pluck(hz(tones[up] + 12), { t: ts, gain: breakdown ? 0.06 : 0.045, decay: breakdown ? 0.22 : 0.13, bright: 0.7, send: breakdown ? 0.4 : 0.15, delay: 0.35, pan: pos % 2 ? 0.35 : -0.35 });
          }
          if (has("hook") && HOOK[pos] !== null) pluck(hz(tones[HOOK[pos]] + 12), { t: ts, gain: 0.07, decay: 0.28, bright: 1, send: 0.3, delay: 0.4, type: "square" });
        }
        // the build: a snare roll thickening through the bar and a riser under it
        if (building && !gap) {
          const every = pos < 8 ? 2 : 1;
          if (pos % every === 0) noiseHit({ t, type: "bandpass", freq: 1800 + pos * 60, q: 0.9, decay: 0.08, gain: 0.05 + pos * 0.01, send: 0.2 });
          if (pos === 0) riser(t, BEAT * 3.5);
        }
        nextBeat += SIXTEENTH;
        sixteenth++;
      }
    }

    // white noise swept up through a band-pass, for the build
    function riser(t, len) {
      if (!ready()) return;
      const t0 = ac.currentTime + t;
      const src = ac.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 2.5;
      f.frequency.setValueAtTime(400, t0);
      f.frequency.exponentialRampToValueAtTime(9000, t0 + len);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + len);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.05);
      src.connect(f).connect(g);
      route(g, 0, 0.3);
      src.start(t0);
      src.stop(t0 + len + 0.1);
    }

    function startTrack() {
      if (timer) return;
      breakdown = false;
      nextBeat = ac.currentTime + 0.05;
      trackStart = nextBeat;
      sixteenth = 0;
      section = 0;
      bar = 0;
      progName = cfg.progs[0];
      key = cfg.key;
      timer = setInterval(schedule, 25);
    }

    function stopTrack(tape) {
      clearInterval(timer);
      timer = null;
      if (pad) stopPad(tape);
      if (bedBus) {
        bedBus.gain.cancelScheduledValues(ac.currentTime);
        bedBus.gain.setValueAtTime(1, ac.currentTime);
      }
    }

    return {
      get on() { return on; },
      set on(v) {
        on = v;
        try { localStorage.setItem("funnySound", v ? "on" : "off"); } catch (_) { /* storage off */ }
        if (v) audio();
        else stopTrack(false);
      },
      set onBeat(fn) { onBeat = fn; },
      set onSection(fn) { onSection = fn; },
      get playing() { return !!timer; },

      // ms until the next eighth note (0 if the last one just passed, or no track)
      quantize() {
        if (!timer || !ac) return 0;
        const eighth = BEAT / 2;
        const since = (ac.currentTime - trackStart) % eighth;
        return since < 0.05 ? 0 : Math.round((eighth - since) * 1000);
      },

      // a level's music: layers, progression, key, voice; the track starts
      // with the first layer and stops when there is none
      level(c) {
        cfg = c;
        if (!ready()) return;
        if (!c.layers.size) return stopTrack(false);
        startTrack();
        if (has("pad") && !pad) startPad();
        if (!has("pad") && pad) stopPad(false);
        if (pad) pad.f.frequency.setTargetAtTime(c.padCut, ac.currentTime, 0.3);
      },
      stop(tape = false) {
        if (ac) stopTrack(tape);
      },

      hit(combo, tier, pan = 0) {
        if (!ready()) return;
        const c = chordNow();
        // up and down over two octaves as the combo grows
        const wave = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1][(combo - 1) % 14];
        const onBeat = !timer || Math.round((ac.currentTime - trackStart) / (BEAT / 2)) % 2 === 0;
        let note;
        if (onBeat) {
          note = c[wave % c.length] + 12 * Math.floor(wave / c.length); // a chord tone
        } else {
          const deg = wave + 1; // a scale step between chord tones
          note = SCALE[deg % 7] + key + 12 * Math.floor(deg / 7);
        }
        noiseHit({ freq: 3500, decay: 0.018, gain: 0.22 + tier * 0.03, pan });
        voice(hz(note + 12), pan, tier * 0.012);
        kick(0, 0.45 + tier * 0.08);
      },

      // Start: a small rising arpeggio (C E G C) and a soft kick
      start() {
        if (!ready()) return;
        [15, 19, 22, 27].forEach((semi, i) => pluck(hz(semi), { t: i * 0.06, gain: 0.08, decay: 0.32, bright: 1.15, send: 0.35, pan: (i - 1.5) * 0.25 }));
        kick(0, 0.35);
      },

      // a level up: a quick sweep into a chord stab
      levelUp(lv) {
        if (!ready()) return;
        const t0 = ac.currentTime;
        const src = ac.createBufferSource();
        src.buffer = noise;
        const f = ac.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 3;
        f.frequency.setValueAtTime(600, t0);
        f.frequency.exponentialRampToValueAtTime(7000, t0 + 0.22);
        const g = ac.createGain();
        env(g, t0, 0.12, 0.15, 0.1);
        src.connect(f).connect(g);
        route(g, 0, 0.3);
        src.start(t0);
        src.stop(t0 + 0.3);
        const c = chordNow();
        c.forEach((n, i) => pluck(hz(n + 12 + (lv % 2 ? 0 : 12)), { t: 0.2, gain: 0.08, decay: 0.45, bright: 1.2, send: 0.45, pan: (i - 1) * 0.4 }));
        kick(0.2, 0.6);
      },

      milestone() {
        if (!ready()) return;
        const c = chordNow();
        kick(0, 0.8);
        crashCymbal(0, 0.2);
        [0, 7, 12].forEach((iv) => pluck(hz(c[0] + iv), { gain: 0.12, decay: 1.1, bright: 1.2, send: 0.6 }));
      },

      finish(tier) {
        if (!ready()) return;
        const c = chordNow();
        for (let i = 0; i < 7; i++) {
          pluck(hz(c[i % 3] + 12 * (1 + Math.floor(i / 3))), { t: i * 0.045, gain: 0.1, decay: 0.4, bright: 1, send: 0.5, pan: (i / 6) * 1.2 - 0.6 });
        }
        crashCymbal(0.3, 0.12 + tier * 0.03);
        kick(0.3, 0.6);
      },

      save() {
        pluck(hz(chordNow()[2] + 12), { gain: 0.08, decay: 0.2, bright: 0.4 });
      },
      miss() {
        tone(150, { type: "sine", decay: 0.09, gain: 0.14, bend: 0.8 });
      },
      crash() {
        tone(110, { type: "sine", decay: 0.35, gain: 0.35, bend: 0.4 });
        noiseHit({ type: "lowpass", freq: 600, decay: 0.25, gain: 0.25 });
      },

      // fever: a power-up sweep into a hit / a power-down when it ends
      fever(onNow) {
        if (!ready()) return;
        const t0 = ac.currentTime;
        const o = ac.createOscillator();
        const f = ac.createBiquadFilter();
        const g = ac.createGain();
        o.type = "sawtooth";
        f.type = "lowpass";
        f.Q.value = 8;
        o.frequency.setValueAtTime(onNow ? 110 : 440, t0);
        o.frequency.exponentialRampToValueAtTime(onNow ? 880 : 55, t0 + 0.45);
        f.frequency.setValueAtTime(onNow ? 400 : 4000, t0);
        f.frequency.exponentialRampToValueAtTime(onNow ? 6000 : 200, t0 + 0.45);
        env(g, t0, 0.14, 0.02, 0.5);
        o.connect(f).connect(g);
        route(g, 0, 0.4);
        o.start(t0);
        o.stop(t0 + 0.6);
        if (onNow) {
          kick(0.45, 0.9);
          crashCymbal(0.45, 0.22);
        }
      },

      decay() {
        const root = chordNow()[0];
        pluck(hz(root + 12), { gain: 0.09, decay: 0.18, bright: 0.3 });
        pluck(hz(root + 5), { t: 0.09, gain: 0.09, decay: 0.3, bright: 0.2 });
      },
      tick() {
        noiseHit({ type: "bandpass", freq: 2400, q: 6, decay: 0.03, gain: 0.12 });
      },

      grade(g) {
        if (!ready()) return;
        kick(0, 0.9);
        noiseHit({ type: "lowpass", freq: 900, decay: 0.12, gain: 0.3 });
        const up = { S: [0, 4, 7, 12, 16, 19], A: [0, 4, 7, 12], B: [0, 4, 7], C: [0, 3] }[g];
        up.forEach((iv, i) => pluck(hz(3 + iv + 12), { t: 0.1 + i * 0.07, gain: 0.11, decay: 0.7, bright: 1, send: 0.5 }));
        if (g === "S") crashCymbal(0.1 + up.length * 0.07, 0.2);
      }
    };
  })();

})();
