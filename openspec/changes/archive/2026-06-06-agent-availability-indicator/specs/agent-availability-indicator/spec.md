## ADDED Requirements

### Requirement: 顶部展示 Agent 可用状态
系统 SHALL 在页面顶部展示当前 Agent 派发可用性状态，使用户无需切换到 AI 终端即可判断是否存在可接收评论任务的 Agent。

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
系统 SHALL 在 Agent 会话状态变化时更新顶部 Agent 可用性展示。

#### Scenario: Agent 启动成功
- **WHEN** Agent 会话从启动中变为运行中且可派发
- **THEN** 顶部状态更新为可用
- **THEN** 顶部状态显示该 Agent 名称

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
