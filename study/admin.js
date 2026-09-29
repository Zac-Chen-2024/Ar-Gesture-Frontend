// Experimenter console: joins the display's room as an observer (token =
// STUDY_ADMIN_TOKEN on the server), mirrors what the display receives and
// relays commands to it. Records are read back from the server's database.

const $ = (id) => document.getElementById(id);

let sock = null;
let code = null; // observed room
let study = null; // study state (phase, screen, trial, pid, ...)
let session = null; // plan + config
let summary = null;
let text = "";
let cands = [];
let hover = "";
let lastSeen = 0;

$("token").value = localStorage.getItem("studyAdminToken") || "";

$("btn-connect").onclick = () => {
  localStorage.setItem("studyAdminToken", $("token").value);
  sock = window.StudySocket(onMessage, (status) => {
    $("dot-srv").className = "dot" + (status === "open" ? " ok" : "");
    if (status === "open") sock.send({ type: "join", role: "observer", token: $("token").value });
    else $("rooms").textContent = "连接断开";
  });
};

const cmd = (name, arg) => sock && sock.send({ type: "study-command", cmd: name, arg: arg || {} });

$("btn-setup").onclick = () => {
  const pid = $("pid").value.trim().toUpperCase();
  if (!/^P\d{1,4}$/.test(pid)) return $("pid").focus();
  cmd("setup", { pid });
};
document.querySelectorAll("[data-cmd]").forEach((b) => (b.onclick = () => cmd(b.dataset.cmd)));
$("note").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.value.trim() && sock) {
    sock.send({ type: "study-note", text: e.target.value.trim() });
    e.target.value = "";
  }
});
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.repeat) return;
  const c = { s: "start", p: "pause", r: "redo", n: "next" }[e.key.toLowerCase()];
  if (c) cmd(c);
});

function observe(c) {
  sock.send({ type: "observe-room", code: c });
}

function refresh() {
  if (sock && code) sock.send({ type: "study-summary" });
}

function onMessage(m) {
  lastSeen = Date.now();
  switch (m.type) {
    case "observer-denied":
      $("rooms").textContent = "口令错误（或服务器未设置 STUDY_ADMIN_TOKEN）";
      break;
    case "observer-ready":
      renderRooms(m.rooms);
      break;
    case "observe-joined":
      code = m.code;
      $("run-code").textContent = `(${code})`;
      refresh();
      break;
    case "room-error":
      $("rooms").textContent = m.message;
      break;
    case "room-closed":
      code = null;
      study = null;
      $("rooms").textContent = "显示端已断开，请刷新后重新连接";
      render();
      break;
    case "state-update":
      text = m.text || "";
      cands = (m.candidates || []).map((c) => c.word);
      if (m.study) study = m.study;
      render();
      break;
    case "study-update":
      study = { ...study, ...m };
      if (m.error) $("m-err").textContent = `显示端错误：${m.error}`;
      if (m.session) session = m.session;
      if (m.summary) {
        summary = m.summary;
        session = m.summary.session || session;
      }
      if (m.saved || m.session) refresh();
      render();
      break;
    case "candidate-hover":
      hover = m.index >= 0 ? `候选栏 #${m.index}` : "";
      renderMirror();
      break;
    case "action-hover":
      hover = m.slot ? `底栏 ${m.slot}` : "";
      renderMirror();
      break;
    case "study-pointer":
      hover = `指针 (${m.x.toFixed(1)}, ${m.y.toFixed(1)})${m.phase === "up" ? " 松手" : ""}`;
      renderMirror();
      break;
    case "study-next":
      hover = "Next 松手";
      renderMirror();
      break;
  }
}

function renderRooms(rooms) {
  if (!rooms.length) {
    $("rooms").textContent = "没有打开的显示端";
    return;
  }
  $("rooms").innerHTML = rooms
    .map((r) => `<button class="btn" data-room="${r.code}" style="margin:0 4px 4px 0">${r.code}${r.pid ? " · " + r.pid : ""}${r.phone ? " · 📱" : ""}</button>`)
    .join("");
  document.querySelectorAll("[data-room]").forEach((b) => (b.onclick = () => observe(b.dataset.room)));
}

// ---- rendering
const SCREEN = { waiting: "等待开始", ready: "Ready 页", trial: "打字中", feedback: "句间反馈", rating: "评分中",
  break: "休息", end: "已结束", paused: "⏸ 已暂停" };

function render() {
  $("head-pid").textContent = study && study.pid ? `· ${study.pid}` : "";
  $("dot-phone").className = "dot" + (study && study.phonePaired ? " ok" : "");
  $("dot-intake").className = "dot" + (study && study.intake ? " ok" : "");
  $("dot-final").className = "dot" + (study && study.final ? " ok" : "");
  renderConfig();
  renderFlow();
  renderMirror();
  renderRecord();
}

function renderConfig() {
  if (!session) return;
  const c = session.config;
  const rows = [
    ["条件", c.conditions.map((x) => `${x.id}·${x.label}`).join(" / ")],
    ["顺序", session.order.join(" → ")],
    ["练习", `${c.practice_phrases} 句 / 条件`],
    ["正式", `${c.blocks_per_condition} block × ${c.phrases_per_block} 句`],
    ["句间反馈", c.show_trial_feedback ? "显示 WPM / 错误率" : "不显示"],
    ["评分", `${c.rating_items.length} 题 · ${c.rating_scale} 点`],
    ["最短休息", `${c.min_break_ms / 1000} s`],
    ["词典", c.lexicon]
  ];
  $("config").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function renderFlow() {
  if (!session) {
    $("order").innerHTML = '<span class="muted">未建立会话</span>';
    return;
  }
  const trials = summary ? summary.trials : [];
  const doneSet = new Set(trials.filter((t) => t.status === "completed" || t.status === "forced").map((t) => `${t.step}:${t.trial}`));
  const curStep = study && study.trial ? study.trial.step : -1;
  $("order").innerHTML = session.steps
    .map((s, i) => {
      const label = s.kind === "block" ? `${s.cond}·${s.practice ? "练习" : "B" + s.block}` : s.kind === "rating" ? `${s.cond}·评分` : s.kind === "break" ? "休息" : "结束";
      const complete = s.kind === "block" ? s.phrases.every((_, t) => doneSet.has(`${i}:${t}`)) : s.kind === "rating" ? session.rated.includes(s.cond) || (summary && summary.ratings.some((r) => r.cond === s.cond)) : false;
      return `<span class="${i === curStep ? "cur" : complete ? "done" : ""}">${label}</span>`;
    })
    .join("");
}

function renderMirror() {
  const s = study || {};
  let meta = SCREEN[s.screen] || (s.active ? "等待开始" : "未建立会话");
  if (s.phase) meta += ` · phase=${s.phase}`;
  if (hover) meta += ` · ${hover}`;
  $("m-meta").textContent = meta;
  $("m-target").textContent = s.trial ? s.trial.target : "";
  $("m-typed").textContent = s.trial ? text : "";
  $("m-cands").textContent = s.trial && cands.length ? `候选: ${cands.join(" / ")}` : "";
}

function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function renderRecord() {
  if (!summary) return;
  const rows = summary.trials.slice().reverse();
  $("trial-count").textContent = `(${rows.length})`;
  const statusName = { completed: "", forced: "强制", redo: "重做", interrupted: "中断", in_progress: "进行中" };
  $("trials").innerHTML = rows
    .map((t) => {
      const c = t.client || {};
      const cls = t.flagged || !["completed", "forced"].includes(t.status) ? "flag" : t.practice ? "practice" : "";
      return `<tr class="${cls}">
        <td>${t.cond}${t.practice ? "·练" : "·B" + t.block}<br><span class="muted">${statusName[t.status] ?? t.status}${t.attempt > 1 ? " #" + t.attempt : ""}</span></td>
        <td>${t.trial + 1}</td>
        <td>${t.target}<br><span style="color:var(--accent)">${t.final_text || "∅"}</span></td>
        <td class="n">${fmt(c.wpm)}</td><td class="n">${Number.isFinite(c.cer) ? Math.round(c.cer * 100) + "%" : "—"}</td>
        <td class="n">${c.strokes ?? "—"}</td>
        <td>${["completed", "forced"].includes(t.status) ? `<button class="btn" style="padding:2px 6px" data-flag="${t.id}" data-v="${t.flagged ? 0 : 1}">${t.flagged ? "恢复" : "无效"}</button>` : ""}</td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-flag]").forEach(
    (b) => (b.onclick = () => {
      sock.send({ type: "study-flag", trialId: b.dataset.flag, flagged: b.dataset.v === "1" });
      setTimeout(refresh, 150);
    })
  );

  if (session) {
    const conds = session.config.conditions;
    const rowsHtml = conds.map((c) => {
      const ts = summary.trials.filter((t) => t.cond === c.id && !t.practice && !t.flagged && t.status === "completed" && t.client);
      const mean = (f) => (ts.length ? ts.reduce((a, t) => a + f(t), 0) / ts.length : NaN);
      return `<tr><td>${c.id}·${c.label}</td><td class="n">${ts.length}</td><td class="n">${fmt(mean((t) => t.client.wpm))}</td><td class="n">${fmt(mean((t) => t.client.cer * 100))}%</td></tr>`;
    });
    $("summary").innerHTML = `<tr><th>条件</th><th class="n">n</th><th class="n">WPM</th><th class="n">CER</th></tr>${rowsHtml.join("")}`;
  }

  $("ratings").innerHTML = summary.ratings.length
    ? summary.ratings
        .map((g) => `<div style="margin-bottom:6px"><b>${g.cond}</b> ${Object.entries(g.answers).map(([k, v]) => `<span class="logline">${k.replace("tlx_", "")}=${v}</span>`).join(" ")}</div>`)
        .join("")
    : "—";
  const q = [];
  const kv = (o) => Object.entries(o).filter(([k]) => !["device", "received_at"].includes(k)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(">") : v}`).join(" · ");
  if (summary.intake) q.push(`<div><b>开始</b> ${kv(summary.intake)}</div>`);
  if (summary.final) q.push(`<div style="margin-top:6px"><b>结束</b> ${kv(summary.final)}</div>`);
  $("questionnaires").innerHTML = q.join("") || "—";
}

$("exp-csv").onclick = () => {
  if (!summary) return;
  const cols = ["cond", "practice", "block", "trial", "attempt", "status", "flagged", "target", "final_text", "started_at", "ended_at"];
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = [["pid", ...cols, "wpm", "cer", "strokes"].join(",")].concat(
    summary.trials.map((t) => [study.pid, ...cols.map((c) => t[c]), t.client?.wpm, t.client?.cer, t.client?.strokes].map((v) => esc(v ?? "")).join(","))
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `${study.pid}-trials.csv`;
  a.click();
};

setInterval(() => {
  $("dot-run").className = "dot" + (code && Date.now() - lastSeen < 60000 ? " ok" : "");
}, 1500);
