// USB direct-link facade, bundled to vendor/adb.bundle.js (global: UsbDirect).
//
// Uses ya-webadb (Tango) to speak the ADB protocol over WebUSB from the
// display page, then installs an ADB *reverse* tunnel on the phone:
// connections to 127.0.0.1:38301 on the phone are piped over the USB cable
// and terminate HERE, in this page's JS. The phone's touchpad page connects
// a plain WebSocket to that port, and we act as a minimal WebSocket server
// (handshake + frame parsing) on top of the tunnel stream. The gesture
// mirror therefore rides the cable exclusively — no ICE, no network racing.
//
// Latency: we send WS ping frames every 2s; browsers auto-reply with pongs,
// giving a true cable round-trip measurement (reported via onRtt).

import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";

const PORT = 38301;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

let adb = null;
let device = null;
let cbs = {};
let activeSocket = null;

function status(text) {
  if (cbs.onStatus) cbs.onStatus(text);
}

export function supported() {
  return Boolean(AdbDaemonWebUsbDeviceManager.BROWSER);
}

export async function connect(callbacks) {
  cbs = callbacks || {};
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) {
    throw new Error("WebUSB is not supported in this browser — use Chrome or Edge");
  }
  status("Select your phone…");
  device = await manager.requestDevice();
  if (!device) {
    throw new Error("No device selected");
  }
  status("Connecting to " + device.name + "…");
  let connection;
  try {
    connection = await device.connect();
  } catch (e) {
    throw new Error(
      "Device is in use by another program. Try, in order: (1) run adb kill-server; " +
      "(2) end adb.exe in Task Manager; (3) quit phone-assistant software " +
      "(HiSuite, Mi Assistant, …), then replug and click Connect again");
  }
  status("Waiting for the 'Allow USB debugging' prompt on the phone…");
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: new AdbWebCredentialStore(),
  });
  adb = new Adb(transport);
  try {
    await adb.reverse.remove("tcp:" + PORT);
  } catch (e) { /* not registered yet — fine */ }
  await adb.reverse.add("tcp:" + PORT, handleTunnelSocket);
  status("Tunnel registered, self-checking…");
  // self-check ON THE PHONE: is the reverse listener actually there?
  // (38301 = 0x959D in /proc/net/tcp)
  try {
    const regs = await adb.reverse.list().catch((e) => "list failed: " + e.message);
    const net = await adb.subprocess.noneProtocol.spawnWaitText(
      "netstat -tln 2>/dev/null | grep 38301; " +
      "grep -i ':959D' /proc/net/tcp /proc/net/tcp6 2>/dev/null; true");
    console.log("[UsbDirect] reverse list:", regs);
    console.log("[UsbDirect] phone listener check:", JSON.stringify(net));
    if (/38301|959d/i.test(net)) {
      status("Tunnel up (self-check ✓, phone port listening) — waiting for the touchpad page…");
    } else {
      status("Self-check ✗: registered but the phone port is not listening — press F12 and send the [UsbDirect] console logs");
    }
  } catch (e) {
    console.log("[UsbDirect] self-check error:", e);
    status("Self-check error (" + (e && e.message) + ") — see the [UsbDirect] console logs");
  }
  transport.disconnected.then(() => teardown("USB cable disconnected")).catch(() => teardown("USB cable disconnected"));
  return { name: device.name, serial: device.serial };
}

export async function disconnect() {
  teardown("Disconnected");
  if (adb) {
    try { await adb.close(); } catch (e) { /* noop */ }
    adb = null;
  }
  device = null;
}

function teardown(reason) {
  if (activeSocket) {
    try { activeSocket.close(); } catch (e) { /* noop */ }
    activeSocket = null;
  }
  if (cbs.onActive) cbs.onActive(false);
  status(reason);
}

// ---- minimal WebSocket server over one ADB tunnel stream ----

async function wsAcceptKey(key) {
  const digest = await crypto.subtle.digest(
    "SHA-1", new TextEncoder().encode(key + WS_GUID));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function wsFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = new Uint8Array([0x80 | opcode, len]);
  } else {
    head = new Uint8Array([0x80 | opcode, 126, (len >> 8) & 255, len & 255]);
  }
  const out = new Uint8Array(head.length + len);
  out.set(head);
  out.set(payload, head.length);
  return out;
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = (buf[2] << 8) | buf[3];
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(new DataView(buf.buffer, buf.byteOffset + 2, 8).getBigUint64(0));
    off = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.subarray(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = buf.slice(off, off + len);
  if (mask) {
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, consumed: off + len };
}

function findHeaderEnd(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function handleTunnelSocket(socket) {
  // Tango treats the handler's RETURN as "connection accepted" — it must not
  // block. The long-lived pump runs detached (this was the bug behind adbd
  // killing every incoming connection into TIME_WAIT).
  void pumpTunnelSocket(socket);
}

async function pumpTunnelSocket(socket) {
  if (activeSocket) {
    try { activeSocket.close(); } catch (e) { /* noop */ }
  }
  activeSocket = socket;
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const send = (bytes) => writer.write(bytes).catch(() => {});
  let buf = new Uint8Array(0);
  let handshaken = false;
  let pingTimer = null;
  const close = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    try { socket.close(); } catch (e) { /* noop */ }
    if (activeSocket === socket) {
      activeSocket = null;
      if (cbs.onActive) cbs.onActive(false);
      status("Touchpad page disconnected — waiting to reconnect…");
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;

      if (!handshaken) {
        status("Phone connected, handshaking…");
        const end = findHeaderEnd(buf);
        if (end < 0) continue;
        const head = new TextDecoder().decode(buf.subarray(0, end));
        buf = buf.slice(end + 4);
        const m = /Sec-WebSocket-Key:\s*(\S+)/i.exec(head);
        if (!m) {
          // plain HTTP probe (open http://127.0.0.1:38301 in the phone
          // browser to verify the tunnel end-to-end without WebSocket)
          send(new TextEncoder().encode(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\n" +
            "Connection: close\r\nContent-Length: 6\r\n\r\nusb-ok"));
          status("HTTP probe received: tunnel reachable ✓ (waiting for the touchpad page WebSocket…)");
          close();
          return;
        }
        const accept = await wsAcceptKey(m[1]);
        send(new TextEncoder().encode(
          "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"));
        handshaken = true;
        if (cbs.onActive) cbs.onActive(true);
        status("");
        pingTimer = setInterval(() => {
          send(wsFrame(0x9, new TextEncoder().encode(String(performance.now()))));
        }, 2000);
      }

      for (;;) {
        const f = parseWsFrame(buf);
        if (!f) break;
        buf = buf.slice(f.consumed);
        if (f.opcode === 1) {
          try {
            if (cbs.onTrace) cbs.onTrace(JSON.parse(new TextDecoder().decode(f.payload)));
          } catch (e) { /* malformed frame */ }
        } else if (f.opcode === 9) {
          send(wsFrame(0xA, f.payload));
        } else if (f.opcode === 10) {
          const t = parseFloat(new TextDecoder().decode(f.payload));
          if (Number.isFinite(t) && cbs.onRtt) cbs.onRtt(performance.now() - t);
        } else if (f.opcode === 8) {
          send(wsFrame(0x8, new Uint8Array(0)));
          close();
          return;
        }
      }
    }
  } catch (e) { /* tunnel stream error: treated as close */ }
  close();
}
