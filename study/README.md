# Gesture typing user study — frontend

Static pages served at gesturetyping.com/study/. They talk to the decoder service
(`wss://api.gesturetyping.com`, override with `?ws=<url>`); the study protocol,
plan, phrases and records live in the backend (`STUDY.md` there).

- `run.html` — participant display. No clicks: typing is decoded by the server;
  ready / rating / break screens use the server's persistent pointer and are
  hit-tested here. Experimenter keys on this machine: S start, N force-submit,
  R redo, P pause.
- `pad.html` — the phone: pairing and intake questionnaire, then a black
  eyes-free touch surface (same stroke messages as the main site's phone page,
  8 mm keys), then the final questionnaire.
- `admin.html` — experimenter console on another device; joins the display's
  room as an observer with `STUDY_ADMIN_TOKEN`.

Local run: start the backend with `HOST=127.0.0.1 PORT=8795 STUDY_ADMIN_TOKEN=…
python3 server.py`, serve this folder (`python3 -m http.server`), and open the
pages with `?ws=ws://127.0.0.1:8795`.

Bump `version` in `config.js` and the `?v=` query strings in the HTML on every
change; the version is stored with each trial.
