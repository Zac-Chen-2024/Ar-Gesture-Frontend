// /band: the Neural Band drives the main display as a touchpad would.
//
// Kinesis streams the band's raw events into a band room (band_relay.py on the
// server). This page turns them into the touchpad's messages and sends those, over
// a second socket, into its own display room: the server's Unify path then moves
// the cursor, decodes and fills the bar exactly as for the laptop touchpad.
//
// - pointer: the forearm's direction (Kinesis's ForearmAim: the band's +y axis,
//   negated on a left wrist). Turning it by `gain` degrees moves the cursor one key.
// - Unify (Space, Double, Long press): the cursor follows the arm, an index pinch
//   is the touchpad's button. The wrist turns a little as the fingers close, so the
//   press lands where the cursor was 100 ms before the band reported it, and the
//   cursor holds still until 50 ms after the release.
// - the stroke modes (Center, Continuous, Long press, Revert) are the phone's: an
//   index pinch is the finger down, the arm moves it, the release lifts it. The
//   stroke starts where the cursor was 100 ms before the press and ends where it
//   was 50 ms before the release.
// - late samples (Kinesis's late flag) never move the cursor; the next fresh one
//   re-anchors it.
// ?ws=ws://localhost:8790 points the band room at another server (local work).
(() => {
  // the input joins the display's own server; ?ws= moves only the band room
  const INPUT_URL = window.GESTURE_CONFIG.backendWsUrl;
  const BAND_URL = new URLSearchParams(location.search).get("ws") || INPUT_URL;
  const REWIND_S = 0.1;
  const SETTLE_S = 0.05;
  const HISTORY_S = 1;

  const badge = document.getElementById("band-badge");
  const codeEl = document.getElementById("band-code");
  const statusEl = document.getElementById("band-status");
  const gainSwitch = document.getElementById("band-gain");

  let gain = 3.5; // degrees of forearm turn per key
  try { gain = Number(localStorage.getItem("band-gain")) || gain; } catch (e) { /* private window */ }
  function syncGain() {
    gainSwitch.querySelectorAll("button[data-value]").forEach((button) => {
      const on = Number(button.dataset.value) === gain;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  gainSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    gain = Number(button.dataset.value);
    try { localStorage.setItem("band-gain", String(gain)); } catch (e) { /* not kept */ }
    syncGain();
  });
  if (![5, 3.5, 2.5].includes(gain)) gain = 3.5;
  syncGain();

  const setStatus = (text, paired = false) => {
    statusEl.textContent = text;
    badge.classList.toggle("is-paired", paired);
  };

  // ---- the display opens in Unify (Space): a pinch is a click, Space decodes ----
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    if (message.type === "room-created") {
      sendMessage({ type: "mode-set", mode: "unify" });
      openInput();
    }
  });

  // ---- band room: Kinesis's raw events arrive here ----
  let bandSocket = null;
  let bandPaired = false;
  let handSign = 1;

  function connectBand() {
    const ws = new WebSocket(BAND_URL);
    bandSocket = ws;
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", role: "display", kind: "band" })));
    ws.addEventListener("message", (event) => {
      if (ws !== bandSocket) return;
      let message;
      try { message = JSON.parse(event.data); } catch (e) { return; }
      onBand(message);
    });
    ws.addEventListener("close", () => {
      if (ws !== bandSocket) return;
      bandPaired = false;
      codeEl.textContent = "····";
      setStatus("reconnecting…");
      closeInput();
      setTimeout(connectBand, 1500);
    });
  }

  function onBand(message) {
    switch (message.type) {
      case "room-created":
        codeEl.textContent = message.code;
        setStatus("waiting for band…");
        break;
      case "band-joined":
        bandPaired = true;
        handSign = message.deviceInfo?.hand === "left" ? -1 : 1;
        resetPointer();
        setStatus("band joined", true);
        openInput();
        break;
      case "band-left":
        bandPaired = false;
        setStatus("waiting for band…");
        closeInput();
        break;
      case "band-status":
        if (message.hand) handSign = message.hand === "left" ? -1 : 1;
        if (message.connected === false) setStatus("band not connected");
        else if (bandPaired) setStatus(inputReady ? "band live" : "band joined", true);
        break;
      case "band-batch":
        for (const e of message.events || []) onEvent(e);
        flushMove();
        break;
    }
  }

  // ---- input socket: the touchpad in this display's own room ----
  let inputSocket = null;
  let inputReady = false;

  function openInput() {
    if (inputSocket || !bandPaired || !currentRoomCode) return;
    const ws = new WebSocket(INPUT_URL);
    inputSocket = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", role: "mobile", inputDevice: "touchpad" }));
      ws.send(JSON.stringify({ type: "join-room", code: currentRoomCode }));
    });
    ws.addEventListener("message", (event) => {
      if (ws !== inputSocket) return;
      let message;
      try { message = JSON.parse(event.data); } catch (e) { return; }
      if (message.type === "room-joined") {
        inputReady = true;
        stroke = null;
        setStatus("band live", true);
      } else if (message.type === "room-error" || message.type === "room-closed") {
        setStatus(message.message || "could not join the display");
        closeInput();
      }
    });
    ws.addEventListener("close", () => {
      if (ws !== inputSocket) return;
      inputSocket = null;
      inputReady = false;
      if (bandPaired) setTimeout(openInput, 1500);
    });
  }

  function closeInput() {
    drawing = null;
    const ws = inputSocket;
    inputSocket = null;
    inputReady = false;
    if (ws) {
      if (stroke && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "gesture-end" }));
      ws.close();
    }
    stroke = null;
  }

  function sendInput(payload) {
    if (inputReady && inputSocket?.readyState === WebSocket.OPEN) inputSocket.send(JSON.stringify(payload));
  }

  // ---- pointer ----
  let lastAim = null;         // {right, up} of the previous fresh sample
  let pointer = { x: 0, y: 0 }; // keys, accumulated since the page opened; y grows downward
  let history = [];           // {t (band clock, s), x, y}
  let sent = null;            // the pointer as last sent
  let stroke = null;          // {ox, oy, t0}: the server's stroke, relative to its own start
  let pressedAt = null;       // band time of the index press holding the cursor
  let settleUntil = -Infinity;
  let drawing = null;         // {ox, oy, t0}: a stroke-mode stroke while the pinch is held

  function resetPointer() {
    lastAim = null; history = []; pressedAt = null; settleUntil = -Infinity;
  }

  function aimOf(v) {
    // [w, x, y, z]; the forearm is the band's +y in the world frame
    const [w, x, y, z] = v;
    const fx = 2 * (x * y - w * z) * handSign, fy = (1 - 2 * (x * x + z * z)) * handSign, fz = 2 * (y * z + w * x) * handSign;
    // azimuth grows to the left, so right is its negative
    return { right: -Math.atan2(fy, fx) * 180 / Math.PI, up: Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI };
  }

  function pointerAt(t) {
    let best = history[0];
    for (const h of history) { if (h.t <= t) best = h; else break; }
    return best ? { x: best.x, y: best.y } : { ...pointer };
  }

  function onEvent(e) {
    const t = e.t / 1e6;
    if (e.event === "quat" && Array.isArray(e.v)) {
      if (e.late) { lastAim = null; return; } // where the arm was, not where it is
      const aim = aimOf(e.v);
      const held = isUnifyMode() && (pressedAt !== null || t < settleUntil);
      if (lastAim && !held) {
        let dRight = aim.right - lastAim.right;
        if (dRight > 180) dRight -= 360;
        if (dRight < -180) dRight += 360;
        pointer = { x: pointer.x + dRight / gain, y: pointer.y - (aim.up - lastAim.up) / gain };
      }
      lastAim = aim;
      history.push({ t, x: pointer.x, y: pointer.y });
      while (history.length && t - history[0].t > HISTORY_S) history.shift();
    } else if (e.event === "gesture" && e.finger === "index" && !e.late) {
      if (e.action === "press") onPress(t);
      else if (e.action === "release") onRelease(t);
    }
  }

  function onPress(t) {
    if (drawing) endStroke(t); // a release the band never reported
    pressedAt = t;
    pointer = pointerAt(t - REWIND_S); // where the cursor was before the fingers closed
    if (!isUnifyMode()) {
      drawing = { ox: pointer.x, oy: pointer.y, t0: performance.now() };
      sendInput({ type: "gesture-start", point: { x: 0, y: 0, t: 0 } });
      sent = { ...pointer };
      return;
    }
    badge.classList.add("is-frozen");
    flushMove();
    if (currentInputMode !== "unify") sendInput({ type: "unify-press" }); // the server tells a click from a hold
  }

  function onRelease(t) {
    if (pressedAt === null) return;
    pressedAt = null;
    if (drawing) { endStroke(t); return; }
    settleUntil = t + SETTLE_S;
    badge.classList.remove("is-frozen");
    if (currentInputMode === "unify") {
      flushMove();
      sendInput({ type: "unify-click" });
      stroke = null; // the server ends the stroke on a click; the next move starts one
    } else {
      sendInput({ type: "unify-release" });
    }
  }

  function endStroke(t) {
    pointer = pointerAt(t - SETTLE_S); // the opening fingers turn the wrist too
    flushMove();
    sendInput({ type: "gesture-end", t: Math.round(performance.now() - drawing.t0) });
    drawing = null;
    pressedAt = null;
  }

  function flushMove() {
    if (!inputReady) return;
    if (sent && Math.abs(sent.x - pointer.x) < 1e-4 && Math.abs(sent.y - pointer.y) < 1e-4) return;
    if (drawing) {
      sendInput({ type: "gesture-move", point: {
        x: pointer.x - drawing.ox, y: pointer.y - drawing.oy, t: Math.round(performance.now() - drawing.t0) } });
      sent = { ...pointer };
      return;
    }
    if (!isUnifyMode()) return; // stroke modes move only while pinched, as a finger on the phone
    if (!stroke) {
      stroke = { ox: pointer.x, oy: pointer.y, t0: performance.now() };
      sendInput({ type: "gesture-start", point: { x: 0, y: 0, t: 0 } });
    }
    sendInput({ type: "gesture-move", point: {
      x: pointer.x - stroke.ox, y: pointer.y - stroke.oy, t: Math.round(performance.now() - stroke.t0) } });
    sent = { ...pointer };
  }

  connectBand();
})();
