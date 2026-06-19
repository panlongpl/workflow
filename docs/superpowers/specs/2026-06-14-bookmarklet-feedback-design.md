# Bookmarklet Feedback Design

## 背景

开发者在测试其他前端项目时，经常需要把页面问题、当前 URL、环境信息和控制台错误整理后再转述给 Agent。这个过程打断测试节奏，也容易遗漏关键上下文。

本设计在 Workflow Cockpit 中增加一个跨页面反馈工具：用户将一个 bookmarklet 拖到浏览器书签栏，在任意被测前端页面点击后注入轻量反馈面板，并把问题上下文发送给当前运行中的 Agent。

## 目标

- 支持在其他前端项目页面中快速唤起反馈面板。
- 自动收集 URL、标题、viewport、userAgent、时间戳和注入后的控制台错误。
- 发送前检查 Workflow Cockpit 中是否存在可用 Agent。
- 当没有可用 Agent 时阻断发送，并提示用户先启动 Agent。
- 将结构化反馈整理成清晰 prompt 后发送给 Agent。

## 非目标

- 不实现截图、录屏或 DOM 元素选择。
- 不采集完整网络 HAR。
- 不提供多 Agent 选择。
- 不保存反馈历史列表。
- 不尝试读取 bookmarklet 注入前已经发生但浏览器未暴露的 console 历史。

## 用户流程

### 安装

1. 用户打开 Workflow Cockpit 中的“测试反馈工具”入口。
2. 页面展示当前 Agent 状态、使用说明和 bookmarklet 安装按钮。
3. 用户将“发送给 Workflow Agent”按钮拖到浏览器书签栏。

### 反馈

1. 用户在其他前端项目页面发现问题。
2. 点击书签栏中的 bookmarklet。
3. 页面右下角出现反馈面板。
4. 用户填写问题描述。
5. 反馈面板附带页面上下文和最近捕获的错误。
6. 用户点击“发送给 Agent”。
7. 注入脚本调用 Workflow Cockpit 本地服务检查 Agent 状态。
8. Agent 可用时发送反馈；Agent 不可用时阻断，并提示用户先启动 Agent。

## 架构

```text
其他前端页面
  └─ bookmarklet 注入脚本
      ├─ 渲染反馈面板
      ├─ 捕获 error / unhandledrejection / console.error
      └─ POST http://localhost:4173/api/bookmarklet-feedback

Workflow Cockpit 本地服务
  ├─ GET /api/agent-status
  ├─ POST /api/bookmarklet-feedback
  └─ Agent session bridge
      └─ 将格式化 prompt 写入当前可派发 Agent
```

## 组件设计

### Bookmarklet 安装页

安装页负责生成可拖拽 bookmarklet，并说明使用方式。

页面应展示：

- 当前服务地址，例如 `http://localhost:4173`。
- 当前 Agent 状态。
- 可拖拽按钮：“发送给 Workflow Agent”。
- 使用说明：点击 bookmarklet 后会开始捕获新的 console 错误；建议先打开工具、复现问题、再发送。

### 注入脚本

bookmarklet 在被测页面执行后：

- 如果反馈面板已存在，则切换显示状态，不重复注入。
- 注入 scoped inline style，避免依赖或污染业务页面样式。
- 监听 `window.onerror`、`unhandledrejection` 和 `console.error`。
- 维护有限长度的错误缓存，避免 payload 过大。
- 发送时收集页面上下文并调用本地服务。

### 反馈面板

反馈面板固定在页面右下角，使用高 `z-index` 和独立样式。

主要内容：

- 标题：Send to Agent。
- 当前页面域名或标题。
- 问题描述 textarea。
- 自动附带信息摘要。
- Agent 状态提示。
- “检查 Agent”和“发送给 Agent”按钮。
- 关闭按钮。

状态文案：

- Agent 可用：`Agent 可用，可以发送`。
- Agent 不可用：`当前没有可用 Agent，请先打开 Workflow Cockpit 并启动 Agent`。
- 发送成功：`已发送给 Agent`。
- 发送失败：展示服务端返回的错误原因。

## 服务端 API

### `GET /api/agent-status`

返回当前 Agent 是否可接收外部反馈。

成功示例：

```json
{
  "ok": true,
  "status": "running",
  "agent": "coco",
  "label": "Coco Agent"
}
```

不可用示例：

```json
{
  "ok": false,
  "reason": "no-session",
  "message": "当前没有可用的 Agent"
}
```

### `POST /api/bookmarklet-feedback`

接收 bookmarklet 反馈，将其格式化为 prompt 并发送给当前 Agent。

请求体：

```json
{
  "source": "bookmarklet-feedback",
  "version": 1,
  "page": {
    "url": "https://example.com/order/create",
    "title": "创建订单",
    "referrer": "",
    "viewport": {
      "width": 1440,
      "height": 900,
      "devicePixelRatio": 2
    },
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    "timestamp": "2026-06-14T10:00:00.000Z"
  },
  "feedback": {
    "description": "点击提交按钮后页面没有响应。"
  },
  "console": {
    "errors": [],
    "rejections": []
  }
}
```

成功响应：

```json
{
  "ok": true,
  "message": "已发送给 Agent"
}
```

Agent 不可用时返回 HTTP 409：

```json
{
  "ok": false,
  "reason": "no-agent",
  "message": "当前没有可用 Agent，请先启动 Agent"
}
```

## Prompt 格式

服务端将反馈转换为 Markdown prompt：

```md
我在测试一个前端页面时发现了问题，请帮我分析。

## 用户描述
点击提交按钮后页面没有响应。

## 页面上下文
- URL: https://example.com/order/create
- Title: 创建订单
- Viewport: 1440x900 @2x
- UserAgent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36
- Time: 2026-06-14T10:00:00.000Z

## 最近 Console Errors
1. TypeError: Cannot read properties of undefined (reading 'id')
   at submitOrder (https://example.com/assets/order.js:128:17)

## 最近 Unhandled Rejections
无

## 请你做的事
- 根据以上上下文判断可能原因
- 给出排查路径
- 如果需要更多信息，请明确告诉我下一步要收集什么
```

## 跨域策略

bookmarklet 运行在其他项目页面，因此新增接口需要支持 CORS：

- `GET /api/agent-status`
- `POST /api/bookmarklet-feedback`
- `OPTIONS /api/agent-status`
- `OPTIONS /api/bookmarklet-feedback`

响应头：

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type
```

安全边界：

- 只接受 JSON 请求。
- 限制请求体大小。
- 限制错误条数和字段长度。
- 不接受任意命令或脚本。
- 服务端只将格式化后的反馈文本发送给 Agent。

## 错误处理

### Workflow Cockpit 服务未启动

面板提示：

```text
无法连接 Workflow Cockpit。请先运行本项目服务，然后重试。
```

### Agent 未启动

面板提示：

```text
当前没有可用 Agent。请先打开 Workflow Cockpit，进入 AI Agent 面板并启动一个 Agent 会话。
```

面板可提供“打开 Workflow Cockpit”按钮，打开 `http://localhost:4173/`。

### CSP 或页面环境阻止运行

面板无法正常展示或请求失败时，bookmarklet 应尽量使用 `alert` 给出最低限度提示：

```text
当前页面安全策略可能阻止了反馈工具运行，请手动复制页面信息给 Agent。
```

### 发送超时

面板提示：

```text
发送超时，请确认 Workflow Cockpit 服务仍在运行。
```

## 验证方案

- 在 Workflow Cockpit 页面确认 bookmarklet 可生成并可拖拽安装。
- 在一个简单本地 HTML 页面点击 bookmarklet，确认反馈面板可注入。
- 触发 `console.error`、`window.onerror` 和 `unhandledrejection`，确认注入后错误被收集。
- 未启动 Agent 时发送，确认接口返回不可用，面板阻断发送。
- 启动支持派发的 Agent 后发送，确认 Agent 终端收到格式化 prompt。
- 停止本地服务后发送，确认面板展示连接失败提示。

## 后续增强

- 支持截图附件。
- 支持选择 DOM 元素并附带 selector。
- 支持采集最近 fetch/XHR 错误摘要。
- 支持反馈历史和重发。
- 支持在安装页选择目标 Agent 或 prompt 模板。
