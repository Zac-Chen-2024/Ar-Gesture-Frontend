# Ar-Gesture Frontend

Static frontend for the Ar-Gesture gesture-typing demo. Hosted on GitHub Pages;
talks to the decoding backend over a secure WebSocket.

## Pages

- `index.html` — landing page.
- `display.html` — desktop display: QWERTY keyboard, cursor, gesture trace, decoded text, mode controls.
- `mobile.html` — phone touchpad: captures the swipe and streams it to the backend.

## Backend

Configured in `config.js`:

- Production: `wss://gesture.drziangchen.uk`
- Local dev (`localhost`): same-origin WebSocket, so you can run the Node backend locally.

The backend is the multi-version decoder in the `Ar-gesture-multi` project
(single Node router + per-version Python decoders). The frontend can switch
decoder versions at runtime (v1 basic / v2 candidates / v3 WFST).

## Deploy (GitHub Pages)

Settings → Pages → Deploy from a branch → `main` → `/ (root)`.
Served at `https://<user>.github.io/Ar-Gesture-Frontend/`.

All asset paths are **relative** so the project-subpath URL works.
