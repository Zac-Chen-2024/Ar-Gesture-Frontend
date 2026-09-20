// Runtime config. Local dev falls back to a same-origin WebSocket; add
// ?backend=prod to a localhost URL to use the production service.
(function () {
  const forceProd = new URLSearchParams(location.search).get("backend") === "prod";
  const isLocal =
    !forceProd &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  const sameOrigin = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

  window.GESTURE_CONFIG = {
    backendWsUrl: isLocal ? sameOrigin : "wss://api.gesturetyping.com",
    // Frontend build version, shown in the corner badge. Bump on every push
    // (and keep the ?v= query strings in the HTML in sync).
    version: "v2026-09-20.1",
    // USB-tethering subnets used to pin the P2P cursor path to the cable when
    // Link is set to USB. AOSP RNDIS defaults to 192.168.42.0/24; iPhone
    // Personal Hotspot always uses 172.20.10.0/28. Extend as observed.
    usbSubnets: ["192.168.42.", "172.20.10."]
  };
})();
