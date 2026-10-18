// Guided collection on /band: spoken prompts walk through a set of movements, each one
// is recorded on its own, and the results show what the pointer mapping made of it.
// The steps also go to the server as band-mark messages, so its recording carries them.

const COLLECT_STEPS = [];
for (const [group, groupName, how] of [
  ["arm", "整只手臂平移", (d) => `整只手臂向${d}平移，手腕保持不动，然后停住`],
  ["wrist", "只转手腕", (d) => `手臂不动，只把手腕向${d}转，然后停住`],
  ["point", "像激光笔一样指", (d) => `像拿着激光笔，把它指向${d}边，然后停住`],
]) {
  for (const [dir, word, vec] of [["right", "右", [1, 0]], ["left", "左", [-1, 0]], ["up", "上", [0, 1]], ["down", "下", [0, -1]]]) {
    COLLECT_STEPS.push({ id: `${group}_${dir}`, group, groupName, word, vec, text: how(word) });
  }
}
const PREPARE_MS = 1700, RECORD_MS = 2500, RETURN_MS = 1500;

const collectButton = document.getElementById("collect");
const collectInfo = document.getElementById("collect-info");
const prompt = document.getElementById("prompt");
const promptStep = document.getElementById("prompt-step");
const promptText = document.getElementById("prompt-text");
const promptPhase = document.getElementById("prompt-phase");
const results = document.getElementById("collect-results");
const summary = document.getElementById("collect-summary");

let capture = null; // {quats: [], gyros: []} while a step records
bandListeners.push((e) => {
  if (!capture) return;
  if (e.event === "quat" && Array.isArray(e.v)) capture.quats.push({ t: e.t / 1e6, v: e.v });
  else if (e.event === "gyro" && Array.isArray(e.v)) capture.gyros.push({ t: e.t / 1e6, v: e.v });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1.15;
    speechSynthesis.speak(u);
  } catch (e) { /* no speech: the prompt on screen still says it */ }
}

function mark(step, kind) {
  sendToServer({ type: "band-mark", step, kind, at: Date.now() });
}

// pointer angles of one recorded step, relative to where it started (deg; right and up positive)
function trace(step) {
  let last = null;
  const points = step.quats.map(({ v }) => {
    const [fx, fy, fz] = forearmOf(v);
    let right = -Math.atan2(fy, fx) * 180 / Math.PI;
    if (last !== null) {
      while (right - last > 180) right -= 360;
      while (right - last < -180) right += 360;
    }
    last = right;
    return [right, Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI];
  });
  if (!points.length) return [];
  const [r0, u0] = points[0];
  return points.map(([r, u]) => [r - r0, u - u0]);
}

function judge(step) {
  const points = trace(step);
  if (points.length < 10) return { points, ok: false, along: 0, across: 0, missing: true };
  // the furthest point from the start is where the movement went
  let far = points[0], best = 0;
  for (const p of points) { const d = Math.hypot(p[0], p[1]); if (d > best) { best = d; far = p; } }
  const [vx, vy] = step.def.vec;
  const along = far[0] * vx + far[1] * vy;
  const across = Math.abs(far[0] * -vy + far[1] * vx);
  // integrated gyro per axis (counts × 0.07 ≈ deg/s, × dt)
  const gyro = [0, 0, 0];
  for (let i = 1; i < step.gyros.length; i++) {
    const dt = step.gyros[i].t - step.gyros[i - 1].t;
    if (dt > 0 && dt < 0.1) for (let k = 0; k < 3; k++) gyro[k] += step.gyros[i].v[k] * 0.07 * dt;
  }
  return { points, far, along, across, gyro, ok: along >= 4 && across <= Math.max(3, along * 0.5) };
}

function drawStep(canvas, step, result) {
  const ratio = devicePixelRatio || 1, size = 150;
  canvas.width = size * ratio; canvas.height = size * ratio;
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const extent = Math.max(15, ...result.points.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.15;
  const scale = size / 2 / extent, c = size / 2;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx.strokeStyle = css("--hair"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, size); ctx.moveTo(0, c); ctx.lineTo(size, c); ctx.stroke();
  // where it should have gone
  ctx.strokeStyle = css("--green"); ctx.lineWidth = 6; ctx.globalAlpha = 0.25; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(c, c);
  ctx.lineTo(c + step.def.vec[0] * size * 0.42, c - step.def.vec[1] * size * 0.42); ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineCap = "butt";
  // where it went
  ctx.strokeStyle = css("--red"); ctx.lineWidth = 1.8;
  ctx.beginPath();
  result.points.forEach(([r, u], i) => {
    const x = c + r * scale, y = c - u * scale;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = css("--ink-faint");
  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.fillText(`±${Math.round(extent)}°`, 4, size - 4);
}

function render(steps) {
  results.innerHTML = "";
  const groups = new Map();
  for (const step of steps) {
    const result = judge(step);
    const card = document.createElement("div");
    card.className = "card" + (result.ok ? " ok" : " bad");
    const canvas = document.createElement("canvas");
    card.append(canvas);
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = `${step.def.groupName} · 向${step.def.word}`;
    const detail = document.createElement("div");
    detail.className = "card-detail";
    detail.textContent = result.missing ? "没有收到数据"
      : `${result.ok ? "✓" : "✗"} 目标方向 ${result.along.toFixed(0)}°，偏离 ${result.across.toFixed(0)}°`;
    const gyro = document.createElement("div");
    gyro.className = "card-gyro";
    if (result.gyro) gyro.textContent = `陀螺仪积分 x ${result.gyro[0].toFixed(0)}° · y ${result.gyro[1].toFixed(0)}° · z ${result.gyro[2].toFixed(0)}°`;
    card.append(title, detail, gyro);
    results.append(card);
    drawStep(canvas, step, result);
    const g = groups.get(step.def.groupName) || [];
    g.push(result);
    groups.set(step.def.groupName, g);
  }
  summary.textContent = [...groups].map(([name, rs]) => {
    const ok = rs.filter((r) => r.ok).length;
    const mean = rs.reduce((a, r) => a + Math.max(0, r.along), 0) / rs.length;
    return `${name}：方向正确 ${ok}/${rs.length}，平均转动 ${mean.toFixed(0)}°`;
  }).join("　·　");
}

async function runCollection() {
  collectButton.disabled = true;
  results.innerHTML = "";
  summary.textContent = "";
  prompt.hidden = false;
  const steps = [];
  speak("动作采集开始。每个动作做完停住，听到回到中间再回来。");
  promptStep.textContent = "";
  promptText.textContent = "手臂自然放在身前，看着屏幕正前方";
  promptPhase.textContent = "准备";
  await sleep(3500);
  mark("collection", "start");
  for (const [i, def] of COLLECT_STEPS.entries()) {
    promptStep.textContent = `${i + 1} / ${COLLECT_STEPS.length} · ${def.groupName}`;
    promptText.textContent = def.text;
    promptPhase.textContent = "准备";
    prompt.dataset.phase = "prepare";
    speak(`${def.groupName}，向${def.word}`);
    await sleep(PREPARE_MS);
    promptPhase.textContent = "现在做";
    prompt.dataset.phase = "record";
    capture = { quats: [], gyros: [] };
    mark(def.id, "start");
    await sleep(RECORD_MS);
    mark(def.id, "end");
    steps.push({ def, ...capture });
    capture = null;
    promptPhase.textContent = "回到中间";
    prompt.dataset.phase = "return";
    await sleep(RETURN_MS);
  }
  mark("collection", "end");
  speak("采集完成");
  prompt.hidden = true;
  collectButton.disabled = !paired;
  collectInfo.textContent = "完成。绿色粗线是应该去的方向，红线是映射出来的轨迹。";
  render(steps);
}

collectButton.addEventListener("click", () => { if (paired) runCollection(); });
setInterval(() => {
  if (!prompt.hidden) return;
  collectButton.disabled = !paired;
}, 500);
