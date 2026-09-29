// Shared pieces for the study pages: key geometry (key units, G's center at
// the origin, same as the server), the server's candidate-bar layout, text
// entry metrics and a small WebSocket wrapper.

window.KEY_XY = {
  q: [-4.5, -1], w: [-3.5, -1], e: [-2.5, -1], r: [-1.5, -1], t: [-0.5, -1],
  y: [0.5, -1], u: [1.5, -1], i: [2.5, -1], o: [3.5, -1], p: [4.5, -1],
  a: [-4, 0], s: [-3, 0], d: [-2, 0], f: [-1, 0], g: [0, 0], h: [1, 0],
  j: [2, 0], k: [3, 0], l: [4, 0],
  z: [-3.5, 1], x: [-2.5, 1], c: [-1.5, 1], v: [-0.5, 1], b: [0.5, 1],
  n: [1.5, 1], m: [2.5, 1]
};

// Mirrors server.py: CANDIDATE_ZONE_Y_RELATIVE, ACTION_ZONE_Y_RELATIVE,
// CLEAR_ZONE_X, NEXT_ZONE_X_MIN, STUDY_POINTER_X/Y.
window.ZONES = {
  candY: -1.8,
  actionY: 1.8,
  band: 0.45, // drawn depth of the bars
  clearX: [-5, -4],
  nextX: [4, 5], // the server's Next zone is open to the right (x >= 4)
  pointerX: [-5.5, 5.5],
  pointerY: [-2.6, 2.6]
};

// Mirrors server.py candidate_segments(): 5 word slots in display order
// [3, 1, 0, 2, 4] weighted by word length (min 2), then backspace (weight 2),
// spread over x in [-5, 5]. Picks are positional, so this must match exactly.
window.candidateSegments = function (candidates) {
  const segs = [3, 1, 0, 2, 4].map((i) => {
    const word = candidates[i] ? candidates[i].word : "";
    return { kind: "word", word, rank: i, weight: Math.max(word.length, 2) };
  });
  segs.push({ kind: "backspace", word: "⌫", weight: 2 });
  const total = segs.reduce((a, s) => a + s.weight, 0);
  let x = -5;
  segs.forEach((s) => {
    s.x0 = x;
    x += (s.weight / total) * 10;
    s.x1 = x;
  });
  return segs;
};

window.Metrics = {
  // MacKenzie: WPM = (|T| - 1) / seconds * 60 / 5
  wpm(text, ms) {
    return text && ms > 0 ? ((text.length - 1) / (ms / 1000)) * 12 : 0;
  },
  msd(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  },
  cer(target, typed) {
    const len = Math.max(target.length, typed.length);
    return len ? this.msd(target, typed) / len : 0;
  }
};

// One socket with a message dispatcher; the page decides what a drop means.
window.StudySocket = function (onMessage, onStatus) {
  const ws = new WebSocket(window.STUDY_CONFIG_RUNTIME.backendWsUrl);
  ws.addEventListener("open", () => onStatus && onStatus("open"));
  ws.addEventListener("close", () => onStatus && onStatus("closed"));
  ws.addEventListener("error", () => onStatus && onStatus("error"));
  ws.addEventListener("message", (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    onMessage(m);
  });
  return {
    send(payload) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return true;
      }
      return false;
    },
    get open() {
      return ws.readyState === WebSocket.OPEN;
    }
  };
};
