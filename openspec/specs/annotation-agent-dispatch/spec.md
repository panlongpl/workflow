## Purpose
定义 Markdown 评论保存、历史注释选择、发送给 Agent，以及终端控制器派发可用性的行为要求。

## Requirements

### Requirement: 评论保存后支持可配置的自动发送策略
系统 SHALL 提供一个全局配置，用于控制评论保存成功后是否自动发送给 Agent。

#### Scenario: 默认关闭自动发送
- **GIVEN** 用户首次进入页面且本地没有保存过该配置
- **WHEN** 系统初始化评论相关状态
- **THEN** 系统默认将“保存评论后自动发送给 Agent”设置为关闭

#### Scenario: 用户开启自动发送
- **GIVEN** 用户已打开“保存评论后自动发送给 Agent”配置
- **WHEN** 用户保存一条评论且保存成功
- **THEN** 系统在保存成功后自动尝试将该评论发送给当前运行中的 Agent

#### Scenario: 用户关闭自动发送
- **GIVEN** 用户已关闭“保存评论后自动发送给 Agent”配置
- **WHEN** 用户保存一条评论且保存成功
- **THEN** 系统 MUST NOT 因默认行为自动发送该评论给 Agent

#### Scenario: 全局配置位于 Markdown 全局控制区
- **WHEN** 系统展示评论相关的全局默认策略配置
- **THEN** 系统应将“保存评论后自动发送给 Agent”放在 Markdown 浏览相关控制区
- **THEN** 系统 MUST NOT 将该配置作为评论抽屉中的单条评论字段呈现

#### Scenario: 自动发送配置被持久化
- **WHEN** 用户修改“保存评论后自动发送给 Agent”配置
- **THEN** 系统将该偏好保存到当前浏览器本地存储
- **THEN** 页面刷新后系统恢复该偏好

### Requirement: Automatic dispatch preference is compact in the redesigned header
The system SHALL keep the automatic comment dispatch preference available in the Markdown contextual toolbar using compact visible wording while preserving its existing persisted behavior.

#### Scenario: User views Markdown controls
- **WHEN** the Markdown module is active
- **THEN** the automatic comment dispatch preference is visible in the contextual toolbar
- **THEN** the visible label is compact enough to fit with other Markdown controls

#### Scenario: User changes automatic dispatch preference
- **WHEN** the user toggles the automatic comment dispatch preference from the redesigned toolbar
- **THEN** the system persists and applies the same automatic dispatch behavior as before the header redesign

### Requirement: Automatic dispatch preference is hidden outside Markdown context
The system SHALL hide the automatic comment dispatch preference from the contextual toolbar when the AI Terminal module is active.

#### Scenario: Terminal module is active
- **WHEN** the AI Terminal module is active
- **THEN** the automatic comment dispatch preference is not shown as a terminal toolbar control

### Requirement: 评论抽屉支持显式发送给 Agent
系统 SHALL 在评论抽屉中提供显式“发送给 Agent”动作，该动作始终先保存本地记录，再尝试发送。

#### Scenario: 点击发送给 Agent
- **WHEN** 用户在评论抽屉中点击“发送给 Agent”
- **THEN** 系统先校验并保存当前评论到本地注释存储
- **THEN** 系统在保存成功后尝试将该评论发送给 Agent
- **THEN** 该发送行为不受全局自动发送配置影响

#### Scenario: 点击仅保存
- **WHEN** 用户在评论抽屉中点击“仅保存”
- **THEN** 系统保存当前评论到本地注释存储
- **THEN** 系统是否自动发送仅取决于全局自动发送配置

#### Scenario: 发送时当前没有可用 Agent
- **GIVEN** 当前不存在可接收任务的运行中 Agent 会话
- **WHEN** 用户点击“发送给 Agent”或保存后触发自动发送
- **THEN** 评论保存成功的结果必须保留
- **THEN** 系统向用户明确反馈该评论未成功发送给 Agent

#### Scenario: 当前会话不可安全派发
- **GIVEN** 当前终端会话存在，但终端控制器判定该会话不具备可靠的任务派发语义
- **WHEN** 用户尝试发送评论给 Agent
- **THEN** 系统 MUST NOT 盲目将评论内容写入该会话
- **THEN** 系统向用户明确反馈当前会话不可用于评论派发

#### Scenario: 评论动作执行中防止重复点击
- **WHEN** 用户正在执行“仅保存”或“发送给 Agent”动作
- **THEN** 系统临时禁用会导致同一评论重复保存或重复发送的相关按钮
- **THEN** 动作结束后系统恢复按钮状态

#### Scenario: 发送成功后不强制跳转终端
- **WHEN** 评论成功发送给 Agent
- **THEN** 系统向用户反馈发送成功
- **THEN** 系统 MUST NOT 强制从 Markdown 浏览切换到 AI 终端

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

### Requirement: 历史注释的单行文本模式保持轻量复制用途
系统 SHALL 保持历史注释单行文本模式的轻量复制定位，不强制承载勾选发送交互。

#### Scenario: 用户切换到单行文本模式
- **WHEN** 用户在历史注释页面切换到单行文本模式
- **THEN** 系统继续展示面向复制的扁平文本内容
- **THEN** 系统不要求在该模式下提供逐条勾选与批量发送能力

### Requirement: 历史批量发送应控制单次 prompt 规模
系统 SHALL 以可预期的方式控制历史批量发送的单次内容规模，避免生成不可控的超长 prompt。

#### Scenario: 选中评论数量或内容过多
- **GIVEN** 用户在历史注释中选中了过多评论，导致合并后的发送内容超过实现约束
- **WHEN** 用户尝试批量发送
- **THEN** 系统应限制单次发送规模，或按既定裁剪策略构造 prompt
- **THEN** 系统需要向用户提供清晰、可预期的反馈

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

### Requirement: 新增交互应保持可访问性
系统 SHALL 为新增开关、复选框和按钮提供可理解标签与键盘可操作性。

#### Scenario: 用户通过键盘操作历史注释选择
- **WHEN** 用户通过键盘聚焦到历史注释复选框
- **THEN** 用户可以通过标准键盘交互切换选中状态

#### Scenario: 用户查看全局自动发送配置
- **WHEN** 用户浏览 Markdown 控制区
- **THEN** 自动发送开关具有明确可见标签

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
