// Ar-Gesture frontend runtime config.
// The frontend is hosted statically (e.g. GitHub Pages) and talks to the
// gesture decoding backend over a secure WebSocket. Local dev falls back to
// same-origin so you can run the backend on localhost.
(function () {
  const isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const sameOrigin = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

  window.GESTURE_CONFIG = {
    // Production backend (nginx + WSS on the tap&say host).
    backendWsUrl: isLocal ? sameOrigin : "wss://gesture.drziangchen.uk",
    // Frontend build version, shown in the corner badge. Bump on every push
    // (and keep the ?v= query strings in the HTML in sync).
    version: "v2026-07-05.2"
  };
})();
