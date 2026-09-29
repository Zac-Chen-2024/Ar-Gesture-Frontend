/* Uses the display's existing socket and rendering; no second input connection. */
(() => {
  const byId = (id) => document.getElementById(`collection-${id}`);
  const panel = byId("panel");
  const toggle = byId("toggle");
  const mode = byId("mode");
  const status = byId("status");
  let state = { enabled: false, attempt: null, phonePaired: false };
  let supported = false;
  let ready = false;
  let pending = false;
  let timer;
  let savedCount = 0;
  let spellingNotice = false;
  const savedIds = new Set();
  let participant;
  try {
    participant = localStorage.getItem("collectionParticipant");
    if (!/^[0-9a-f-]{36}$/i.test(participant || "")) {
      participant = crypto.randomUUID();
      localStorage.setItem("collectionParticipant", participant);
    }
  } catch (_) {
    participant = crypto.randomUUID();
  }

  function render() {
    const active = !!state.attempt;
    const offline = socket.readyState !== WebSocket.OPEN;
    mode.disabled = active || pending;
    byId("start").disabled = offline || !supported || !state.enabled || !state.phonePaired || active || pending;
    byId("save").disabled = offline || !active || pending || !!state.error || !plainText.trim() || currentSpelling.active;
    byId("save").title = currentSpelling.active ? "Commit or cancel the spelling draft first" : "";
    byId("skip").disabled = offline || !active || pending;
    byId("exit").disabled = active || pending;
    toggle.disabled = pending || currentSpelling.active;
    // Fix the device to Phone throughout collection and freeze input settings during a phrase.
    document.querySelectorAll("#device-mode button").forEach((el) => { el.disabled = state.enabled || currentSpelling.active; });
    document.querySelectorAll("#input-mode-switch button, #algo-version, #link-mode button, #lan-mode, #usb-connect").forEach((el) => {
      el.disabled = active || currentSpelling.active;
    });
    if (active) {
      mode.value = state.attempt.mode;
      byId("target").textContent = state.attempt.target;
    }
    if (active && currentSpelling.active) {
      status.textContent = "Finish spelling with ✓ Commit word, or × Cancel, before saving this sentence.";
      spellingNotice = true;
    } else if (spellingNotice) {
      status.textContent = "Continue typing, or save the sentence when ready.";
      spellingNotice = false;
    }
    if (!panel.hidden && offline) status.textContent = "Connection lost. Saved sentences remain on the server. Reload and reconnect your phone to continue.";
    else if (state.error) status.textContent = state.error;
    else if (state.enabled && !state.phonePaired) status.textContent = "Open Mobile on your phone and select the Session code above.";
  }

  function request(payload) {
    if (socket.readyState !== WebSocket.OPEN) return;
    pending = true;
    clearTimeout(timer);
    status.textContent = payload.type === "collection-finish" ? "Saving on the server…" : "Preparing…";
    sendMessage(payload);
    timer = setTimeout(() => {
      pending = false;
      status.textContent = "No confirmation received. Retry the action; the current sentence will not be cleared without confirmation.";
      render();
    }, 12000);
    render();
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("is-collection");
    if (deviceMode === "touchpad") exitTouchpad();
    if (supported) request({ type: "collection-enter" });
    else status.textContent = ready ? "Collection requires the updated backend. Please deploy it first." : "Connecting…";
    requestAnimationFrame(resizeCanvas);
  }

  toggle.addEventListener("click", open);
  byId("start").addEventListener("click", () => request({
    type: "collection-start", participant, mode: mode.value,
    frontendVersion: window.GESTURE_CONFIG.version,
    display: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }
  }));
  byId("save").addEventListener("click", () => request({
    type: "collection-finish", attemptId: state.attempt?.id
  }));
  byId("skip").addEventListener("click", () => request({
    type: "collection-finish", attemptId: state.attempt?.id, skip: true
  }));
  byId("exit").addEventListener("click", () => {
    if (supported && state.enabled) request({ type: "collection-exit" });
    else closePanel();
  });
  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-collection");
    requestAnimationFrame(resizeCanvas);
  }

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "spelling-state") render();
    if (message.type === "state-update") {
      const first = !ready;
      ready = true;
      supported = !!message.collection;
      if (supported) state = message.collection;
      if (first && (new URLSearchParams(location.search).get("collection") === "1" || !panel.hidden)) open();
      render();
    }
    if (message.type !== "collection-update") return;
    state = message;
    pending = false;
    clearTimeout(timer);
    if (message.saved) {
      if (message.saved.status === "completed" && !savedIds.has(message.saved.id)) {
        savedIds.add(message.saved.id);
        savedCount++;
      }
      byId("count").textContent = `${savedCount} sentences saved this visit`;
      byId("target").textContent = "Choose a mode and start your next sentence.";
      status.textContent = message.saved.status === "completed"
        ? `Saved on server: “${message.saved.final_text}”` : "Sentence skipped and recorded.";
    } else {
      status.textContent = message.message || (state.attempt
        ? "Type the phrase on your phone. Correct if needed, then save on this screen."
        : "Choose Center or Continuous, then start a sentence.");
    }
    if (!state.enabled) closePanel();
    render();
    requestAnimationFrame(resizeCanvas);
  });
  socket.addEventListener("close", () => { pending = false; clearTimeout(timer); render(); });
  socket.addEventListener("error", render);
  window.addEventListener("beforeunload", (event) => {
    if (state.attempt) { event.preventDefault(); event.returnValue = ""; }
  });
  render();
})();
