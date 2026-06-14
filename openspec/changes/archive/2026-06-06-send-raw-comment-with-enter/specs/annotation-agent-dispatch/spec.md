## MODIFIED Requirements

### Requirement: 历史注释支持选择后发送给 Agent
系统 SHALL 允许用户从历史注释中选择部分评论并将其发送给 Agent，发送内容 SHALL 仅包含所选评论的用户评论正文。

#### Scenario: 发送单条历史注释
- **WHEN** 用户在历史注释列表中对某一条评论执行发送操作
- **THEN** 系统尝试将该条评论的用户评论正文发送到当前运行中的 Agent 会话
- **THEN** 系统 MUST NOT 附加文档路径、被评论原文、上下文或任务说明

#### Scenario: 批量发送选中的历史注释
- **GIVEN** 用户在历史注释按文档视图中选中了多条评论
- **WHEN** 用户点击“发送选中项给 Agent”
- **THEN** 系统将这些评论的用户评论正文合并为一次发送内容并发送给 Agent
- **THEN** 系统 MUST NOT 附加批量任务标记、选中数量、编号说明、文档路径、被评论原文或上下文

#### Scenario: 历史注释按文档视图支持单条与批量发送
- **WHEN** 用户浏览历史注释的按文档视图
- **THEN** 系统允许用户勾选多条评论以便批量发送
- **THEN** 系统允许用户对单条评论直接执行发送操作

#### Scenario: 未选择任何历史注释
- **WHEN** 用户点击“发送选中项给 Agent”但当前没有选中任何评论
- **THEN** 系统 MUST NOT 发送空任务给 Agent
- **THEN** 系统向用户提示需要先选择至少一条评论

#### Scenario: 历史选择态在视图切换时清理
- **GIVEN** 用户在历史注释按文档视图中选中了若干评论
- **WHEN** 用户切换到单行文本模式、离开历史注释页，或历史数据重新加载后选中项已不存在
- **THEN** 系统清理不再有效的选中项

#### Scenario: 历史批量发送成功后清理选择态
- **GIVEN** 用户选中了若干历史注释
- **WHEN** 系统成功将选中注释批量发送给 Agent
- **THEN** 系统清空已经成功发送的选中项

#### Scenario: 历史批量发送失败后保留选择态
- **GIVEN** 用户选中了若干历史注释
- **WHEN** 系统尝试批量发送失败
- **THEN** 系统保留当前选中项，方便用户修复 Agent 会话后重试

### Requirement: 发送给 Agent 的 prompt 应包含完整任务上下文
系统 SHALL 在发送评论给 Agent 时仅使用用户评论正文作为 prompt 内容，并 MUST NOT 自动附加任务标记、工作目录、文档路径、被评论原文、前后文上下文或处理指引。

#### Scenario: 发送单条评论 prompt
- **WHEN** 系统发送单条评论给 Agent
- **THEN** prompt 仅包含该条评论的用户评论正文
- **THEN** prompt MUST NOT 包含任务标记、工作目录、文档路径、被评论原文、前文上下文、后文上下文或处理指引

#### Scenario: 发送多条历史注释 prompt
- **WHEN** 系统批量发送历史注释给 Agent
- **THEN** prompt 仅包含选中注释的用户评论正文内容
- **THEN** prompt MUST NOT 包含批量任务标记、选中注释数量、编号列表、文档路径、被评论原文或上下文

#### Scenario: 评论正文为空
- **GIVEN** 待发送评论的用户评论正文为空或仅包含空白字符
- **WHEN** 系统尝试发送该评论给 Agent
- **THEN** 系统 MUST NOT 写入空内容到终端
- **THEN** 系统向用户反馈发送内容为空或发送失败

## ADDED Requirements

### Requirement: 评论内容写入终端后自动提交
系统 SHALL 在评论内容成功写入 Agent 终端后自动补充一次 Enter 键输入，使 Agent 可以直接开始处理。

#### Scenario: 评论内容成功写入
- **GIVEN** 当前存在可派发的运行中 Agent 会话
- **WHEN** 系统成功将评论内容写入终端
- **THEN** 系统自动向终端补充一次 Enter 键输入
- **THEN** Agent 可以在无需用户手动回车的情况下开始处理该评论内容

#### Scenario: 评论内容未写入
- **GIVEN** 当前 Agent 会话不可用、连接不可用或发送内容为空
- **WHEN** 系统未将评论内容写入终端
- **THEN** 系统 MUST NOT 额外向终端发送 Enter 键输入
