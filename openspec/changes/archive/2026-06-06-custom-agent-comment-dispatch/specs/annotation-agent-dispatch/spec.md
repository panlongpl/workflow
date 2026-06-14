## MODIFIED Requirements

### Requirement: 终端控制器统一管理派发可用性
系统 SHALL 由终端控制器统一判断当前 Agent 会话是否可以接收评论派发，并 SHALL 支持已运行且连接正常的 Codex、Claude 和自定义 Agent 会话接收评论 prompt。

#### Scenario: 存在支持派发的运行中 Agent
- **GIVEN** 当前存在已启动且连接正常的受支持 Agent 会话
- **WHEN** 评论系统请求发送 prompt
- **THEN** 终端控制器将 prompt 写入该 Agent 会话

#### Scenario: 存在运行中的自定义 Agent
- **GIVEN** 当前存在由用户显式启动、已运行且连接正常的自定义 Agent 会话
- **WHEN** 评论系统请求发送单条或批量评论 prompt
- **THEN** 终端控制器将 prompt 写入该自定义 Agent 会话
- **THEN** 系统 MUST NOT 返回当前会话不可用于评论派发

#### Scenario: 不存在运行中 Agent
- **GIVEN** 当前没有运行中的 Agent 会话
- **WHEN** 评论系统请求发送 prompt
- **THEN** 终端控制器返回不可派发结果
- **THEN** 系统向用户反馈当前没有可用 Agent

#### Scenario: 当前会话类型不受支持
- **GIVEN** 当前终端会话为不受支持或不可识别的会话类型
- **WHEN** 评论系统请求发送 prompt
- **THEN** 终端控制器 MUST NOT 将 prompt 写入该会话
- **THEN** 系统向用户反馈当前会话不可用于评论派发

#### Scenario: 自定义 Agent 连接不可用
- **GIVEN** 当前自定义 Agent 会话已经断开或 WebSocket 连接不可用
- **WHEN** 评论系统请求发送 prompt
- **THEN** 终端控制器返回不可派发结果
- **THEN** 系统向用户反馈 Agent 连接不可用或当前 Agent 会话不可用
