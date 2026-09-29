// Runtime config. Production talks to the shared decoder service; ?ws=<url>
// points a page at another backend (local testing).
(function () {
  const override = new URLSearchParams(location.search).get("ws");
  window.STUDY_CONFIG_RUNTIME = {
    backendWsUrl: override || "wss://api.gesturetyping.com",
    // Study frontend build, stored with every trial. Bump on every change.
    version: "study-v2026-09-29.1"
  };
})();
