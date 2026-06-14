## ADDED Requirements

### Requirement: 评论派发入口可参考顶部 Agent 状态
系统 SHALL 让评论派发相关界面可以通过顶部 Agent 状态了解当前是否存在可派发 Agent，但不改变评论保存与发送的既有语义。

#### Scenario: 顶部状态展示不改变保存语义
- **WHEN** 用户在评论抽屉中点击“仅保存”
- **THEN** 系统仍按评论保存配置决定是否自动发送
- **THEN** 顶部 Agent 状态 MUST NOT 改变评论本地保存结果

#### Scenario: 顶部状态展示不替代发送校验
- **WHEN** 用户点击“发送给 Agent”或发送历史注释
- **THEN** 系统仍通过终端控制器执行真实派发可用性校验
- **THEN** 系统 MUST NOT 仅凭顶部展示状态跳过派发校验

#### Scenario: 无可用 Agent 时提示一致
- **GIVEN** 顶部 Agent 状态显示当前无可用 Agent
- **WHEN** 用户尝试发送评论给 Agent
- **THEN** 系统保持保存成功但发送失败不回滚的行为
- **THEN** 系统反馈的不可用原因应与顶部状态语义一致
