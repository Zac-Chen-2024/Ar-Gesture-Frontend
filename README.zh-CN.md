[English](README.md) | **简体中文**

# Ar-Gesture 前端

AR-Gesture 手势输入 demo 的静态前端：手机变成一块空白触摸板，显示器呈现 QWERTY 键盘、光标、候选栏和已解码的句子。托管在 GitHub Pages；全部逻辑都在后端——
**[Zac-Chen-2024/AR-Gesture-Backend](https://github.com/Zac-Chen-2024/AR-Gesture-Backend)**（`wss://gesture.drziangchen.uk`）。

**在线体验**：<https://zac-chen-2024.github.io/Ar-Gesture-Frontend/>

## 页面

| 页面 | 角色 |
|---|---|
| `index.html` | 落地页，两个入口 |
| `display.html` | **桌面/AR 显示端**：设置栏、会话码、解码文本行、候选栏（5 个词 + ⌫ + Clear/撤销）、QWERTY 键盘、光标与轨迹 |
| `mobile.html` | **手机触摸板**：会话选择后是一块空白绘制面（可选的参考键盘蒙层）——刻意不显示其他任何东西 |

## 使用方法

1. 在电脑上打开 `display.html`——会显示一个 4 位**会话码**。
2. 在手机上打开 `mobile.html`，点选该会话码完成配对（角标变绿）。
3. 在手机上滑动写词，显示器解码。除设置下拉框外，一切都由触摸板光标驱动：
   - 向上滑入**候选栏**，在某一段上抬手即选中该候选 / ⌫ / Clear（v3 中为撤销）；
   - 在 v3 版本中，**在某键上停留约 1 秒后抬手**即可获得字母候选，用于输入词表外的单词（完整流程见后端 README）。

## 设置（唯一可点击的 UI）

算法（v1 SHARK² / v1.1 / v2 WFST / v2.1 / v3a / v3b——由服务器下发）· 映射（相对/绝对）· 起词（归中/连续）· 轨迹（光标/手势）· 手机键盘（显示/隐藏）· **链路（Server/LAN）**。

**LAN 模式**：手机与显示器同在一个 Wi-Fi 时，手机直接向显示器建立 WebRTC 数据通道，光标/轨迹以局域网延迟渲染（左下角绿色 **LAN ⚡** 角标）。服务器路径仍持续负责解码与状态；P2P 建连失败（AP 隔离、不同网络）时静默回落。

## 配置与版本

- `config.js`——后端 WSS 地址（localhost 下回落到同源，便于本地开发）与前端构建 `version`。
- 构建版本显示在**右下角角标**；每次推送都要提升它（以及 HTML 里的 `?v=` 查询串），这样 CDN 缓存过期与否一眼可见。

## 部署

GitHub Pages：Settings → Pages → Deploy from a branch → `main` / root。
所有资源路径都是相对路径，项目子路径 URL 开箱即用。
