# Ar-Gesture-Frontend 代码分析文档（中文版）

> English version: [ANALYSIS.en.md](ANALYSIS.en.md)

## 1. 项目定位

本仓库是 AR 手势滑行输入（gesture typing）演示系统的**前端**：手机作为一块"空白触摸板"，桌面/AR 显示端展示 QWERTY 键盘、光标、轨迹、候选词条和已解码文本。所有解码逻辑都在后端（`Ar-gesture-multi`，Python），前端是**纯静态站点**，托管在 GitHub Pages 上，通过 WSS（`wss://gesture.drziangchen.uk`）与后端通信。

## 2. 技术栈与代码类型

| 部分 | 语言/技术 | 说明 |
|---|---|---|
| 页面结构 | **HTML5** | `index.html` / `display.html` / `mobile.html`，无模板引擎 |
| 全部逻辑 | **原生 JavaScript（ES6+）** | 无框架（无 React/Vue）、无构建工具（无 webpack/vite）、无第三方依赖 |
| 样式 | **纯 CSS** | 单文件 `styles.css`，CSS 变量 + Flexbox 布局，`body` 上的模式 class 驱动 UI 状态 |
| 实时通信 | **WebSocket API**（浏览器原生） | 与后端的唯一持久通道，JSON 消息 |
| 局域网低延迟通道 | **WebRTC RTCDataChannel** | 可选 LAN 模式：手机→显示端点对点直连，仅用于渲染加速 |
| 绘图 | **Canvas 2D API** | 轨迹绘制（显示端 + 手机端） |
| 触摸输入 | **Pointer Events API** | `pointerdown/move/up/leave/cancel` 统一处理触摸与鼠标 |

**没有任何 Python**：前端零后端代码，零构建步骤，`git push` 即部署（GitHub Pages）。缓存控制靠 HTML 里的 `?v=` 查询串和 `config.js` 里的版本号（`config.js:15`）手动同步。

## 3. 文件结构与职责

```
Ar-Gesture-Frontend/
├── index.html      # 落地页：Display / Mobile 两个入口按钮（内联 CSS）
├── config.js       # 运行时配置：后端 WSS 地址 + 构建版本号
├── display.html    # 显示端页面骨架：设置栏、Session 徽章、文本行、候选条、键盘、canvas
├── display.js      # 显示端全部逻辑（601 行）
├── mobile.html     # 手机端页面骨架：会话选择器、全屏 canvas、参考键盘 overlay
├── mobile.js       # 手机端全部逻辑（405 行）
└── styles.css      # 两个页面共享的全部样式
```

### 3.1 config.js — 环境自适应配置

`config.js:5-17`：IIFE 挂一个全局 `window.GESTURE_CONFIG`。本地开发（`localhost`/`127.0.0.1`）时后端地址回落到同源 `ws://`，线上则固定 `wss://gesture.drziangchen.uk`。这是前端唯一的"配置系统"。

## 4. 核心概念：键盘单位坐标系（keyboard units）

前后端共享一套以 **G 键为原点、键宽/键高为单位 1** 的坐标系（键盘整体为 10×3 单位）。前端所有几何都围绕它：

- 显示端 `updateKeyboardReference()`（`display.js:71-85`）：取 `[data-key="G"]` 的 DOM 矩形，得到锚点像素坐标 `keyboardAnchorPoint` 和 `keyboardMetrics`（一个键的像素宽高）。
- `toDisplayPoint()`（`display.js:92-97`）：`像素 = 锚点 + 单位坐标 × 键宽/键高`，把服务器发来的全局手势点转成屏幕像素。
- 手机端 `toKeyboardUnits()`（`mobile.js:201-207`）：反向变换，把触摸像素位移除以参考键盘 overlay 的键宽高，转成**相对起点的单位位移**再发送。

这样手机屏幕大小、显示器分辨率完全解耦，服务器只处理统一的键盘单位。

## 5. mobile.js — 手机触摸板（405 行）

设计原则（`mobile.js:13-14` 注释）：**手机是"哑触摸板"**，不做任何长按/dwell 判定，v3 字母输入的检测完全在服务器端做。

### 5.1 手势采集与上报

- `startGesture()`（`mobile.js:209-239`）：`pointerdown` 触发。未配对或已在绘制则忽略；`setPointerCapture` 锁定指针；relative 模式下在手指处显示参考键盘 overlay（`showOverlay`，`mobile.js:167-170`），absolute 模式要求落点在固定键盘矩形内（`mobile.js:217-219`）。发送 `{type:"gesture-start", point:{x,y,t:0}}`。
- `moveGesture()`（`mobile.js:241-258`）：本地 canvas 画轨迹段，同时把点转成单位坐标并附带 `t`（`performance.now()` 距笔画开始的毫秒数，`mobile.js:253`，服务器用于录制数据和未来的 dwell/速度感知解码），发 `gesture-move`。
- `endGesture()`（`mobile.js:260-276`）：清画布、复位状态、发 `gesture-end`。

两种映射模式的坐标处理：

- **relative**（默认）：`toKeyboardUnits()` 发相对位移，起点由服务器按 center/continuous 模式决定；
- **absolute**：`toAbsoluteKeyboardPoint()`（`mobile.js:193-199`）把触点归一化到键盘矩形的 [0,1]×[0,1]，服务器再映射到 [-5,5]×[-1.5,1.5]。

### 5.2 会话配对（rooms）

`mobile.js:278-331`：连上 WS 即发 `{type:"join", role:"mobile"}` 进入大厅，收到 `room-list` 后 `renderRooms()` 把每个未占用的 4 位会话码渲染成按钮，点击发 `join-room`。`room-joined` 后隐藏选择器、进入触摸板模式；`room-closed`/`room-error`/断线则回到选择器（`showPicker`）。

### 5.3 LAN 模式（WebRTC 发起方）

`mobile.js:16-65`：显示端开启 LAN 模式后（通过 `state-update` 里的 `lanMode` 标志，`mobile.js:377-387`），手机作为 **offer 方**建立 `RTCPeerConnection`：

- `iceServers: []`（`mobile.js:43`）——不配 STUN/TURN，只用 host/mDNS 候选，**强制局域网直连**；
- 创建名为 `"trace"` 的 DataChannel，SDP offer / ICE candidate 都通过服务器 WS 转发（服务器仅做信令中继）；
- `p2pSend()`（`mobile.js:59-65`）：每条 gesture 消息在发给服务器的**同时**镜像一份到 DataChannel。WS 主路径完全不变，解码、录制全部照旧——P2P 通道纯粹是让显示端省掉一个 WAN 往返来渲染光标。失败静默降级（`catch` 里什么都不做）。

## 6. display.js — 显示端（601 行）

### 6.1 渲染管线

- `resizeCanvas()`（`display.js:54-69`）：按 `devicePixelRatio` 设置 canvas 物理分辨率，`sizeKeyboardToTextRow()`（`display.js:44-52`）用 CSS 变量 `--key-width` 让 10 键正好铺满文本行宽度。
- 手势渲染：`gesture-start` 时重取键盘几何、清画布、移动光标；`gesture-move` 时 `moveCursor()` 移动 DOM 光标点，且仅在 Trace=gesture 模式下 `drawSegment()`（`display.js:131-140`）在 canvas 上画黑色圆头线段；`gesture-end` 清画布（`display.js:397-428`）。

### 6.2 候选条（display-only）

`renderCandidates()`（`display.js:168-193`）：固定 7 段——5 个词槽 + ⌫ + Clear（v3 版本下最后一段变成 Undo ↩，`display.js:191`）。**关键约束**：每段的 flex 权重 `candidateWeight()`（`display.js:159-162`）为 `max(len(word), 2)`，注释明确要求与服务器 `candidate_slot` 的权重算法保持一致——因为**选中判定在服务器端**（光标滑进候选区，按 x 坐标分段），前端只负责把段画在同样比例的位置上并响应 `candidate-hover` 高亮（`display.js:195-199`）。前端候选条上没有任何点击事件。

### 6.3 状态同步：服务器为唯一事实源

所有设置（算法版本/映射/词起点/轨迹/手机键盘/LAN）都是"**发请求给服务器 → 服务器广播 `state-update` → 两端应用**"的单向数据流。为防止"服务器回填 `<select>` 值 → 触发 change 事件 → 又发回服务器"的回声循环，每个下拉框配一个 `isApplyingServer*` 布尔锁（`display.js:18-29,245`），回填时置 true，change 监听器（`display.js:526-591`）看到锁直接返回。这是本文件最有代表性的模式，出现 7 次。

`state-update` 处理（`display.js:430-523`）还包括：解码文本 + 自动滚到最新词（`display.js:433`）、`populateVersions()` 用服务器下发的版本列表一次性填充算法下拉框（`display.js:142-157`）、`cursorKey` 归位光标、`reset` 时清画布清候选。

### 6.4 v3 字母输入反馈

`renderLetterState()`（`display.js:208-236`）：响应服务器 `letter-state` 消息。`armed` 态显示字母徽章（"lift = input"）；`pending`/`positioning` 态在解码文本里渲染**插入光标**（`<span class="text-caret">`）——caret 可以等于 `len+1` 表示"作为新词插入"（渲染在一个空格之后，`display.js:228-234`）。注意 `escapeHtml()`（`display.js:204-206`）防注入，因为这里用了 `innerHTML`。

### 6.5 LAN 模式（WebRTC 应答方）

`display.js:238-330`：收到手机经服务器转发的 `rtc-offer` 后建 `RTCPeerConnection`（同样 `iceServers: []`）、回 answer。DataChannel 打开后 `p2pActive=true`、点亮 "LAN ⚡" 徽章；`handleP2pTrace()`（`display.js:285-302`）直接用手机原始 payload 渲染，其中 `p2pGlobalPoint()`（`display.js:275-283`）**在前端复刻服务器的坐标变换**（absolute 的 `x*10-5, y*3-1.5` 与 relative 的起点叠加），保证 P2P 渲染和服务器路径像素级一致。P2P 激活期间忽略服务器回显的 `gesture-*` 消息（`display.js:398-399,410,423`），通道断了自动回退。

## 7. styles.css — 模式驱动的样式

- 布局核心：`--key-width` CSS 变量决定一切尺寸（键、候选条、文本行），JS 只设这一个变量。
- 状态用 `body` 上的 class 表达：`is-absolute-mode` / `is-continuous-mode` / `is-cursor-visual-mode` / `is-mobile-keyboard-hidden` / `is-paired`，由两端的 `applyModeClasses()`（`display.js:123-129`、`mobile.js:74-88`）切换，CSS 选择器级联出对应 UI（如 absolute 模式下参考键盘固定居中、连续模式下 G 键锚点高亮等）。
- 组件样式分区：顶栏设置、候选条（`.candidate-seg`、`.is-hover`、`.is-top`）、房间码徽章（`.room-code.is-paired` 变绿）、会话选择器、字母徽章、LAN 徽章、构建号角标。

## 8. 与后端的消息协议（前端视角）

**前端 → 服务器**：`join`（带 role）、`join-room`、`list-rooms`、`gesture-start/move/end`、`mapping-mode-set`、`mode-set`、`visual-mode-set`、`mobile-keyboard-set`、`version-set`、`lan-mode-set`、`rtc-offer/answer/ice`（信令透传）。

**服务器 → 前端**：`room-created`、`room-list`、`room-joined`、`room-closed`、`room-error`、`mobile-joined/left`、`gesture-start/move/end/cancel`、`candidate-hover`、`letter-state`、`state-update`（全量状态快照）、`text-update`、`rtc-*`。

## 9. 设计要点总结

1. **薄前端**：解码、dwell 检测、候选选择判定、undo 全在服务器；前端只做采集与渲染，因此两端 JS 合计约 1000 行。
2. **服务器权威 + 回声抑制锁**：所有 UI 状态经服务器往返，`isApplyingServer*` 模式防循环。
3. **双通道容错**：WS 永远在线为主路径，WebRTC LAN 通道纯加速、静默降级。
4. **前后端隐式契约**：候选条分段权重（`display.js:159` ↔ 服务器 `candidate_slot`）、坐标变换（`display.js:275` ↔ 服务器 `to_absolute_keyboard_point`）两处必须手工保持同步，是维护时最容易踩的坑。
