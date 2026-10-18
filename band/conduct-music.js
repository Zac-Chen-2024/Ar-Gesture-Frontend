// The orchestra for /band/conduct.html: Mozart's scores, sampled instruments, and
// a transport that follows the conductor's beats.
//
// Pieces (public domain), arranged here for a chamber orchestra:
// - the theme of the Variations on "Ah, vous dirai-je, Maman", K. 265, in C major:
//   the theme for the strings, then a variation for everyone;
// - the opening of the Symphony No. 40 in G minor, K. 550: the violas' pulse, the
//   violins' sighing theme over it, then again with the winds and horns.
// A level keeps a part of the orchestra on stage: Easy the strings, Medium the
// strings and winds, Hard everyone the piece has. The entrances to cue follow
// from the arrangement: each section's first entry after the start.
//
// Samples: FluidR3 GM by Frank Wen, served by gleitz/midi-js-soundfonts (CC BY 3.0).
//
// Following: the first beat is the preparation, the orchestra comes in on the
// second. Each later beat pulls the tempo toward the interval just conducted and
// leans the next beat's rate so the music lands on it, without a jump. With no
// beat for a while the orchestra holds (Easy keeps playing), and picks up again on
// the next one.

const SAMPLE_URL = "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM";
const FOLDER = {
  violin: "violin", viola: "viola", cello: "cello", bass: "contrabass",
  flute: "flute", oboe: "oboe", clarinet: "clarinet", bassoon: "bassoon",
  horn: "french_horn", trumpet: "trumpet", trombone: "trombone", timpani: "timpani",
};
// attack (s), release time constant (s), and level for each section
const VOICE = {
  violin: [0.05, 0.18, 0.55], viola: [0.06, 0.2, 0.42], cello: [0.06, 0.22, 0.5], bass: [0.05, 0.25, 0.5],
  flute: [0.03, 0.12, 0.42], oboe: [0.03, 0.12, 0.36], clarinet: [0.03, 0.12, 0.36], bassoon: [0.03, 0.14, 0.4],
  horn: [0.07, 0.2, 0.34], trumpet: [0.02, 0.1, 0.38], trombone: [0.04, 0.16, 0.36], timpani: [0.003, 0.5, 0.65],
};
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const sampleName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const SECTION_NAMES = { violin: "violins", viola: "violas", cello: "cellos", bass: "basses", flute: "flutes",
  oboe: "oboes", clarinet: "clarinets", bassoon: "bassoons", horn: "horns", trumpet: "trumpets",
  trombone: "trombones", timpani: "timpani" };

export const BEATS_PER_BAR = 4;
const STRINGS = ["violin", "viola", "cello", "bass"];
const WINDS = ["flute", "oboe", "clarinet", "bassoon"];
export const LEVELS = [
  { id: "easy", label: "Easy", sections: STRINGS, holds: false, tolerance: 2 },
  { id: "medium", label: "Medium", sections: [...STRINGS, ...WINDS], holds: true, tolerance: 1 },
  { id: "hard", label: "Hard", sections: null, holds: true, tolerance: 1 }, // everyone the piece has
];

// ---------------------------------------------------------------- arranging
const pc = (m) => ((m % 12) + 12) % 12;
// the chord tone at least a third below a melody note
function below(p, tones) {
  for (let q = p - 3; q > p - 12; q--) if (tones.includes(pc(q))) return q;
  return p - 12;
}
// the chord tones between lo and hi (midi), for pads
function voicing(tones, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (tones.includes(pc(m))) out.push(m);
  return out;
}
function timed(melody, from = 0) {
  const out = [];
  let t = from;
  for (const [p, d] of melody) { if (p !== null) out.push([t, p, d]); t += d; }
  return out;
}

// ---- K. 265: the theme, C major, two chords a bar
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69;
const TW_A = [[C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2],
              [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2]];
const TW_B = [[G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2]];
const TW_MELODY = [...TW_A, ...TW_B, ...TW_B, ...TW_A]; // 12 bars
const TW_HARMONY = "CC FC FC GC CG CG CG CG CC FC FC GC".replace(/ /g, "").split("");
const TW_CHORD = { C: [0, 4, 7], F: [5, 9, 0], G: [7, 11, 2, 5] };
const TW_ROOT = { C: 48, F: 41, G: 43 };

function twinkle() {
  const notes = [];
  const add = (section, beat, midi, beats, vel) => notes.push({ section, beat, midi, beats, vel });
  const mel = timed(TW_MELODY);
  const chordAt = (b) => TW_HARMONY[Math.floor((b % 48) / 2)];
  for (const pass of [0, 1]) {
    const o = pass * 48;
    for (const [b, p, d] of mel) add("violin", o + b, p + 12, d, pass ? 0.9 : 0.72);
    if (!pass) {
      // the theme: violas a third under the tune, cellos and (from bar 5) basses on the roots
      for (const [b, p, d] of mel) add("viola", o + b, below(p, TW_CHORD[chordAt(b)]), d, 0.6);
      for (let b = 0; b < 48; b += 2) add("cello", o + b, TW_ROOT[chordAt(b)], 2, 0.7);
      for (let b = 16; b < 48; b += 2) add("bass", o + b, TW_ROOT[chordAt(b)] - 12, 2, 0.62);
      continue;
    }
    // the variation: violas run in eighths through the chord, cellos on every beat
    for (let b = 0; b < 48; b += 0.5) {
      const tones = voicing(TW_CHORD[chordAt(b)], 55, 72);
      add("viola", o + b, tones[Math.floor(b * 2) % tones.length], 0.5, 0.55);
    }
    for (let b = 0; b < 48; b += 1) add("cello", o + b, TW_ROOT[chordAt(b)] + (b % 2 ? 7 : 0), 1, 0.8);
    for (let b = 0; b < 48; b += 2) add("bass", o + b, TW_ROOT[chordAt(b)] - 12, 2, 0.8);
    // winds: flutes on the tune, clarinets a third under, bassoons on the roots; oboes from bar 17
    for (const [b, p, d] of mel) {
      add("flute", o + b, p + 12, d, 0.72);
      add("clarinet", o + b, below(p, TW_CHORD[chordAt(b)]) + 12, d, 0.62);
      if (b >= 16) add("oboe", o + b, p + 12, d, 0.66);
    }
    for (let b = 0; b < 48; b += 2) add("bassoon", o + b, TW_ROOT[chordAt(b)] + 12, 2, 0.6);
    // brass: horns hold the chord; trombones from bar 17; trumpets and timpani on the last phrase
    for (let b = 0; b < 48; b += 2) {
      const c = chordAt(b);
      for (const m of voicing(TW_CHORD[c], 57, 67).slice(-2)) add("horn", o + b, m, 2, 0.58);
      if (b >= 16) for (const m of [TW_ROOT[c] + 12, TW_ROOT[c] + 19]) add("trombone", o + b, m, 2, 0.6);
    }
    for (const [b, p, d] of mel) if (b >= 32) add("trumpet", o + b, p + 12, d, 0.8);
    for (let b = 32; b < 48; b += 2) add("timpani", o + b, chordAt(b) === "G" ? 43 : 48, 1, b % 4 ? 0.7 : 0.95);
  }
  return notes;
}

// ---- K. 550: the opening, G minor; the first bar is the violas' alone, and the
// violins' upbeat at its end
const Bb4 = 70, C5 = 72, D5 = 74, Eb5 = 75, F5 = 77, Gb5 = 78, G5 = 79, A5 = 81, Bb5 = 82;
const FORTY_THEME = [
  [D5, 1], [Eb5, 0.5], [D5, 0.5], [D5, 1], [Eb5, 0.5], [D5, 0.5],
  [D5, 1], [Bb5, 1], [null, 1], [Bb5, 0.5], [A5, 0.5],
  [G5, 1], [G5, 0.5], [F5, 0.5], [Eb5, 1], [Eb5, 0.5], [D5, 0.5],
  [C5, 1], [C5, 1], [null, 1], [D5, 0.5], [C5, 0.5],
  [C5, 1], [D5, 0.5], [C5, 0.5], [C5, 1], [D5, 0.5], [C5, 0.5],
  [C5, 1], [A5, 1], [null, 1], [A5, 0.5], [G5, 0.5],
  [Gb5, 1], [Gb5, 0.5], [Eb5, 0.5], [D5, 1], [D5, 0.5], [C5, 0.5],
  [Bb4, 1], [Bb4, 1], [null, 1], [Eb5, 0.5], [D5, 0.5],
]; // 8 bars, ending on the upbeat into the next
// two chords a bar, over the 9 bars of a statement (the violas' bar first)
const FORTY_HARMONY = "gg gg gg gc DD DD DD DD gg".replace(/ /g, "").split("");
const FORTY_CHORD = { g: [7, 10, 2], c: [0, 3, 7], D: [2, 6, 9, 0] };
const FORTY_ROOT = { g: 43, c: 48, D: 50 };

function forty() {
  const notes = [];
  const add = (section, beat, midi, beats, vel) => notes.push({ section, beat, midi, beats, vel });
  const chordAt = (b) => FORTY_HARMONY[Math.min(17, Math.floor(b / 2))];
  // statement 1: bars 1–9; statement 2: bars 10–17 (its bar 9 is the final bar 18)
  for (const pass of [0, 1]) {
    const o = pass * 32;          // the second statement starts a bar early: its violas' bar is bar 9
    const vel = pass ? 0.88 : 0.7;
    // the upbeat, then the theme
    if (!pass) { add("violin", 3, Eb5, 0.5, 0.7); add("violin", 3.5, D5, 0.5, 0.7); }
    for (const [b, p, d] of timed(FORTY_THEME, 4)) add("violin", o + b, p, d, vel);
    // the violas' pulse: eighths between two chord tones, all along
    for (let b = pass ? 4 : 0; b < 36; b += 0.5) {
      const tones = voicing(FORTY_CHORD[chordAt(b)], 58, 66);
      add("viola", o + b, tones[(Math.floor(b * 2) % 2) ? 1 : 0] ?? tones[0], 0.5, pass ? 0.55 : 0.48);
    }
    // cellos and basses: the root on the first and third beats, from the theme on
    for (let b = 4; b < 36; b += 2) {
      add("cello", o + b, FORTY_ROOT[chordAt(b)], 1, vel * 0.85);
      add("bass", o + b, FORTY_ROOT[chordAt(b)] - 12, 1, vel * 0.8);
    }
    if (!pass) continue;
    // the winds sigh with the violins: flutes and oboes on the theme an octave up from
    // its fifth bar; clarinets and bassoons hold the harmony; horns sustain
    for (const [b, p, d] of timed(FORTY_THEME, 4)) {
      if (b >= 20) add("flute", o + b, p + 12, d, 0.6);
      if (b >= 4) add("oboe", o + b, p, d, 0.5);
    }
    for (let b = 4; b < 36; b += 2) {
      const tones = voicing(FORTY_CHORD[chordAt(b)], 55, 72);
      add("clarinet", o + b, tones[tones.length - 2] ?? tones[0], 2, 0.5);
      add("bassoon", o + b, FORTY_ROOT[chordAt(b)] + 12, 2, 0.52);
      for (const m of voicing(FORTY_CHORD[chordAt(b)], 57, 67).slice(-2)) add("horn", o + b, m, 2, 0.5);
    }
  }
  // the final bar (18): G minor, everyone
  const end = 68;
  for (const [section, midi] of [["violin", 79], ["violin", 70], ["viola", 62], ["cello", 43], ["bass", 31],
    ["flute", 79], ["oboe", 74], ["clarinet", 67], ["bassoon", 55], ["horn", 62], ["horn", 58]]) add(section, end, midi, 4, 0.85);
  return notes;
}

export const PIECES = [
  { id: "twinkle", title: "Twinkle Variations", detail: "Mozart · Variations, K. 265", bars: 24, build: twinkle,
    // pp p mp mf f ff, per bar
    marked: Array.from({ length: 24 }, (_, b) => (b < 4 ? 1 : b < 8 ? 2 : b < 12 ? 3 : b < 16 ? 3 : b < 20 ? 4 : 5)) },
  { id: "forty", title: "Symphony No. 40", detail: "Mozart · Symphony No. 40, K. 550", bars: 18, build: forty,
    marked: Array.from({ length: 18 }, (_, b) => (b < 9 ? 1 : b < 13 ? 3 : 4)) },
];

// the arrangement for a level, and the entrances it leaves to cue
function arrange(piece, level) {
  const all = piece.build();
  const has = new Set(all.map((n) => n.section));
  const allowed = level.sections ? level.sections.filter((s) => has.has(s)) : [...has];
  const notes = all.filter((n) => allowed.includes(n.section)).sort((a, b) => a.beat - b.beat);
  const total = piece.bars * BEATS_PER_BAR;
  for (const n of notes) if (n.beat + n.beats >= total - 0.01) n.beats += 2; // the last chord rings
  const first = {};
  for (const n of notes) if (!(n.section in first)) first[n.section] = n.beat;
  const byBar = new Map();
  for (const [section, beat] of Object.entries(first)) {
    const bar = Math.floor(beat / BEATS_PER_BAR) + 1;
    if (bar <= 1 || bar >= piece.bars) continue; // there from the start, or only the last chord
    if (!byBar.has(bar)) byBar.set(bar, []);
    byBar.get(bar).push(section);
  }
  const listNames = (ss) => {
    const n = ss.map((s) => SECTION_NAMES[s]);
    const text = n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
    return text[0].toUpperCase() + text.slice(1);
  };
  const cues = [...byBar].sort((a, b) => a[0] - b[0]).map(([bar, sections]) => ({ bar, sections, label: listNames(sections) }));
  return { notes, sections: allowed, cues, total };
}

// ---------------------------------------------------------------- the orchestra
export class Orchestra {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.score = [];
    this.buffers = new Map(); // "section midi" → AudioBuffer
    this.sections = {};
    this.level = 0.6;       // the conductor's dynamic, 0..1
    this.selected = null;   // the section held in the conductor's hand
    this.balance = {};      // section → gain the conductor set (1 = as written)
    this.entry = {};        // section → gain of an entrance (low when it was not cued)
    this.active = [];       // {section, start, end, vel}
    this.reset();
    this.buildMix();
    this.setPiece(PIECES[0].id, LEVELS[0].id);
  }

  // the piece and the level: the score, who is on stage, and the entrances to cue
  setPiece(pieceId, levelId) {
    this.piece = PIECES.find((p) => p.id === pieceId) || PIECES[0];
    this.levelSpec = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    const a = arrange(this.piece, this.levelSpec);
    this.score = a.notes;
    this.onStage = a.sections;
    this.cues = a.cues;
    this.totalBeats = a.total;
    this.bars = this.piece.bars;
    this.marked = this.piece.marked;
    this.reset();
  }

  buildMix() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.level;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // a hall: a decaying noise impulse, stereo
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 ? i / 400 : 1);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
    // each section: its gain (raised while pointed at), panned to where it sits
    const PAN = { violin: -0.55, viola: -0.1, cello: 0.35, bass: 0.6, flute: -0.35, oboe: -0.1, clarinet: 0.15,
                  bassoon: 0.35, horn: -0.5, trumpet: 0.0, trombone: 0.35, timpani: 0.55 };
    for (const s of Object.keys(FOLDER)) {
      const g = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = PAN[s];
      g.connect(pan);
      pan.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.7;
      pan.connect(send).connect(this.reverb);
      this.sections[s] = g;
    }
  }

  // every sample the score (and `extra` notes) needs and is not loaded yet; progress 0..1
  async load(onProgress, extra = []) {
    const wanted = new Map();
    for (const n of [...this.score, ...extra]) {
      const key = `${n.section} ${n.midi}`;
      if (!this.buffers.has(key)) wanted.set(key, n);
    }
    if (!wanted.size) { onProgress?.(1); return 1; }
    let done = 0;
    const total = wanted.size;
    const fetchOne = async (key, n) => {
      const url = `${SAMPLE_URL}/${FOLDER[n.section]}-mp3/${sampleName(n.midi)}.mp3`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (e) { /* a missing note stays silent */ }
      done += 1;
      onProgress?.(done / total);
    };
    const queue = [...wanted];
    const workers = Array.from({ length: 8 }, async () => { while (queue.length) await fetchOne(...queue.shift()); });
    await Promise.all(workers);
    return this.buffers.size / total;
  }

  async unlock() { if (this.ctx.state !== "running") await this.ctx.resume(); }

  reset() {
    this.state = "waiting"; // waiting → playing ⇄ held → done
    this.prep = null;
    this.anchorBeat = 0; this.anchorTime = 0;
    this.rate = 0; this.lean = 1;
    this.lastIctus = 0;
    this.next = 0;          // index of the next note to schedule
    this.intervals = [];
    this.barDynamics = [];
    this.active = [];
    this.selected = null;
    this.balance = {};
    this.entry = {};
    this.limit = null;
    for (const s of Object.keys(this.sections || {})) this.sections[s].gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    if (this.master) { this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.05); }
  }

  get now() { return this.ctx.currentTime; }

  beatAt(t) { return this.anchorBeat + Math.max(0, t - this.anchorTime) * this.rate * this.lean; }
  timeAt(beat) { return this.anchorTime + (beat - this.anchorBeat) / (this.rate * this.lean); }
  get beat() { return this.state === "waiting" ? 0 : Math.min(this.totalBeats, this.state === "held" ? this.anchorBeat : this.beatAt(this.now)); }
  get tempo() { return this.rate ? this.rate * 60 : null; }

  // a beat from the conductor, now
  ictus() {
    const t = this.now;
    if (this.state === "done") return;
    if (this.state === "waiting") {
      if (this.prep !== null && t - this.prep > 0.28 && t - this.prep < 1.6) {
        this.rate = 1 / (t - this.prep);
        this.anchorBeat = 0; this.anchorTime = t + 0.02; this.lean = 1;
        this.state = "playing";
        this.lastIctus = t;
        return;
      }
      this.prep = t;
      return;
    }
    const interval = t - this.lastIctus;
    this.lastIctus = t;
    if (this.state === "held") {
      // pick up from the next beat
      this.anchorBeat = Math.ceil(this.anchorBeat - 0.25);
      this.anchorTime = t + 0.02;
      this.lean = 1;
      this.state = "playing";
      this.next = this.score.findIndex((n) => n.beat >= this.anchorBeat - 1e-6);
      if (this.next < 0) this.next = this.score.length;
      return;
    }
    if (interval > 0.25 && interval < 2) {
      this.intervals.push(interval);
      const measured = 1 / interval;
      this.rate += (Math.max(this.rate * 0.6, Math.min(this.rate * 1.6, measured)) - this.rate) * 0.45;
    }
    // re-anchor here, and lean the coming beat so the music lands on the conductor's
    const b = this.beatAt(t);
    const err = Math.round(b) - b; // > 0: the conductor is ahead
    this.anchorBeat = b; this.anchorTime = t;
    this.lean = 1 + Math.max(-0.35, Math.min(0.35, err * 0.9));
  }

  setLevel(level) {
    this.level = level;
    this.master.gain.setTargetAtTime(level, this.now, 0.25);
  }

  gainOf(section) {
    return (this.balance[section] ?? 1) * (this.entry[section] ?? 1) * (this.selected === section ? 1.15 : 1);
  }

  applyGain(section, tau = 0.15) {
    this.sections[section].gain.setTargetAtTime(this.gainOf(section), this.now, tau);
  }

  setSelected(section) {
    if (section === this.selected) return;
    const was = this.selected;
    this.selected = section;
    if (was) this.applyGain(was);
    if (section) this.applyGain(section);
  }

  setBalance(section, gain) {
    this.balance[section] = gain;
    this.applyGain(section, 0.08);
  }

  // an entrance that was not cued comes in timid, and recovers over two bars
  hesitate(sections) {
    for (const s of sections) {
      this.entry[s] = 0.38;
      this.applyGain(s, 0.05);
      setTimeout(() => { this.entry[s] = 1; this.applyGain(s, 1.2); }, 2 * BEATS_PER_BAR / Math.max(this.rate, 0.5) * 1000);
    }
  }

  // practice: play only up to this beat, then fade out (null for the whole piece)
  setLimit(beat) { this.limit = beat; }

  // a chord now, for the lessons: [{section, midi}], held for `seconds`
  chord(notes, seconds = 2.5, vel = 0.85) {
    const when = this.now + 0.03;
    for (const n of notes) this.play({ section: n.section, midi: n.midi, vel }, when, seconds);
  }

  // a metronome tick, now or at `when`
  tick(when = this.now, accent = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.22, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start(when); o.stop(when + 0.08);
  }

  // every sounding note, faded out at once
  silence() {
    const t = this.now;
    for (const a of this.active) {
      try { a.g.gain.cancelScheduledValues(t); a.g.gain.setTargetAtTime(0, t, 0.04); a.src.stop(t + 0.3); } catch (e) { /* already stopped */ }
    }
    this.active = [];
  }

  // the final release: everything stops together
  cutoff() {
    const t = this.now;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.0001, t, 0.06);
    this.state = "done";
  }

  // call every frame: schedule what falls in the next 120 ms, hold when the beats stop
  update(onBar) {
    const t = this.now;
    if (this.state !== "playing") return;
    // the lean lasts one beat
    if (this.lean !== 1 && this.beatAt(t) - this.anchorBeat >= 1) {
      this.anchorBeat = this.beatAt(t); this.anchorTime = t; this.lean = 1;
    }
    if (this.levelSpec.holds && t - this.lastIctus > 2.6 / this.rate) {
      this.anchorBeat = this.beatAt(t);
      this.state = "held";
      for (const [s, g] of Object.entries(this.sections)) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.18);
        g.gain.setTargetAtTime(this.gainOf(s), t + 0.8, 0.05);
      }
      this.active = [];
      return;
    }
    const horizon = this.beatAt(t + 0.12);
    while (this.next < this.score.length && this.score[this.next].beat < horizon) {
      const n = this.score[this.next++];
      if (n.beat < this.beatAt(t) - 0.05) continue; // passed while holding or leaning
      const when = Math.max(t, this.timeAt(n.beat));
      this.play(n, when, n.beats / this.rate);
    }
    if (this.limit != null && this.beatAt(t) >= this.limit) { this.cutoff(); return; }
    const bar = Math.floor(this.beatAt(t) / BEATS_PER_BAR);
    if (bar !== this.lastBar) { this.lastBar = bar; onBar?.(bar); }
    if (this.beatAt(t) >= this.totalBeats + 2.5) this.state = "done";
  }

  play(n, when, seconds) {
    const buffer = this.buffers.get(`${n.section} ${n.midi}`);
    if (!buffer) return;
    const [attack, release, level] = VOICE[n.section];
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    const peak = level * n.vel;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    const end = when + Math.max(seconds * 0.96, attack + 0.05);
    g.gain.setTargetAtTime(0, end, release);
    src.connect(g).connect(this.sections[n.section]);
    src.start(when);
    src.stop(end + release * 6);
    this.active.push({ section: n.section, start: when, end: end + release * 1.5, vel: n.vel, src, g });
  }

  // how much a section sounds now, 0..1, for the picture
  sectionLevel(section) {
    const t = this.now;
    let v = 0;
    for (const a of this.active) if (a.section === section && a.start <= t && t < a.end) v = Math.max(v, a.vel);
    if (this.active.length > 400) this.active = this.active.filter((a) => a.end > t);
    return Math.min(1.4, v * this.gainOf(section));
  }
}
export { arrange, sampleName, FOLDER };
