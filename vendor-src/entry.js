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
    throw new Error("此浏览器不支持 WebUSB，需要 Chrome/Edge");
  }
  status("请选择手机…");
  device = await manager.requestDevice();
  if (!device) {
    throw new Error("未选择设备");
  }
  status("正在连接 " + device.name + "…");
  let connection;
  try {
    connection = await device.connect();
  } catch (e) {
    throw new Error(
      "设备被其他程序占用。请依次尝试：① 终端执行 adb kill-server；" +
      "② Windows 任务管理器结束 adb.exe；③ 退出手机厂商助手类软件" +
      "（HiSuite/小米助手等），然后重新插线再点连接");
  }
  status("等待手机上的「允许 USB 调试」授权…");
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
  status("隧道已注册，自检中…");
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
      status("隧道已建立（自检✓ 手机端口在监听），等待手机页面接入…");
    } else {
      status("自检✗：adbd 注册成功但手机端口未监听——请按 F12 把控制台里 [UsbDirect] 的日志发给 Zac");
    }
  } catch (e) {
    console.log("[UsbDirect] self-check error:", e);
    status("自检异常（" + (e && e.message) + "）——请按 F12 把控制台日志发给 Zac");
  }
  transport.disconnected.then(() => teardown("数据线已断开")).catch(() => teardown("数据线已断开"));
  return { name: device.name, serial: device.serial };
}

export async function disconnect() {
  teardown("已断开");
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
      status("手机页面已断开，等待重新接入…");
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
        status("检测到手机接入，正在握手…");
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
          status("收到 HTTP 探测：隧道可达 ✓（等待手势页 WebSocket 接入…）");
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
