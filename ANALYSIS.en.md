# Ar-Gesture-Frontend Code Analysis (English)

> 中文版：[ANALYSIS.zh.md](ANALYSIS.zh.md)

## 1. What this repo is

This is the **frontend** of an AR gesture-typing demo: a phone becomes a blank touchpad, while a desktop/AR display shows the QWERTY keyboard, cursor, trace, candidate bar and decoded text. All decoding lives in the backend (`Ar-gesture-multi`, Python); the frontend is a **pure static site** hosted on GitHub Pages, talking to the backend over WSS (`wss://gesture.drziangchen.uk`).

## 2. Tech stack and code types

| Part | Language / tech | Notes |
|---|---|---|
| Page structure | **HTML5** | `index.html` / `display.html` / `mobile.html`, no templating |
| All logic | **Vanilla JavaScript (ES6+)** | No framework (no React/Vue), no build tooling (no webpack/vite), zero third-party dependencies |
| Styling | **Plain CSS** | Single `styles.css`; CSS variables + Flexbox; mode classes on `body` drive UI state |
| Realtime transport | **WebSocket API** (browser-native) | The only persistent channel to the backend; JSON messages |
| LAN low-latency path | **WebRTC RTCDataChannel** | Optional LAN mode: phone→display peer-to-peer link, rendering acceleration only |
| Drawing | **Canvas 2D API** | Trace rendering on both pages |
| Touch input | **Pointer Events API** | `pointerdown/move/up/leave/cancel` unify touch and mouse |

**There is no Python here**: zero server code, zero build step — `git push` deploys (GitHub Pages). Cache-busting is manual, via `?v=` query strings in the HTML kept in sync with the version in `config.js:15`.

## 3. File layout and responsibilities

```
Ar-Gesture-Frontend/
├── index.html      # landing page: Display / Mobile entry buttons (inline CSS)
├── config.js       # runtime config: backend WSS URL + build version
├── display.html    # display page skeleton: settings bar, session badge, text row, candidate strip, keyboard, canvas
├── display.js      # all display-side logic (601 lines)
├── mobile.html     # phone page skeleton: session picker, fullscreen canvas, reference keyboard overlay
├── mobile.js       # all phone-side logic (405 lines)
└── styles.css      # all styles shared by both pages
```

### 3.1 config.js — environment-aware config

`config.js:5-17`: an IIFE sets a global `window.GESTURE_CONFIG`. Local dev (`localhost`/`127.0.0.1`) falls back to same-origin `ws://`; production pins `wss://gesture.drziangchen.uk`. This is the frontend's entire "configuration system".

## 4. Core concept: keyboard-unit coordinates

Frontend and backend share a coordinate system with **the G key at the origin and one key width/height as unit 1** (the whole keyboard is 10×3 units). All frontend geometry revolves around it:

- Display: `updateKeyboardReference()` (`display.js:71-85`) reads the DOM rect of `[data-key="G"]` to get the anchor pixel point `keyboardAnchorPoint` and `keyboardMetrics` (one key's pixel size).
- `toDisplayPoint()` (`display.js:92-97`): `pixel = anchor + units × keyWidth/keyHeight`, converting server-sent global gesture points to screen pixels.
- Phone: `toKeyboardUnits()` (`mobile.js:201-207`) is the inverse — touch pixel displacement divided by the overlay keyboard's key size, sent as **unit displacement relative to the stroke start**.

Phone screen size and display resolution are thus fully decoupled; the server only ever sees keyboard units.

## 5. mobile.js — the phone touchpad (405 lines)

Design principle (comment at `mobile.js:13-14`): **the phone is a dumb touchpad**. It does no long-press/dwell detection; v3 letter-input detection happens entirely server-side.

### 5.1 Gesture capture and reporting

- `startGesture()` (`mobile.js:209-239`): on `pointerdown`. Ignored when unpaired or already drawing; `setPointerCapture` locks the pointer; relative mode shows the reference keyboard overlay under the finger (`showOverlay`, `mobile.js:167-170`), absolute mode requires the touch to land inside the fixed keyboard rect (`mobile.js:217-219`). Sends `{type:"gesture-start", point:{x,y,t:0}}`.
- `moveGesture()` (`mobile.js:241-258`): draws the segment on the local canvas, converts the point to units and attaches `t` (ms since stroke start via `performance.now()`, `mobile.js:253` — used server-side for recording and future dwell/speed-aware decoding), sends `gesture-move`.
- `endGesture()` (`mobile.js:260-276`): clears the canvas, resets state, sends `gesture-end`.

Coordinate handling per mapping mode:

- **relative** (default): `toKeyboardUnits()` sends relative displacement; the server picks the start point per center/continuous mode.
- **absolute**: `toAbsoluteKeyboardPoint()` (`mobile.js:193-199`) normalizes the touch into the keyboard rect's [0,1]×[0,1]; the server maps that to [-5,5]×[-1.5,1.5].

### 5.2 Session pairing (rooms)

`mobile.js:278-331`: on WS open, sends `{type:"join", role:"mobile"}` to enter the lobby; on `room-list`, `renderRooms()` renders each non-busy 4-digit session code as a button which sends `join-room` on tap. `room-joined` hides the picker and enters touchpad mode; `room-closed`/`room-error`/disconnect return to the picker (`showPicker`).

### 5.3 LAN mode (WebRTC offerer)

`mobile.js:16-65`: when the display enables LAN mode (via the `lanMode` flag in `state-update`, `mobile.js:377-387`), the phone acts as the **offerer** and builds an `RTCPeerConnection`:

- `iceServers: []` (`mobile.js:43`) — no STUN/TURN, host/mDNS candidates only, **forcing a same-LAN direct link**;
- creates a DataChannel named `"trace"`; SDP offer / ICE candidates travel through the server WS (the server is signaling relay only);
- `p2pSend()` (`mobile.js:59-65`): every gesture message is mirrored onto the DataChannel **in addition to** the server WS. The WS path is untouched — decoding and recording behave exactly as before; the P2P channel merely lets the display render the cursor without a WAN round trip. Failures degrade silently (empty `catch`).

## 6. display.js — the display (601 lines)

### 6.1 Rendering pipeline

- `resizeCanvas()` (`display.js:54-69`): sizes the canvas backing store by `devicePixelRatio`; `sizeKeyboardToTextRow()` (`display.js:44-52`) sets the CSS variable `--key-width` so 10 keys exactly span the text row.
- Gesture rendering: on `gesture-start`, re-measure keyboard geometry, clear the canvas, move the cursor; on `gesture-move`, `moveCursor()` moves the DOM cursor dot and, only when Trace=gesture, `drawSegment()` (`display.js:131-140`) draws a black round-capped segment; on `gesture-end`, clear (`display.js:397-428`).

### 6.2 Candidate strip (display-only)

`renderCandidates()` (`display.js:168-193`): a fixed 7-segment row — 5 word slots + ⌫ + Clear (which becomes Undo ↩ under v3 versions, `display.js:191`). **Key constraint**: each segment's flex weight `candidateWeight()` (`display.js:159-162`) is `max(len(word), 2)`, and the comment requires it to match the server's `candidate_slot` weighting — because **selection is decided server-side** (the cursor sliding up into the bar, segment picked by x coordinate); the frontend only draws segments at matching proportions and reacts to `candidate-hover` highlighting (`display.js:195-199`). There are no click handlers on the strip.

### 6.3 State sync: the server is the single source of truth

Every setting (algorithm version / mapping / word start / trace / phone keys / LAN) follows a one-way flow: "send request to server → server broadcasts `state-update` → both ends apply it". To prevent the echo loop "server writes the `<select>` value → fires change → sends back to server", each dropdown has an `isApplyingServer*` boolean latch (`display.js:18-29,245`): set true while applying, and the change listeners (`display.js:526-591`) bail out when it is set. This is the file's signature pattern, repeated 7 times.

`state-update` handling (`display.js:430-523`) also covers: decoded text with auto-scroll to the newest word (`display.js:433`), `populateVersions()` filling the algorithm dropdown once from the server-sent list (`display.js:142-157`), `cursorKey` homing the cursor, and `reset` clearing canvas and candidates.

### 6.4 v3 letter-input feedback

`renderLetterState()` (`display.js:208-236`): reacts to server `letter-state` messages. The `armed` state shows a letter badge ("lift = input"); `pending`/`positioning` render an **insertion caret** inside the decoded text (`<span class="text-caret">`) — the caret may equal `len+1`, meaning "insert as a new word" (rendered after a gap, `display.js:228-234`). Note `escapeHtml()` (`display.js:204-206`) guards against injection since this path uses `innerHTML`.

### 6.5 LAN mode (WebRTC answerer)

`display.js:238-330`: on receiving the phone's server-relayed `rtc-offer`, builds an `RTCPeerConnection` (also `iceServers: []`) and answers. When the DataChannel opens, `p2pActive=true` and the "LAN ⚡" badge lights up; `handleP2pTrace()` (`display.js:285-302`) renders directly from the phone's raw payload, with `p2pGlobalPoint()` (`display.js:275-283`) **replicating the server's coordinate transforms client-side** (absolute's `x*10-5, y*3-1.5`, and relative's start-point addition), so P2P rendering matches the server path pixel-for-pixel. While P2P is active, the server's echoed `gesture-*` messages are ignored (`display.js:398-399,410,423`); if the channel drops, everything falls back automatically.

## 7. styles.css — mode-driven styling

- Layout core: the `--key-width` CSS variable determines all sizing (keys, candidate strip, text row); JS sets only this one variable.
- State is expressed as classes on `body`: `is-absolute-mode` / `is-continuous-mode` / `is-cursor-visual-mode` / `is-mobile-keyboard-hidden` / `is-paired`, toggled by `applyModeClasses()` on both ends (`display.js:123-129`, `mobile.js:74-88`); CSS cascades the corresponding UI (e.g. the reference keyboard pinned centered in absolute mode, the G-key anchor highlighted in continuous mode).
- Component sections: top-bar settings, candidate strip (`.candidate-seg`, `.is-hover`, `.is-top`), room-code badge (`.room-code.is-paired` turns green), session picker, letter badge, LAN badge, build badge.

## 8. Message protocol (frontend's view)

**Frontend → server**: `join` (with role), `join-room`, `list-rooms`, `gesture-start/move/end`, `mapping-mode-set`, `mode-set`, `visual-mode-set`, `mobile-keyboard-set`, `version-set`, `lan-mode-set`, `rtc-offer/answer/ice` (signaling passthrough).

**Server → frontend**: `room-created`, `room-list`, `room-joined`, `room-closed`, `room-error`, `mobile-joined/left`, `gesture-start/move/end/cancel`, `candidate-hover`, `letter-state`, `state-update` (full state snapshot), `text-update`, `rtc-*`.

## 9. Design takeaways

1. **Thin client**: decoding, dwell detection, candidate-selection logic and undo all live server-side; the frontend only captures and renders — hence ~1000 lines of JS total across both pages.
2. **Server-authoritative + echo-suppression latches**: all UI state round-trips through the server; the `isApplyingServer*` pattern prevents loops.
3. **Dual-channel resilience**: the WS is the always-on primary path; the WebRTC LAN channel is acceleration only and degrades silently.
4. **Implicit frontend/backend contracts**: candidate-strip segment weights (`display.js:159` ↔ server `candidate_slot`) and coordinate transforms (`display.js:275` ↔ server `to_absolute_keyboard_point`) must be kept in sync by hand — the most likely maintenance trap.
