# Ar-Gesture Frontend

Static frontend for the AR-Gesture gesture-typing demo: a phone becomes a blank
touchpad, a display shows the QWERTY keyboard, cursor, candidate bar and the
decoded sentence. Hosted on GitHub Pages; all logic lives in the backend —
**[Zac-Chen-2024/AR-Gesture-Backend](https://github.com/Zac-Chen-2024/AR-Gesture-Backend)**
(`wss://gesture.drziangchen.uk`).

**Live**: <https://zac-chen-2024.github.io/Ar-Gesture-Frontend/>

## Pages

| Page | Role |
|---|---|
| `index.html` | landing page with the two entry points |
| `display.html` | **desktop/AR display**: settings bar, session code, decoded-text row, candidate bar (5 words + ⌫ + Clear/Undo), QWERTY keyboard, cursor & trace |
| `mobile.html` | **phone touchpad**: session picker, then a blank drawing surface (with an optional reference keyboard overlay) — deliberately shows nothing else |

## How to use

1. Open `display.html` on the computer — it shows a 4-digit **Session** code.
2. Open `mobile.html` on the phone and tap that code to pair (badge turns green).
3. Swipe words on the phone; the display decodes them. Everything except the
   settings dropdowns is driven by the touchpad cursor:
   - slide up into the **candidate bar** and lift on a segment to pick a
     candidate / ⌫ / Clear (Undo in v3);
   - in v3 versions, **rest on a key ~1 s and lift** to get letter candidates
     for out-of-vocabulary words (see the backend README for the full flow).

## Settings (the only clickable UI)

Algorithm (v1 SHARK² / v1.1 / v2 WFST / v2.1 / v3a / v3b — populated from the
server) · Mapping (relative/absolute) · Word start (center/continuous) ·
Trace (cursor/gesture) · Phone keys (show/hide) · **Link (Server/LAN)**.

**LAN mode**: when phone and display share a Wi-Fi network, the phone opens a
WebRTC data channel straight to the display and the cursor/trace render at
LAN latency (green **LAN ⚡** badge, bottom-left). The server path keeps
running for decoding and state; if the P2P link cannot form (AP isolation,
different networks) everything silently falls back.

## Configuration & versioning

- `config.js` — backend WSS URL (localhost falls back to same-origin for local
  dev) and the frontend build `version`.
- The build version is shown in the **bottom-right badge**; bump it (and the
  `?v=` query strings in the HTML) on every push so a stale CDN cache is
  immediately visible.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.
All asset paths are relative, so the project-subpath URL works as-is.
