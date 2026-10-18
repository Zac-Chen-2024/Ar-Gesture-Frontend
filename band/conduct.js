// /band/conduct.html: conduct an orchestra with the Neural Band.
//
// The hall is an architect's model: matte paper geometry, soft shadows and ink
// hairlines that fade into the paper with distance. The conductor's arm is the
// band's full orientation (Kinesis's [w, x, y, z]; the forearm is the band's +y).
// A beat is the bottom of a downstroke of the baton's tip (the ictus): the time
// between beats is the tempo, and the height of the stroke is the dynamic.
// The orchestra (conduct-music.js) follows those beats and that dynamic.
//
// The pinch is the conductor's left hand. Point at a section and hold it: the
// section is selected (lit, forward), and raising or lowering the arm while holding
// sets its balance. Pinch a section at its entrance (the red marks on the timeline)
// to cue it in; an entrance not cued comes in timid. Pinch on the last chord to
// release it. A pinch at nothing sets the centre again.
//
// A pinch sets the centre (the baton's direction now becomes "at the orchestra").
// The mouse conducts too: move to point, click to set the centre.
import * as THREE from "three";
import { Orchestra, PIECES, LEVELS, BEATS_PER_BAR } from "./conduct-music.js";
import { Guide, GUIDE_NOTES, GUIDE_PIECE } from "./conduct-guide.js";

// "piece": the whole score, scored; "guide": the lessons (conduct-guide.js)
let mode = "piece";
const bus = new EventTarget();
const emit = (type, detail = {}) => bus.dispatchEvent(new CustomEvent(type, { detail }));

const BAND_URL = new URLSearchParams(location.search).get("ws") || window.GESTURE_CONFIG.backendWsUrl;
const PAPER = 0xfaf8f3, INK = 0x111111, RED = 0xd6452b;
// "model": an architect's model of the players; "chart": a seating chart in depth
const STYLE = new URLSearchParams(location.search).get("style") === "model" ? "model" : "chart";

const $ = (id) => document.getElementById(id);
const body = document.body;
const canvas = $("stage");

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);
scene.fog = new THREE.Fog(PAPER, 13, 30);

const camera = new THREE.PerspectiveCamera(36, 1, 0.03, 90);
const EYE = new THREE.Vector3(0, 3.4, 4.6);
camera.position.copy(EYE);
const LOOK = new THREE.Vector3(0, 0.2, -4.6);
camera.lookAt(LOOK);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// light: a warm key from above the stage, a pale sky, paper bounce from the floor
scene.add(new THREE.HemisphereLight(0xffffff, 0xf3eee4, 2.1));
const key = new THREE.DirectionalLight(0xfff6ea, 1.05);
key.position.set(2.5, 9, 5);
key.target.position.set(0, 0, -5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 30 });
key.shadow.bias = -0.0004;
scene.add(key, key.target);

// ---------------------------------------------------------------- materials
const mat = (color, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const M = {
  paper: mat(0xf7f4ee), floor: mat(0xf8f5ef), riser: mat(0xf6f2eb),
  wood: mat(0xe2d6c0), brass: mat(0xe3d2a2, 0.7), skin: mat(0xf0e7da),
  ink: mat(0x1b1b1b, 0.85), cuff: mat(0xfbfaf6), baton: mat(0xfdfcf8, 0.6),
};
const hairline = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.42 });
const faintline = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.2 });

function mesh(geometry, material, { edges = 30, line = hairline, shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edges), line));
  return m;
}

// ---------------------------------------------------------------- the hall
// The platform is a half disc opening toward the podium; the risers are annular
// sectors behind it. Angles are measured in the floor plane, 90° straight ahead.
const polar = (r, deg, y = 0) => new THREE.Vector3(Math.cos(deg * Math.PI / 180) * r, y, -Math.sin(deg * Math.PI / 180) * r - 0.6);

function sector(rIn, rOut, from, to, height) {
  const s = new THREE.Shape();
  const a0 = from * Math.PI / 180, a1 = to * Math.PI / 180;
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 72 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.6);
  return g;
}

const floor = mesh(new THREE.CircleGeometry(30, 96).rotateX(-Math.PI / 2), M.floor, { edges: 0, shadow: false });
scene.add(floor);
const riserMat = STYLE === "chart" ? new THREE.MeshBasicMaterial({ color: 0xf6f2ea }) : M.riser;
const platform = mesh(sector(1.8, 5.8, 8, 172, 0.12), riserMat, { line: faintline });
const tier1 = mesh(sector(5.8, 7.8, 14, 166, 0.36), riserMat, { line: faintline });
const tier2 = mesh(sector(7.8, 10.0, 18, 162, 0.62), riserMat, { line: faintline });
scene.add(platform, tier1, tier2);
if (STYLE === "chart") {
  // ruled arcs across the stage, one per row, like a seating chart's
  for (const [r, y] of [[3.2, 0.121], [4.6, 0.121], [6.8, 0.361], [8.9, 0.621]]) {
    const pts = [];
    for (let d = 20; d <= 160; d += 2) pts.push(polar(r, d, y));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), faintline));
  }
}

// the shell behind the orchestra: tall panels on an arc, ruled like an organ case
const shell = new THREE.Group();
for (let i = 0; i <= 26; i++) {
  const deg = 20 + i * (140 / 26);
  const p = polar(11.4, deg, 0);
  const h = 4.2 + Math.sin(i / 26 * Math.PI) * 2.2;
  const panel = mesh(new THREE.BoxGeometry(0.66, h, 0.12), M.paper, { line: faintline });
  panel.position.set(p.x, h / 2, p.z);
  panel.lookAt(0, h / 2, -0.6);
  shell.add(panel);
}
if (STYLE === "model") scene.add(shell);

// the podium's desk: an open score, ruled
function scoreTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#fbf9f4"; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = "rgba(17,17,17,0.55)"; g.lineWidth = 1.2;
  for (const page of [0, 1]) {
    const x0 = 40 + page * 512, x1 = 472 + page * 512;
    for (let sys = 0; sys < 7; sys++) {
      const y0 = 54 + sys * 62;
      for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(x0, y0 + l * 6); g.lineTo(x1, y0 + l * 6); g.stroke(); }
      for (let n = 0; n < 14; n++) {
        const x = x0 + 24 + n * 30, y = y0 + 6 + ((n * 7 + sys * 3) % 5) * 3;
        g.fillStyle = "rgba(17,17,17,0.7)";
        g.beginPath(); g.ellipse(x, y, 3.6, 2.6, -0.4, 0, Math.PI * 2); g.fill();
      }
    }
  }
  g.strokeStyle = "rgba(17,17,17,0.25)"; g.beginPath(); g.moveTo(512, 20); g.lineTo(512, 492); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const desk = new THREE.Group();
const deskTop = mesh(new THREE.BoxGeometry(0.62, 0.02, 0.4), M.ink, { edges: 0 });
const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.29), new THREE.MeshStandardMaterial({ map: scoreTexture(), roughness: 1 }));
pages.rotation.x = -Math.PI / 2;
pages.position.y = 0.012;
deskTop.add(pages);
desk.add(deskTop);
desk.position.set(-0.06, 1.42, 1.05);
desk.rotation.x = 0.55;
// (the desk stays out of the frame for now)

// ---------------------------------------------------------------- the players
// An architect's figure: chair, body, head, a stand, and the instrument. Each one
// faces the podium. The section moves on the beat (see Player.update).
const SECTIONS = {
  violin: { label: "Violins" }, viola: { label: "Violas" }, cello: { label: "Cellos" }, bass: { label: "Basses" },
  flute: { label: "Flutes" }, oboe: { label: "Oboes" }, clarinet: { label: "Clarinets" }, bassoon: { label: "Bassoons" },
  horn: { label: "Horns" }, trumpet: { label: "Trumpets" }, trombone: { label: "Trombones" }, timpani: { label: "Timpani" },
};

const G = {
  seat: new THREE.CylinderGeometry(0.17, 0.19, 0.46, 24).translate(0, -0.21, 0), back: new THREE.BoxGeometry(0.42, 0.42, 0.04),
  leg: new THREE.BoxGeometry(0.03, 0.44, 0.03),
  torso: new THREE.CapsuleGeometry(0.15, 0.32, 8, 20), head: new THREE.SphereGeometry(0.1, 24, 16),
  thigh: new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), arm: new THREE.CapsuleGeometry(0.05, 0.3, 4, 8),
  standPole: new THREE.CylinderGeometry(0.008, 0.008, 0.84, 6), standDesk: new THREE.BoxGeometry(0.36, 0.24, 0.012),
};

function chair(group) {
  const seat = mesh(G.seat, M.wood, { edges: 0 }); seat.position.y = 0.46; group.add(seat);
}

function instrument(type) {
  const g = new THREE.Group();
  const cyl = (r, l, m = M.wood) => mesh(new THREE.CylinderGeometry(r, r, l, 12), m);
  if (type === "violin" || type === "viola") {
    const s = type === "viola" ? 1.12 : 1;
    const bodyI = mesh(new THREE.SphereGeometry(0.1, 16, 10).scale(1.0 * s, 0.32, 1.6 * s), M.wood);
    bodyI.position.set(-0.12, 1.12, -0.12); bodyI.rotation.set(0.2, 0.5, 0.9); g.add(bodyI);
  } else if (type === "cello" || type === "bass") {
    const s = type === "bass" ? 1.45 : 1;
    const bodyI = mesh(new THREE.SphereGeometry(0.13 * s, 18, 12).scale(1, 1.6, 0.45), M.wood);
    bodyI.position.set(0, 0.42 * s, -0.3); bodyI.rotation.x = -0.18; g.add(bodyI);
    const neck = cyl(0.012, 0.5 * s, M.wood); neck.position.set(0, 0.82 * s, -0.24); neck.rotation.x = -0.18; g.add(neck);
  } else if (type === "flute") {
    const f = cyl(0.012, 0.62, M.brass); f.position.set(0.22, 1.22, -0.12); f.rotation.z = 1.45; g.add(f);
  } else if (type === "oboe" || type === "clarinet") {
    const f = cyl(type === "clarinet" ? 0.017 : 0.013, 0.6, M.wood); f.position.set(0, 1.0, -0.26); f.rotation.x = -0.62; g.add(f);
  } else if (type === "bassoon") {
    const f = cyl(0.03, 1.15, M.wood); f.position.set(0.12, 0.98, -0.2); f.rotation.set(-0.2, 0, -0.25); g.add(f);
  } else if (type === "horn") {
    const ring = mesh(new THREE.TorusGeometry(0.13, 0.025, 10, 28), M.brass); ring.position.set(0.18, 0.86, -0.12); ring.rotation.y = 1.2; g.add(ring);
    const bell = mesh(new THREE.ConeGeometry(0.1, 0.14, 20, 1, true), M.brass); bell.position.set(0.3, 0.86, 0.02); bell.rotation.z = -1.4; g.add(bell);
  } else if (type === "trumpet" || type === "trombone") {
    const l = type === "trombone" ? 0.9 : 0.45;
    const tube = cyl(0.016, l, M.brass); tube.rotation.x = Math.PI / 2; tube.position.set(0.02, 1.18, -0.16 - l / 2); g.add(tube);
    const bell = mesh(new THREE.ConeGeometry(type === "trombone" ? 0.1 : 0.075, 0.16, 20, 1, true), M.brass);
    bell.rotation.x = -Math.PI / 2; bell.position.set(0.02, 1.18, -0.16 - l - 0.06); g.add(bell);
  }
  return g;
}

class Player {
  constructor(type, position) {
    this.type = type;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.lookAt(new THREE.Vector3(0, position.y, 0.6)); // +z faces the podium
    this.group.rotateY(Math.PI);
    this.phase = Math.random() * Math.PI * 2;
    this.kick = 0;

    const standing = type === "bass" || type === "timpani";
    if (!standing) chair(this.group);
    const torso = mesh(G.torso, M.paper);
    torso.position.set(0, standing ? 1.12 : 0.86, 0.02);
    const head = mesh(G.head, M.paper);
    head.position.set(0, standing ? 1.6 : 1.33, -0.02);
    this.upper = new THREE.Group();
    this.upper.add(torso, head);
    this.group.add(this.upper);
    if (type === "timpani") {
      for (const x of [-0.42, 0.42]) {
        const drum = mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.62, 28), M.brass);
        drum.position.set(x, 0.32, -0.5); this.group.add(drum);
        const head = mesh(new THREE.CircleGeometry(0.335, 28).rotateX(-Math.PI / 2), M.paper, { edges: 0 });
        head.position.set(x, 0.635, -0.5); this.group.add(head);
      }
    } else {
      this.inst = instrument(type);
      this.upper.add(this.inst);
      const deskS = mesh(G.standDesk, M.paper); deskS.position.set(0.02, 0.88, -0.56); deskS.rotation.x = -0.75; this.group.add(deskS);
    }
  }

  // energy: how hard the section plays now (0..1); beatPhase: 0..1 within the beat
  update(dt, beatPhase, energy) {
    this.kick = Math.max(0, this.kick - dt * 3.2);
    const sway = Math.sin(beatPhase * Math.PI * 2 + this.phase) * 0.025 * energy;
    this.upper.rotation.x = -this.kick * 0.09 * energy + sway * 0.5;
    this.upper.rotation.z = sway;
    const bow = this.inst?.userData.bow;
    if (bow) bow.position.x = 0.05 + Math.sin(beatPhase * Math.PI * 2 + this.phase) * 0.08 * energy;
  }

  beat() { this.kick = 1; }
}

// A seating chart in depth: a ruled disc for the seat and a hairline column of
// sound above it, as tall as the player plays.
const CG = {
  disc: new THREE.CylinderGeometry(0.17, 0.17, 0.025, 40),
  column: new THREE.CylinderGeometry(0.006, 0.006, 1, 8).translate(0, 0.5, 0),
  cap: new THREE.SphereGeometry(0.016, 16, 10),
};
// one material per section, so a section can take the accent or step back as one
const SECTION_MAT = {};
const sectionMat = (type) => (SECTION_MAT[type] ||= new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 1 }));
class ChartPlayer {
  constructor(type, position) {
    this.type = type;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.phase = Math.random() * Math.PI * 2;
    this.kick = 0;
    this.level = 0.15;
    const disc = mesh(CG.disc, M.paper, { line: hairline });
    disc.position.y = 0.0125;
    this.column = new THREE.Mesh(CG.column, sectionMat(type));
    this.column.position.y = 0.025;
    this.cap = new THREE.Mesh(CG.cap, sectionMat(type));
    this.group.add(disc, this.column, this.cap);
  }
  update(dt, beatPhase, energy) {
    this.kick = Math.max(0, this.kick - dt * 2.6);
    const target = 0.18 + energy * (1.0 + 0.35 * Math.sin(beatPhase * Math.PI * 2 + this.phase)) + this.kick * energy * 0.6;
    this.level += (target - this.level) * Math.min(1, dt * 9);
    this.column.scale.y = this.level;
    this.cap.position.y = 0.025 + this.level;
  }
  beat() { this.kick = 1; }
}

const players = [];
const sections = new Map(); // type → Player[]
function seat(type, r, deg, y) {
  const p = STYLE === "chart" ? new ChartPlayer(type, polar(r, deg, y)) : new Player(type, polar(r, deg, y));
  scene.add(p.group);
  players.push(p);
  if (!sections.has(type)) sections.set(type, []);
  sections.get(type).push(p);
}
// strings on the floor, two arcs; winds on the first riser; brass and timpani on the second
[155, 140, 125, 110].forEach((d) => seat("violin", 3.2, d, 0.12));
[95, 80].forEach((d) => seat("viola", 3.2, d, 0.12));
[65, 50, 35].forEach((d) => seat("cello", 3.2, d, 0.12));
[150, 138, 126, 114].forEach((d) => seat("violin", 4.6, d, 0.12));
[100, 88, 76].forEach((d) => seat("viola", 4.6, d, 0.12));
[56, 42].forEach((d) => seat("bass", 4.9, d, 0.12));
[130, 121].forEach((d) => seat("flute", 6.8, d, 0.36));
[111, 102].forEach((d) => seat("oboe", 6.8, d, 0.36));
[80, 71].forEach((d) => seat("clarinet", 6.8, d, 0.36));
[61, 52].forEach((d) => seat("bassoon", 6.8, d, 0.36));
[138, 130, 122, 114].forEach((d) => seat("horn", 8.9, d, 0.62));
[100, 93].forEach((d) => seat("trumpet", 8.9, d, 0.62));
[80, 73, 66].forEach((d) => seat("trombone", 8.9, d, 0.62));
seat("timpani", 9.1, 48, 0.62);

// ---------------------------------------------------------------- section labels
const LABELS = [];
if (STYLE === "chart") {
  const groups = [["violin", "Violins"], ["viola", "Violas"], ["cello", "Cellos"], ["bass", "Basses"],
    ["flute", "Flutes"], ["oboe", "Oboes"], ["clarinet", "Clarinets"], ["bassoon", "Bassoons"],
    ["horn", "Horns"], ["trumpet", "Trumpets"], ["trombone", "Trombones"], ["timpani", "Timpani"]];
  for (const [type, text] of groups) {
    const ps = sections.get(type);
    if (!ps) continue;
    const c = ps.reduce((a, p) => a.add(p.group.position), new THREE.Vector3()).multiplyScalar(1 / ps.length);
    const el = document.createElement("span");
    el.className = "section-label";
    el.textContent = text;
    document.body.appendChild(el);
    // printed on the floor in front of the section, as on a seating chart
    const front = c.clone().sub(new THREE.Vector3(0, c.y, -0.6)).setY(0).normalize().multiplyScalar(-0.55);
    const note = document.createElement("span");
    note.className = "section-note";
    el.appendChild(note);
    // the pool of light under a selected section
    const radius = Math.max(0.55, ...ps.map((p) => p.group.position.distanceTo(c))) + 0.38;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    pool.position.set(c.x, c.y + 0.004, c.z);
    pool.renderOrder = 1;
    scene.add(pool);
    LABELS.push({ type, el, note, pool, radius, centre: c.clone(), at: c.clone().add(front).setY(c.y + 0.02), glow: 0 });
  }
}
const labelOf = (type) => LABELS.find((l) => l.type === type);

// a ring of ink spreading from a section: a cue taken
const ripples = [];
const ringGeo = new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2);
function ripple(type, color = RED) {
  const l = labelOf(type);
  if (!l) return;
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
  m.position.copy(l.centre).setY(l.centre.y + 0.006);
  scene.add(m);
  ripples.push({ m, r0: l.radius * 0.6, life: 1 });
}
function noteOn(type, text) {
  const l = labelOf(type);
  if (!l) return;
  l.note.textContent = text;
  l.note.classList.remove("is-on");
  void l.note.offsetWidth;
  l.note.classList.add("is-on");
}
const projected = new THREE.Vector3();
function placeLabels(pointedType, selectedType, cueTypes, dt) {
  const red = new THREE.Color(RED), ink = new THREE.Color(INK);
  for (const l of LABELS) {
    projected.copy(l.at).project(camera);
    l.el.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px, ${(-projected.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
    const selected = l.type === selectedType, cue = cueTypes.has(l.type);
    l.el.classList.toggle("is-pointed", l.type === pointedType && !selected);
    l.el.classList.toggle("is-selected", selected);
    l.el.classList.toggle("is-cue", cue && !selected);
    l.el.classList.toggle("is-dim", Boolean(selectedType) && !selected);
    // the pool fades in under a selection, and breathes under a coming entrance
    const target = selected ? 0.13 : cue ? 0.05 + 0.04 * Math.sin(performance.now() / 180) : 0;
    l.glow += (target - l.glow) * Math.min(1, dt * 10);
    l.pool.material.opacity = Math.max(0, l.glow);
    const m = SECTION_MAT[l.type];
    if (m) {
      m.color.copy(selected ? red : ink);
      m.opacity += ((selectedType && !selected ? 0.22 : 1) - m.opacity) * Math.min(1, dt * 10);
    }
  }
}

// ---------------------------------------------------------------- the conductor's arm
// Shoulder fixed beside the camera; the elbow follows the forearm a little; the
// forearm, the hand and the baton take the band's orientation.
const arm = new THREE.Group();
scene.add(arm);
const SHOULDER = new THREE.Vector3(0.2, -0.3, -0.38);    // from the camera
const UPPER = 0.29, FORE = 0.28, BATON = 0.4;
const capsule = (r, l, m) => { const c = mesh(new THREE.CapsuleGeometry(r, l, 6, 16), m, { edges: 40 }); c.castShadow = false; return c; };
const upperArm = capsule(0.052, UPPER, M.ink);
const foreArm = capsule(0.045, FORE - 0.02, M.ink);
const cuff = mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.045, 24, 1, true), M.cuff, { edges: 0, shadow: false });
const hand = new THREE.Group();
const palm = mesh(new THREE.BoxGeometry(0.085, 0.03, 0.1).translate(0, 0, -0.05), M.skin, { edges: 0, shadow: false });
const fingers = mesh(new THREE.CapsuleGeometry(0.014, 0.07, 4, 8).rotateX(Math.PI / 2).translate(0, -0.012, -0.12), M.skin, { edges: 0, shadow: false });
const thumb = mesh(new THREE.CapsuleGeometry(0.013, 0.05, 4, 8).rotateX(Math.PI / 2.4).translate(-0.04, 0.0, -0.07), M.skin, { edges: 0, shadow: false });
hand.add(palm, fingers, thumb);
palm.scale.setScalar(0.85); fingers.scale.setScalar(0.85); thumb.scale.setScalar(0.85);
const batonG = new THREE.Group();
const grip = mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.07, 14).rotateX(Math.PI / 2).translate(0, 0, -0.035), M.wood, { edges: 0, shadow: false });
const stick = mesh(new THREE.CylinderGeometry(0.0022, 0.0055, BATON, 10).rotateX(Math.PI / 2).translate(0, 0, -0.07 - BATON / 2), M.baton, { edges: 0, shadow: false });
batonG.add(grip, stick);
batonG.position.set(0, -0.004, -0.09);
batonG.rotation.x = 0.12;
hand.add(batonG);
arm.add(upperArm, foreArm, cuff, hand);
const tipLocal = new THREE.Vector3(0, 0, -0.07 - BATON);

function placeCapsule(c, a, b) {
  c.position.copy(a).add(b).multiplyScalar(0.5);
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

// ---------------------------------------------------------------- the band's orientation → the hall
let handSign = 1;
let centre = null;            // {az, el}: where "at the orchestra" is, in the band's world
// the centre is the middle of the stage, seen from the podium: a little below the eye
const STAGE_MIDDLE = new THREE.Vector3(0, 0.4, -4.6);
const NEUTRAL_EL = Math.atan2(STAGE_MIDDLE.y - EYE.y, EYE.z - STAGE_MIDDLE.z);
let forearmDir = new THREE.Vector3(0, -0.3, -1).normalize();
let palmUp = new THREE.Vector3(0, 1, 0);
let pendingCentre = true;

function rotateBand(q, v) {
  // rotate v by q = [w, x, y, z]
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

// a band-world vector (z up, azimuth counterclockwise) in the hall, relative to the centre
function toHall([x, y, z]) {
  const az = Math.atan2(y, x), horiz = Math.hypot(x, y);
  const right = -(az - centre.az);
  const v = new THREE.Vector3(Math.sin(right) * horiz, z, -Math.cos(right) * horiz);
  return v.applyAxisAngle(new THREE.Vector3(1, 0, 0), NEUTRAL_EL - centre.el);
}

function onQuat(v) {
  const f = rotateBand(v, [0, handSign, 0]);
  if (pendingCentre || !centre) {
    centre = { az: Math.atan2(f[1], f[0]), el: Math.asin(Math.max(-1, Math.min(1, f[2]))) };
    pendingCentre = false;
  }
  forearmDir = toHall(f).normalize();
  palmUp = toHall(rotateBand(v, [0, 0, 1])).normalize();
}

// the mouse: x and y point the baton; the button is the pinch
let mouse = null;
addEventListener("mousemove", (e) => {
  mouse = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 };
  if (bandLive) return;
  const right = mouse.x * 1.7, up = -mouse.y * 1.0 + NEUTRAL_EL + 0.12;
  forearmDir.set(Math.sin(right) * Math.cos(up), Math.sin(up), -Math.cos(right) * Math.cos(up)).normalize();
  palmUp.set(0, 1, 0);
});

// ---------------------------------------------------------------- the beat
// The tip's height, smoothed; an ictus is where a downstroke of enough travel turns.
const beat = { y: null, vy: 0, top: -Infinity, bottom: Infinity, falling: false, times: [], amps: [], last: 0, count: 0 };
let tempo = null, dynamicIndex = null;
const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"];
const ictusMarks = [];

function trackBeat(tipWorld, now, dt) {
  const y = tipWorld.y;
  if (beat.y === null) { beat.y = y; return; }
  const vy = (y - beat.y) / Math.max(dt, 1e-3);
  beat.vy += (vy - beat.vy) * Math.min(1, dt * 30);
  beat.y = y;
  if (beat.vy < -0.25) {
    if (!beat.falling) { beat.falling = true; beat.top = y; }
    beat.top = Math.max(beat.top, y);
    beat.bottom = y;
  } else if (beat.falling && beat.vy > -0.02) {
    beat.falling = false;
    const travel = beat.top - beat.bottom;
    if (travel > 0.035 && now - beat.last > 0.26) onIctus(tipWorld, travel, now);
  }
}

function onIctus(at, travel, now) {
  if (beat.last) {
    const interval = now - beat.last;
    if (interval < 2) {
      beat.times.push(interval);
      if (beat.times.length > 4) beat.times.shift();
      const sorted = [...beat.times].sort((a, b) => a - b);
      tempo = 60 / sorted[Math.floor(sorted.length / 2)];
    }
  }
  beat.last = now;
  beat.count += 1;
  beat.amps.push(travel);
  if (beat.amps.length > 3) beat.amps.shift();
  const amp = beat.amps.reduce((a, b) => a + b, 0) / beat.amps.length;
  dynamicIndex = amp < 0.06 ? 0 : amp < 0.1 ? 1 : amp < 0.15 ? 2 : amp < 0.22 ? 3 : amp < 0.31 ? 4 : 5;
  ictusMarks.push({ p: at.clone(), life: 1 });
  for (const p of players) p.beat();
  emit("ictus", { time: orchestra.now, dynamic: dynamicIndex });
  if (playing() && (mode === "piece" || transportAllowed)) {
    orchestra.ictus();
    if (orchestra.state === "playing") playedIntervals.push(beat.times[beat.times.length - 1]);
  }
  renderScore(true);
}

// ---------------------------------------------------------------- the baton's trail
const TRAIL = 46;
const trailPts = [];
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3));
trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3));
const idx = [];
for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
trailGeo.setIndex(idx);
const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false }));
trail.frustumCulled = false;
trail.renderOrder = 2;
scene.add(trail);
const markGeo = new THREE.SphereGeometry(0.008, 12, 8);
const markMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, fog: false });
const marks = new THREE.Group();
scene.add(marks);
const tipDot = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 8), new THREE.MeshBasicMaterial({ color: RED, fog: false }));
scene.add(tipDot);

const red = new THREE.Color(RED), paper = new THREE.Color(PAPER);
function drawTrail() {
  const pos = trailGeo.attributes.position.array, col = trailGeo.attributes.color.array;
  const toCam = new THREE.Vector3();
  for (let i = 0; i < TRAIL; i++) {
    const p = trailPts[Math.min(i, trailPts.length - 1)] || tipWorld;
    const q = trailPts[Math.min(i + 1, trailPts.length - 1)] || p;
    const dir = q.clone().sub(p);
    if (dir.lengthSq() < 1e-10) dir.set(1, 0, 0);
    toCam.copy(camera.position).sub(p);
    const side = dir.cross(toCam).normalize();
    const k = i / (TRAIL - 1); // 0 oldest … 1 newest
    const w = 0.0045 * k;
    pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
    const c = paper.clone().lerp(red, Math.pow(k, 1.6));
    col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- the score bar
const tempoEl = $("tempo"), dynamicEl = $("dynamic"), barEl = $("bar"), playhead = $("playhead");
// the piece's bars, its phrases (every four bars), and its entrances to cue
function buildTimeline() {
  const tl = $("timeline");
  tl.querySelectorAll("i, .cue-mark").forEach((e) => e.remove());
  const bars = orchestra.bars;
  for (let b = 0; b <= bars; b++) {
    const tick = document.createElement("i");
    tick.style.left = `${(b / bars) * 100}%`;
    if (b % 4 === 0) tick.className = "is-phrase";
    tl.appendChild(tick);
  }
  for (const c of orchestra.cues) {
    const mark = document.createElement("span");
    mark.className = "cue-mark";
    mark.style.left = `${((c.bar - 1) / bars) * 100}%`;
    mark.title = `Bar ${c.bar}: ${c.label}`;
    mark.innerHTML = `<span>${c.label}</span>`;
    tl.appendChild(mark);
    c.mark = mark;
    c.state = "pending";
  }
}
const cueEl = $("cue"), markedEl = $("marked");
function renderScore(onBeat) {
  const t = orchestra.tempo || tempo;
  tempoEl.textContent = t ? `♩ = ${Math.round(t)}` : "♩ = –";
  dynamicEl.textContent = dynamicIndex === null ? "–" : DYNAMICS[dynamicIndex];
  const started = orchestra.state !== "waiting";
  const b = orchestra.beat;
  const bars = orchestra.limit != null ? Math.round(orchestra.limit / BEATS_PER_BAR) : orchestra.bars; // a lesson's phrase, or the piece
  const bar = Math.min(bars, Math.floor(b / BEATS_PER_BAR) + 1);
  barEl.textContent = started ? `${bar} / ${bars}` : `– / ${bars}`;
  markedEl.innerHTML = started ? `Marked <em>${DYNAMICS[orchestra.marked[bar - 1]]}</em>` : "Marked –";
  playhead.style.left = `${Math.min(1, b / orchestra.totalBeats) * 100}%`;
  cueEl.textContent = orchestra.state === "waiting"
    ? (orchestra.prep === null ? "Give one beat to prepare; they come in on the next" : "And…")
    : orchestra.state === "held" ? "They wait for your next beat"
    : comingCue ? `Cue the ${comingCue.label.toLowerCase()}: point and pinch` : selectedType ? `${labelOf(selectedType)?.el.firstChild.textContent ?? ""} — raise or lower to balance` : "";
  if (onBeat) {
    dynamicEl.classList.add("is-beat");
    setTimeout(() => dynamicEl.classList.remove("is-beat"), 140);
  }
}

// ---------------------------------------------------------------- the orchestra, start and finish
const orchestra = new Orchestra();
const beginBtn = $("begin"), statusEl = $("status"), kickerEl = $("kicker"), titleEl = $("title"), subEl = $("sub");
let loaded = false, audioReady = false;
const playedIntervals = [];
const DYN_GAIN = [0.2, 0.3, 0.42, 0.58, 0.78, 1.0];
const playing = () => body.classList.contains("is-live");
beginBtn.disabled = true;
beginBtn.textContent = "Tuning…";

// ---------------------------------------------------------------- the piece, the level, the stage
const pieceSwitch = $("piece"), levelSwitch = $("level"), detailEl = $("detail");
let choice = { piece: PIECES[0].id, level: LEVELS[0].id };
try { choice = { ...choice, ...JSON.parse(localStorage.getItem("band-conduct-choice") || "{}") }; } catch (e) { /* first visit */ }
pieceSwitch.innerHTML = PIECES.map((p) => `<button type="button" role="radio" data-value="${p.id}">${p.title}</button>`).join("");
levelSwitch.innerHTML = LEVELS.map((l) => `<button type="button" role="radio" data-value="${l.id}">${l.label}</button>`).join("");
const sync = (group, value) => group.querySelectorAll("button").forEach((b) => {
  b.classList.toggle("is-active", b.dataset.value === value);
  b.setAttribute("aria-checked", b.dataset.value === value ? "true" : "false");
});

// only the sections the level keeps sit on stage
function applyStage() {
  const on = new Set(orchestra.onStage);
  for (const p of players) p.group.visible = on.has(p.type);
  for (const l of LABELS) {
    l.onStage = on.has(l.type);
    l.el.style.display = l.onStage ? "" : "none";
    l.pool.visible = l.onStage;
  }
}

let loading = null;
async function usePiece(pieceId, levelId, extra = []) {
  orchestra.setPiece(pieceId, levelId);
  applyStage();
  buildTimeline();
  detailEl.textContent = orchestra.piece.detail;
  renderScore(false);
  loaded = false;
  beginBtn.disabled = learnBtn.disabled = true;
  const run = (loading = orchestra.load((f) => { if (loading === run) beginBtn.textContent = `Tuning… ${Math.round(f * 100)}%`; }, extra));
  const share = await run;
  if (loading !== run) return;
  loaded = true;
  beginBtn.disabled = learnBtn.disabled = false;
  beginBtn.textContent = "Take the podium";
  if (share < 0.9) statusEl.textContent = "some instruments did not load; they stay silent";
}

function choose(next) {
  choice = { ...choice, ...next };
  try { localStorage.setItem("band-conduct-choice", JSON.stringify(choice)); } catch (e) { /* not kept */ }
  sync(pieceSwitch, choice.piece);
  sync(levelSwitch, choice.level);
  const piece = PIECES.find((p) => p.id === choice.piece) || PIECES[0];
  titleEl.textContent = piece.title;
  intro.title = piece.title;
  usePiece(choice.piece, choice.level);
}
for (const [group, key] of [[pieceSwitch, "piece"], [levelSwitch, "level"]]) {
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (b && !playing()) choose({ [key]: b.dataset.value });
  });
  group.addEventListener("mousedown", (e) => e.stopPropagation());
}

async function takePodium() {
  if (!loaded) return;
  if (mode === "guide") endGuide();
  await orchestra.unlock();
  audioReady = true;
  orchestra.reset();
  orchestra.setLevel(DYN_GAIN[3]);
  pendingCentre = true;
  playedIntervals.length = 0;
  for (const c of orchestra.cues) { c.state = "pending"; c.mark.className = "cue-mark"; }
  cutoffClean = null;
  release();
  body.classList.add("is-live");
  beat.count = 0; beat.times = []; beat.amps = []; beat.last = 0; tempo = null; dynamicIndex = null;
  renderScore(false);
}

function onBar(bar) {
  // the dynamic conducted through each bar, against the marking
  if (bar > 0 && bar <= orchestra.bars) orchestra.barDynamics[bar - 1] = dynamicIndex ?? 3;
}

function finish() {
  body.classList.remove("is-live");
  // steadiness: the spread of the beats around their median, a missed beat (a double
  // interval) aside; within 4% is perfect
  const raw = playedIntervals.filter((x) => x > 0.25 && x < 2).sort((a, b) => a - b);
  const median = raw[Math.floor(raw.length / 2)] || 0;
  const iv = raw.filter((x) => x > median * 0.6 && x < median * 1.6);
  const mean = iv.reduce((a, b) => a + b, 0) / (iv.length || 1);
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / (iv.length || 1));
  const steady = iv.length > 4 ? Math.max(0, Math.min(100, Math.round((1 - Math.max(0, sd / mean - 0.04) * 5) * 100))) : 0;
  const tolerance = orchestra.levelSpec.tolerance;
  const bars = orchestra.barDynamics.map((d, i) => (Math.abs(d - orchestra.marked[i]) <= tolerance ? 1 : 0));
  const dyn = bars.length ? Math.round(bars.reduce((a, b) => a + b, 0) / bars.length * 100) : 0;
  const CUES = orchestra.cues;
  const cued = CUES.filter((c) => c.state === "hit").length;
  const cues = CUES.length ? Math.round(cued / CUES.length * 100) : 100;
  const total = Math.round((steady + dyn + cues) / 3 + (cutoffClean ? 5 : 0));
  kickerEl.textContent = total >= 80 ? "Bravo" : total >= 55 ? "Well played" : "Once more";
  titleEl.textContent = String(Math.min(100, total));
  subEl.textContent = `Steady tempo ${steady}% · dynamics as marked ${dyn}% · cues ${cued} of ${CUES.length}`
    + `${cutoffClean ? " · a clean release" : ""} · ♩ = ${mean ? Math.round(60 / mean) : "–"} on average`;
  beginBtn.textContent = "Again";
  statusEl.textContent = "or pinch";
}

beginBtn.addEventListener("click", (e) => { e.stopPropagation(); takePodium(); });
beginBtn.addEventListener("mousedown", (e) => e.stopPropagation());
addEventListener("mousedown", (e) => { if (e.button === 0 && playing()) press(); });
addEventListener("mouseup", (e) => { if (e.button === 0) release(); });
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { body.classList.remove("is-live"); orchestra.reset(); release(); }
  if (e.key === "c") pendingCentre = true;
});

// ---------------------------------------------------------------- the left hand: select, balance, cue, release
let selectedType = null, holdFrom = null, comingCue = null, cutoffClean = null;
let pointedType = null;
const BALANCE_STEP = 0.11; // radians of arm raised for +3 dB

function press() {
  // a pinch cannot start sound before a click has (the browser's rule), so the first
  // start is the button; after that a pinch begins again
  if (!playing()) { if (audioReady) takePodium(); else statusEl.textContent = "click Take the podium once to let the orchestra play"; return; }
  if (mode === "guide") {
    emit("press", { pointed: pointedType });
    if (pointedType) {
      selectedType = pointedType;
      holdFrom = { up: smoothDir.y, gain: orchestra.balance[selectedType] ?? 1 };
      orchestra.setSelected(selectedType);
    }
    return;
  }
  // the last chord: a pinch releases it
  if (orchestra.beat >= orchestra.totalBeats - 1) {
    cutoffClean = orchestra.beat <= orchestra.totalBeats + 2.2;
    orchestra.cutoff();
    return;
  }
  if (!pointedType) { pendingCentre = true; return; }
  // a cue: the section is one of an entrance coming now
  const b = orchestra.beat;
  for (const c of orchestra.cues) {
    const at = (c.bar - 1) * BEATS_PER_BAR;
    if (c.state === "pending" && c.sections.includes(pointedType) && b >= at - BEATS_PER_BAR - 0.5 && b <= at + 1) {
      c.state = "hit";
      c.mark.classList.add("is-hit");
      for (const sec of c.sections) ripple(sec);
      noteOn(pointedType, "on cue");
    }
  }
  selectedType = pointedType;
  holdFrom = { up: smoothDir.y, gain: orchestra.balance[selectedType] ?? 1 };
  orchestra.setSelected(selectedType);
}

function release() {
  if (mode === "guide") emit("release", { selected: selectedType });
  if (selectedType) noteOn(selectedType, balanceText(orchestra.balance[selectedType] ?? 1));
  selectedType = null;
  holdFrom = null;
  orchestra.setSelected(null);
}

const balanceText = (g) => { const db = Math.round(20 * Math.log10(g)); return db === 0 ? "as written" : `${db > 0 ? "+" : ""}${db} dB`; };

// while held, the arm's height sets the selected section's balance
function holdBalance() {
  if (!selectedType || !holdFrom) return;
  const lift = Math.asin(Math.max(-1, Math.min(1, smoothDir.y))) - Math.asin(Math.max(-1, Math.min(1, holdFrom.up)));
  const gain = Math.max(0.25, Math.min(2.5, holdFrom.gain * Math.pow(10, (lift / BALANCE_STEP) * 3 / 20)));
  orchestra.setBalance(selectedType, gain);
  emit("balance", { type: selectedType, gain });
  const l = labelOf(selectedType);
  if (l) { l.note.textContent = balanceText(gain); l.note.classList.add("is-held"); }
}

// entrances: which is coming, and which passed without a cue
function followCues() {
  const b = orchestra.beat;
  comingCue = null;
  for (const c of orchestra.cues) {
    const at = (c.bar - 1) * BEATS_PER_BAR;
    if (c.state !== "pending") continue;
    if (b > at + 1) {
      c.state = "missed";
      c.mark.classList.add("is-missed");
      orchestra.hesitate(c.sections);
      noteOn(c.sections[0], "not cued");
    } else if (b >= at - BEATS_PER_BAR * 2) comingCue = c;
  }
}

// ---------------------------------------------------------------- the lessons
let transportAllowed = false;
let guideHighlight = new Set();
const learnBtn = $("learn");
const intro = { kicker: kickerEl.textContent, title: titleEl.textContent, sub: subEl.textContent };
const guide = new Guide({
  bus, orchestra,
  state: () => ({ dynamicIndex, tempo, selectedType, pointedType }),
  centre: () => { pendingCentre = true; },
  highlight: (types) => { guideHighlight = new Set(types); },
  ripple: (type) => ripple(type),
  note: (type, text) => noteOn(type, text),
  allowTransport: (on) => { transportAllowed = on; },
  startPhrase: (bars) => {
    orchestra.silence();
    orchestra.reset();
    orchestra.setLevel(DYN_GAIN[3]);
    orchestra.setLimit(bars * BEATS_PER_BAR);
    transportAllowed = true;
  },
  leaveGuide: () => endGuide(),
  finishGuide: () => { endGuide(); kickerEl.textContent = "Ready"; titleEl.textContent = intro.title; subEl.textContent = "Take the podium: the whole piece, with its entrances to cue."; },
});

async function startGuide() {
  if (!loaded) return;
  await orchestra.unlock();
  await usePiece(GUIDE_PIECE.piece, GUIDE_PIECE.level, GUIDE_NOTES);
  audioReady = true;
  mode = "guide";
  release();
  body.classList.add("is-live", "is-guide");
  beat.count = 0; beat.times = []; beat.amps = []; beat.last = 0; tempo = null; dynamicIndex = null;
  guide.start();
  renderScore(false);
}

function endGuide() {
  guide.el.hidden = true;
  mode = "piece";
  transportAllowed = false;
  guideHighlight = new Set();
  orchestra.silence();
  orchestra.reset();
  release();
  body.classList.remove("is-live", "is-guide");
  kickerEl.textContent = intro.kicker; titleEl.textContent = intro.title; subEl.textContent = intro.sub;
  usePiece(choice.piece, choice.level);
}

learnBtn.addEventListener("click", (e) => { e.stopPropagation(); startGuide(); });
learnBtn.addEventListener("mousedown", (e) => e.stopPropagation());
learnBtn.disabled = true;
let learned = false;
try { learned = localStorage.getItem("band-conduct-learned") === "1"; } catch (e) { /* first visit */ }
if (!learned) statusEl.textContent = "New to conducting? Learn first: eight short lessons.";

// ---------------------------------------------------------------- band room
let bandLive = false, bandSocket = null;
const badge = $("band-badge"), codeEl = $("band-code"), bandStatus = $("band-status");
function setBand(code, status, live) {
  if (code !== undefined) codeEl.textContent = code;
  bandStatus.textContent = status;
  badge.classList.toggle("is-paired", live);
  bandLive = live;
}
function connectBand() {
  const ws = new WebSocket(BAND_URL);
  bandSocket = ws;
  ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", role: "display", kind: "band" })));
  ws.addEventListener("message", (event) => {
    if (ws !== bandSocket) return;
    let m;
    try { m = JSON.parse(event.data); } catch (e) { return; }
    if (m.type === "room-created") setBand(m.code, "waiting for band…", false);
    else if (m.type === "band-joined") { handSign = m.deviceInfo?.hand === "left" ? -1 : 1; pendingCentre = true; setBand(undefined, "band live", true); }
    else if (m.type === "band-left") setBand(undefined, "waiting for band…", false);
    else if (m.type === "band-status") {
      if (m.hand) handSign = m.hand === "left" ? -1 : 1;
      setBand(undefined, m.connected === false ? "band not connected" : "band live", m.connected !== false);
    } else if (m.type === "band-batch") {
      for (const e of m.events || []) {
        if (e.event === "quat" && Array.isArray(e.v) && !e.late) onQuat(e.v);
        else if (e.event === "gesture" && e.finger === "index" && !e.late) {
          if (e.action === "press") press();
          else if (e.action === "release") release();
        }
      }
    }
  });
  ws.addEventListener("close", () => {
    if (ws !== bandSocket) return;
    setBand("····", "reconnecting…", false);
    setTimeout(connectBand, 1500);
  });
}
connectBand();

// ---------------------------------------------------------------- frame
const clock = new THREE.Clock();
const tipWorld = new THREE.Vector3();
const shoulderW = new THREE.Vector3(), elbowW = new THREE.Vector3(), wristW = new THREE.Vector3();
const smoothDir = forearmDir.clone(), smoothUp = palmUp.clone();
let elapsed = 0;

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  const now = performance.now() / 1000;

  // a light filter: the band is smooth already, the mouse is not
  smoothDir.lerp(forearmDir, bandLive ? 0.65 : 0.35).normalize();
  smoothUp.lerp(palmUp, 0.5).normalize();

  shoulderW.copy(SHOULDER).applyQuaternion(camera.quaternion).add(camera.position);
  // the elbow hangs below and behind the hand, a little toward where the forearm points
  elbowW.copy(shoulderW).add(new THREE.Vector3(0.08, -0.13, -0.22).applyQuaternion(camera.quaternion))
    .addScaledVector(smoothDir, 0.06);
  wristW.copy(elbowW).addScaledVector(smoothDir, FORE);
  placeCapsule(upperArm, shoulderW, elbowW);
  placeCapsule(foreArm, elbowW, wristW.clone().addScaledVector(smoothDir, -0.03));
  cuff.position.copy(wristW).addScaledVector(smoothDir, -0.03);
  cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), smoothDir);
  // the hand: forward along the forearm, its back toward the band's face
  const fwd = smoothDir.clone().negate();
  const up = smoothUp.clone().addScaledVector(smoothDir, -smoothUp.dot(smoothDir)).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  hand.position.copy(wristW);
  hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  hand.updateMatrixWorld(true);
  tipWorld.copy(tipLocal).applyMatrix4(batonG.matrixWorld);
  tipDot.position.copy(tipWorld);

  trailPts.push(tipWorld.clone());
  while (trailPts.length > TRAIL) trailPts.shift();
  drawTrail();
  if (body.classList.contains("is-live")) trackBeat(tipWorld, now, dt);

  for (const m of ictusMarks) {
    if (!m.mesh) { m.mesh = new THREE.Mesh(markGeo, markMat.clone()); m.mesh.position.copy(m.p); marks.add(m.mesh); }
    m.life -= dt * 0.9;
    m.mesh.material.opacity = Math.max(0, m.life);
    m.mesh.scale.setScalar(1 + (1 - m.life) * 1.5);
  }
  for (let i = ictusMarks.length - 1; i >= 0; i--) if (ictusMarks[i].life <= 0) { marks.remove(ictusMarks[i].mesh); ictusMarks.splice(i, 1); }

  // the section the baton points at: the smallest angle between the forearm and the
  // way from the hand to the section, within a section's width
  let pointed = null;
  {
    let best = Infinity;
    for (const l of LABELS) {
      if (!l.onStage) continue;
      const to = l.centre.clone().setY(l.centre.y + 0.6).sub(wristW);
      const angle = smoothDir.angleTo(to);
      const width = Math.atan2(l.radius, to.length()) + 0.05;
      if (angle < width && angle < best) { best = angle; pointed = l.type; }
    }
  }
  pointedType = pointed;
  if (playing()) { if (mode === "piece") followCues(); holdBalance(); }
  if (mode === "guide") guide.update(dt);
  const lit = mode === "guide" ? guideHighlight : new Set(comingCue && !comingCue.state.startsWith("hit") ? comingCue.sections : []);
  placeLabels(pointed, selectedType, lit, dt);
  for (const r of ripples) {
    r.life -= dt * 0.8;
    r.m.scale.setScalar(r.r0 + (1 - r.life) * 1.6);
    r.m.material.opacity = Math.max(0, r.life) * 0.9;
  }
  for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i].life <= 0) { scene.remove(ripples[i].m); ripples.splice(i, 1); }

  // the orchestra breathes with the beat; harder when the beat is big
  const period = tempo ? 60 / tempo : 1;
  const phase = beat.last ? ((now - beat.last) / period) % 1 : (elapsed * 0.3) % 1;
  // the music: follow, mix, and let each column stand as tall as its player sounds
  if (playing()) {
    orchestra.update(onBar);
    if (dynamicIndex !== null) orchestra.setLevel(DYN_GAIN[dynamicIndex]);
    if (orchestra.state === "done" && mode === "piece") finish();
  }
  const sounding = playing() && orchestra.state === "playing";
  const scale = 0.45 + (dynamicIndex ?? 3) * 0.12;
  for (const p of players) p.update(dt, phase, sounding ? orchestra.sectionLevel(p.type) * scale : 0.08);
  if (playing()) renderScore(false);

  // the camera breathes too, barely
  camera.position.y = EYE.y + Math.sin(elapsed * 0.6) * 0.004;
  camera.lookAt(LOOK);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
choose({});
requestAnimationFrame(frame);
