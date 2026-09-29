// Phone: pairing and questionnaire at the start, a blank eyes-free touch
// surface during the study, the final questionnaire at the end. Strokes use
// the same messages as the main site's phone page (relative key units with
// 8 mm keys, t = ms since the stroke began); the server decides what they do.

const RT = window.STUDY_CONFIG_RUNTIME;
const $ = (id) => document.getElementById(id);
const PAGES = ["p-code", "p-wait", "p-intake", "p-paired", "p-pad", "p-final", "p-thanks"];
const BASE_KEY_MM = 8; // same as mobile.js
const PX_PER_MM = 96 / 25.4; // CSS millimetres
const KEY_W = BASE_KEY_MM * PX_PER_MM;
const KEY_H = KEY_W * 1.19;

let page = null;
let study = null; // state-update.study
let paired = false;
let sentIntake = false;
let sentFinal = false;
let conditions = ["A", "B"];

function show(id) {
  if (page === id) return;
  page = id;
  PAGES.forEach((p) => ($(p).hidden = p !== id));
  if (id === "p-pad") requestWakeLock();
}

const sock = window.StudySocket(onMessage, (status) => {
  if (status === "open") {
    sock.send({ type: "join", role: "mobile", inputDevice: "phone", deviceInfo: deviceInfo() });
    const code = new URLSearchParams(location.search).get("code");
    if (code) join(code);
    else show("p-code");
  } else {
    paired = false;
    show("p-code");
    $("code-msg").textContent = "Connection lost. Reload the page and enter the code again.";
  }
});

function deviceInfo() {
  return { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, keyWidth: KEY_W, keyHeight: KEY_H,
    userAgent: navigator.userAgent.slice(0, 200), page: "study-pad", version: RT.version };
}

function join(code) {
  $("code-msg").textContent = "";
  sock.send({ type: "join-room", code: String(code).trim() });
}
$("code-go").onclick = () => join($("code").value);

function onMessage(m) {
  if (m.type === "room-joined") {
    paired = true;
    $("wait-code").textContent = m.code;
    route();
  } else if (m.type === "room-error") {
    $("code-msg").textContent = m.message;
  } else if (m.type === "room-closed") {
    paired = false;
    study = null;
    show("p-code");
    $("code-msg").textContent = "The screen disconnected. Enter the new code.";
  } else if (m.type === "state-update") {
    study = m.study || null;
    route();
  } else if (m.type === "study-questionnaire-saved") {
    if (m.kind === "intake") {
      show("p-paired");
      setTimeout(() => page === "p-paired" && show("p-pad"), 3000);
    } else {
      show("p-thanks");
    }
  } else if (m.type === "study-questionnaire-error") {
    $(page === "p-final" ? "final-msg" : "intake-msg").textContent = m.message;
    sentIntake = sentFinal = false;
  }
}

// which page the phone shows follows the server's study state
function route() {
  if (!paired) return show("p-code");
  if (!study || !study.active) return show("p-wait");
  if (!study.intake) return sentIntake ? null : show("p-intake");
  if (study.screen === "end") return study.final ? show("p-thanks") : sentFinal ? null : show("p-final");
  if (page !== "p-paired") show("p-pad");
}

// ---- tiny form builder
function buildForm(root, questions, onChange) {
  const answers = {};
  root.innerHTML = "";
  questions.forEach((q) => {
    const box = document.createElement("div");
    box.className = "q";
    box.innerHTML = `<p>${q.text}</p>`;
    if (q.type === "choice" || q.type === "scale") {
      const opts = q.type === "scale" ? Array.from({ length: q.n }, (_, i) => String(i + 1)) : q.options;
      const row = document.createElement("div");
      row.className = "choice";
      opts.forEach((o) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = o;
        b.onclick = () => {
          answers[q.id] = q.type === "scale" ? +o : o;
          row.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
          onChange(answers);
        };
        row.appendChild(b);
      });
      box.appendChild(row);
      if (q.lo) box.insertAdjacentHTML("beforeend", `<div class="choice-ends"><span>${q.lo}</span><span>${q.hi}</span></div>`);
    } else if (q.type === "number" || q.type === "text") {
      const inp = document.createElement(q.long ? "textarea" : "input");
      if (!q.long) inp.type = q.type;
      if (q.long) inp.rows = 3;
      inp.oninput = () => {
        answers[q.id] = inp.value.trim();
        onChange(answers);
      };
      box.appendChild(inp);
    } else if (q.type === "rank") {
      const items = q.items.slice();
      answers[q.id] = items.slice();
      const wrap = document.createElement("div");
      wrap.className = "rank";
      const draw = () => {
        wrap.innerHTML = "<ol>" + items.map((it, i) =>
          `<li><b>${i + 1}</b><span>${it}</span><button data-i="${i}" data-d="-1">↑</button><button data-i="${i}" data-d="1">↓</button></li>`
        ).join("") + "</ol>";
        wrap.querySelectorAll("button").forEach((b) => (b.onclick = () => {
          const i = +b.dataset.i;
          const j = i + +b.dataset.d;
          if (j < 0 || j >= items.length) return;
          [items[i], items[j]] = [items[j], items[i]];
          answers[q.id] = items.slice();
          draw();
          onChange(answers);
        }));
      };
      draw();
      box.appendChild(wrap);
    }
    root.appendChild(box);
  });
  const complete = () => questions.every((q) => q.optional || (answers[q.id] != null && answers[q.id] !== ""));
  return { answers, complete };
}

// ---- intake
const intakeQ = [
  { id: "consent", type: "choice", text: "I have read the information sheet and agree to take part.", options: ["I agree"] },
  { id: "age", type: "number", text: "Age" },
  { id: "gender", type: "choice", text: "Gender", options: ["Female", "Male", "Other", "Prefer not"] },
  { id: "hand", type: "choice", text: "Dominant hand", options: ["Right", "Left", "Both"] },
  { id: "english", type: "scale", n: 7, text: "English proficiency", lo: "Basic", hi: "Native" },
  { id: "gesture_kb", type: "scale", n: 7, text: "How often do you use a swipe / gesture keyboard?", lo: "Never", hi: "Every day" },
  { id: "arvr", type: "scale", n: 7, text: "Experience with AR / VR headsets", lo: "None", hi: "Expert" }
];
const intake = buildForm($("intake-form"), intakeQ, () => ($("intake-submit").disabled = !intake.complete()));
$("intake-submit").onclick = () => {
  sentIntake = true;
  $("intake-submit").disabled = true;
  $("intake-msg").textContent = "Saving…";
  sock.send({ type: "study-questionnaire", kind: "intake", data: { ...intake.answers, device: deviceInfo() } });
};

// ---- final
const finalQ = [
  { id: "rank", type: "rank", text: "Rank the conditions (1 = liked most)", items: conditions.map((c) => `Condition ${c}`) },
  { id: "easy_learn", type: "scale", n: 7, text: "Gesture typing on the screen was easy to learn.", lo: "Strongly disagree", hi: "Strongly agree" },
  { id: "eyes_free", type: "scale", n: 7, text: "Not looking at the phone was comfortable.", lo: "Strongly disagree", hi: "Strongly agree" },
  { id: "would_use", type: "scale", n: 7, text: "I would use this to type in AR.", lo: "Strongly disagree", hi: "Strongly agree" },
  { id: "comments", type: "text", long: true, optional: true, text: "Anything else? (optional)" }
];
const final = buildForm($("final-form"), finalQ, () => ($("final-submit").disabled = !final.complete()));
$("final-submit").onclick = () => {
  sentFinal = true;
  $("final-submit").disabled = true;
  $("final-msg").textContent = "Saving…";
  sock.send({ type: "study-questionnaire", kind: "final", data: final.answers });
};

// ---- the touch surface
const surface = $("p-pad");
let down = null; // { id, x, y, t0 }
surface.addEventListener("pointerdown", (e) => {
  if (down) return;
  e.preventDefault();
  surface.setPointerCapture(e.pointerId);
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now() };
  sock.send({ type: "gesture-start", point: { x: 0, y: 0, t: 0 }, rawPoint: { x: e.clientX, y: e.clientY },
    deviceInfo: deviceInfo() });
});
surface.addEventListener("pointermove", (e) => {
  if (!down || e.pointerId !== down.id) return;
  e.preventDefault();
  sock.send({ type: "gesture-move",
    point: { x: (e.clientX - down.x) / KEY_W, y: (e.clientY - down.y) / KEY_H, t: Math.round(performance.now() - down.t0) },
    rawPoint: { x: e.clientX, y: e.clientY } });
});
function up(e) {
  if (!down || e.pointerId !== down.id) return;
  sock.send({ type: "gesture-end", t: Math.round(performance.now() - down.t0) });
  down = null;
}
surface.addEventListener("pointerup", up);
surface.addEventListener("pointercancel", up);

let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch (_) {
    /* unsupported or refused: the experimenter keeps the phone awake */
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && page === "p-pad") requestWakeLock();
});
$("pad-dev").textContent = RT.version;
