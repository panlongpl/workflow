## Purpose
定义页面顶部 Agent 可用状态的展示、会话变化刷新、可派发语义以及可访问性要求，确保用户无需切换终端即可理解当前 Agent 是否可接收评论任务。

## Requirements

### Requirement: 顶部展示 Agent 可用状态
系统 SHALL 在页面顶部展示当前 Agent 派发可用性状态，使用户无需切换到 AI 终端即可判断是否存在可接收评论任务的 Agent，并 SHALL 在自定义 Agent 可派发时显示为可用状态。

#### Scenario: 没有运行中的 Agent
- **GIVEN** 当前没有运行中的 Agent 会话
- **WHEN** 用户查看页面顶部状态区域
- **THEN** 系统显示 Agent 不可用状态
- **THEN** 系统 MUST NOT 显示绿色可用圆点

#### Scenario: 存在可派发 Agent
- **GIVEN** 当前存在已运行且连接正常的受支持 Agent 会话
- **WHEN** 用户查看页面顶部状态区域
- **THEN** 系统显示绿色状态圆点
- **THEN** 系统显示当前 Agent 名称和可用文案

#### Scenario: 存在可派发自定义 Agent
- **GIVEN** 当前存在用户显式启动、已运行且连接正常的自定义 Agent 会话
- **WHEN** 用户查看页面顶部状态区域
- **THEN** 系统显示绿色状态圆点
- **THEN** 系统显示自定义 Agent 名称或自定义命令摘要和可用文案

#### Scenario: Agent 正在启动
- **GIVEN** 用户已发起启动 Agent 但会话尚未进入运行状态
- **WHEN** 用户查看页面顶部状态区域
- **THEN** 系统显示启动中状态
- **THEN** 系统 MUST NOT 将该 Agent 展示为可用

#### Scenario: 当前会话不可派发
- **GIVEN** 当前终端会话存在但终端控制器判定该会话不可用于评论派发
- **WHEN** 用户查看页面顶部状态区域
- **THEN** 系统显示不可派发状态
- **THEN** 系统 MUST NOT 显示绿色可用圆点

### Requirement: 顶部 Agent 状态随会话变化刷新
系统 SHALL 在 Agent 会话状态变化时更新顶部 Agent 可用性展示，包括自定义 Agent 从启动中进入可派发、断开或结束的状态变化。

#### Scenario: Agent 启动成功
- **WHEN** Agent 会话从启动中变为运行中且可派发
- **THEN** 顶部状态更新为可用
- **THEN** 顶部状态显示该 Agent 名称

#### Scenario: 自定义 Agent 启动成功
- **WHEN** 自定义 Agent 会话从启动中变为运行中且连接正常
- **THEN** 顶部状态更新为可用
- **THEN** 顶部状态显示自定义 Agent 名称或自定义命令摘要

#### Scenario: Agent 会话断开或结束
- **WHEN** Agent 会话断开、结束或被重启清空
- **THEN** 顶部状态更新为不可用
- **THEN** 顶部状态不再显示该 Agent 为可用

#### Scenario: Agent 连接不可用
- **WHEN** 终端 WebSocket 连接不可用
- **THEN** 顶部状态显示连接不可用或不可用状态
- **THEN** 顶部状态 MUST NOT 与真实派发能力矛盾

### Requirement: Agent 可用状态具备可访问语义
系统 SHALL 通过文本和可访问标签表达 Agent 可用性，不能仅依赖颜色。

#### Scenario: 状态文本可理解
- **WHEN** 用户查看顶部 Agent 状态
- **THEN** 系统通过文本表达当前状态，例如 Agent 名称、可用、不可用、启动中或不可派发

#### Scenario: 辅助技术读取状态
- **WHEN** 用户使用辅助技术浏览顶部 Agent 状态
- **THEN** 系统提供可理解的状态标签或文本

### Requirement: Agent availability remains consistent with reconnect states
The system SHALL keep the header Agent availability indicator consistent with terminal reconnect states.

#### Scenario: Session becomes unavailable after prior launch
- **WHEN** a previously launched Agent session closes, disconnects, or becomes unavailable
- **THEN** the header Agent availability indicator updates to unavailable or connection-unavailable state
- **THEN** the indicator MUST NOT continue to present the Agent as currently available

#### Scenario: Reconnect starts successfully
- **WHEN** the user reconnects and the replacement Agent session reaches running state
- **THEN** the header Agent availability indicator updates to available
- **THEN** the indicator displays the reconnected Agent label or custom command summary

#### Scenario: Reconnect cannot proceed
- **WHEN** reconnect cannot proceed because no previous target exists or required launch details are missing
- **THEN** the header Agent availability indicator remains consistent with the actual non-running state
- **THEN** the system MUST NOT show a green available state merely because Reconnect was requested

### Requirement: Agent availability is integrated into the header identity row
The system SHALL show Agent availability in the redesigned header identity row as a compact status indicator that remains separate from contextual Markdown and terminal toolbar actions.

#### Scenario: Header is rendered
- **WHEN** the viewer header is visible
- **THEN** Agent availability is displayed in the identity row
- **THEN** Agent availability is not grouped as a Markdown document view control

#### Scenario: Agent availability text is long
- **WHEN** the active Agent label or command summary is long
- **THEN** the visible Agent availability control truncates or constrains text without overlapping adjacent controls
- **THEN** the full status remains available through accessible text or title metadata
