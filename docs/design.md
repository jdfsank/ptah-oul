OpenUI Lang 2D 游戏构建最终方案

技术设计 第 1 版    2026年11月18日

采用 OpenUI Lang 作为游戏内容的唯一创作语言，建立 Godot 4 风格的受控 2D 节点与行为库，使用 TypeScript 运行时执行，使用 PixiJS 8 绘制，并通过 React 编辑器完成选取、标注和局部修改。模型生成的场景、行为配置和修改补丁全部使用 OpenUI Lang。

第一版交付浏览器中的完整闭环：自然语言创建可玩小关卡，场景随生成逐步显示，完成后试玩，点选对象提出修改，再准确更新对应声明。以平台跳跃和俯视收集两类受限玩法验证系统。本文确定实现范围、数据契约、更新规则、工程模块与验收标准；示例中的游戏组件与动作是本项目需要实现的库。

1 最终技术决策

| 职责 | 确定采用 | 决策理由 |
| --- | --- | --- |
| 内容表达 | OpenUI Lang 原有语法加 game2d/1.0 组件库 | 复用流式解析、命名引用和语句级补丁，保持单一创作格式 |
| 语言基础 | @openuidev/lang-core | 使用框架无关的 parser、表达式求值、prompt 和 merge 能力 |
| 游戏执行 | TypeScript 自有轻量运行时 | 实现节点生命周期、输入、行为、固定步长与运行状态 |
| 2D 绘制 | PixiJS 8 与 WebGL 渲染路径 | 复用纹理、图形、文本、场景变换和指针事件 |
| 编辑界面 | React 与 TypeScript | 场景树、属性面板、模型对话、标注、历史和模式切换 |
| 基础碰撞 | 自有空间哈希与受限 swept AABB | 只实现角色对静态矩形的运动碰撞，控制兼容范围 |
| 模型后端 | TypeScript 服务端适配器与 SSE | 模型凭据留在服务端，传输 OpenUI 文本和事务元数据 |
| 项目保存 | IndexedDB 与可导入导出的项目包 | 本地自动保存，源码、资源、标注与版本一起导出 |



OpenUI Lang Core 本身提供解析、表达式求值、系统提示词生成与增量编辑合并；PixiJS 提供场景图及命中事件。固定步长、Godot 子集、编辑事务和 annotation 是本项目实现的应用能力。[S01][S02][S13][S14]

组件库、运行时、后端和编辑器使用 TypeScript 实现。每个游戏项目不携带用户生成的 JavaScript、GDScript 或自定义 shader。游戏能力通过注册的节点、行为与动作开放。首版不支持任意 Godot 工程导入，不承诺 .tscn 或完整 move_and_slide 兼容。

依赖使用经契约用例验证的精确版本并写入锁文件；项目另存 game2d/1.0 的 schema 版本。语言版本、组件库版本与项目版本分别记录，不能用一个版本号代替三者。

2 架构与状态所有权

生成链路为模型输出、语言解析、草稿预览、严格校验、提交场景定义和运行时执行。编辑反馈从画布选取出发，经稳定节点身份与语句定位回到模型。所有作者修改都进入同一个事务入口，包括模型补丁、拖动、属性面板和撤销。

| 数据层 | 内容 | 权威来源与规则 |
| --- | --- | --- |
| AuthorDocument | 原始 OpenUI 源码、revision、语句索引、资源引用 | 唯一创作事实来源；源文本持久化；AST 为派生数据 |
| DraftScene | 当前事务的累积文本、暂态树、诊断 | 允许不完整；仅用于预览；没有游戏副作用 |
| SceneDefinition | 校验通过的不可变节点、行为、资源定义 | 从完整源码编译；按 authorId 索引；同一节点只有一个父节点 |
| RuntimeWorld | 实例、位置、速度、生命值、计时器、FSM、销毁记录 | 由游戏循环修改；不反向覆盖作者定义 |
| EditorState | 选择、标注、模式、视口、草稿、撤销记录 | 编辑器管理；标注保存对象身份和源码版本 |



运行时场景和 Pixi 显示树保持独立。RuntimeWorld 决定实体的当前状态，Pixi 对象仅负责表现；React 不按每帧物理位置重建精灵。角色运动不会修改源代码中的出生位置。修改纹理也不会重新写入未变化的出生参数。

已提交作者版本 authorRevision 与当前试玩基线 runningRevision 单独记录。允许热更新时二者一起推进；出现结构性修改后，作者版本继续保存，试玩保留旧基线，并显示需要重新试玩。此后新修改均进入待重启版本，避免把多个结构版本混到同一个运行世界。

3 OpenUI 创作协议

节点调用约定

statement_name = NodeType("stable_author_id", {properties}, [child_references])



统一参数顺序为稳定 ID、属性对象、子声明引用。这个约定只统一写法；Node2D、CanvasLayer、Control、Timer 和行为节点仍具有各自的类型语义。节点 ID 是字符串常量，项目内唯一，重命名语句或移动层级时保持不变。

所有可编辑节点独立命名。一个活节点声明只能出现在一个父节点的 children 中；共享对象必须明确声明为资源或预制体。

v1 的 children 是静态引用数组；不使用 @Each 或条件表达式动态改变活节点拓扑。运行时生成由 Spawn 和预制体契约处理。

长度采用逻辑像素，时间采用秒，rotation 采用弧度；坐标原点在画布左上，x 向右、y 向下。

动态表达式允许用于白名单属性，如文本、可见性和规则条件。物理形状、身份和父子关系不接受动态表达式。

自定义函数只做纯同步计算。输入、物理、声音、生成和销毁通过行为或 action 执行，不在函数求值时产生副作用。[S03][S04]

不定义隐式 event、self、delta 裸变量。事件接收者和运行实例上下文由行为执行器显式持有，具体动作通过该上下文定位对象。

游戏 profile 不开放 Query、Mutation 或任意脚本调用。资源获取和模型调用由宿主管理；这不影响 OpenUI 作为作者语言。

源码定位与属性编辑

保存原始文本，使用 lang-core 的 tokenize、split、parseExpression 建立语句位置与表达式索引。当前公开源码导出这些接口；接入时在版本锁定测试中核对签名。[S05]

const statements = split(tokenize(source));

for (const statement of statements) {

  const expression = parseExpression(statement.tokens);

  // 保存 statementId、源码范围和表达式索引

}



属性编辑生成目标语句的替换文本，未修改语句原样保留。项目实现一个受限 profile 的 AST printer，明确括号优先级；输出重新通过官方 parser 与游戏校验。不能用求值后的 ElementNode 或 Pixi 树重建整个作者程序，否则会损失表达式、引用和独立定义。

表达式驱动的属性在属性面板中显示表达式来源。v1 直接拖动与数值输入仅修改字面量属性；替换表达式为常量必须是明确的用户操作。每次修改都生成完整语句补丁，进入统一事务和撤销链路。

4 Godot 4 语义支持范围

采用 Godot 的节点组织、局部变换和生命周期思想，并逐项约定实现范围。Godot 的 Node2D 区分局部与全局变换，CharacterBody2D 则包含具体的运动碰撞语义；同名组件需要实现表中列出的契约。[S09][S10][S11]

| 节点或系统 | v1 实现 | 范围限制 |
| --- | --- | --- |
| Node | 身份、名称、单父节点、groups、启用、子树销毁 | 不实现通用脚本与 Object 反射 |
| Node2D | position、rotation、scale 与全局矩阵 | skew、top_level 和特殊继承行为后置 |
| CanvasItem 子集 | visible、modulate、z_index、z_as_relative | 按最终层级与稳定树序绘制；不把 Pixi 默认排序当 Godot 完整语义 |
| Sprite2D | 纹理、裁剪区、centered、offset、flip_h、flip_v | 资源使用本项目清单；不导入 Godot 资源格式 |
| Polygon2D | 简单填充多边形 | 用于无外部素材的原型，不承担物理碰撞 |
| AnimatedSprite2D | 预登记动画、帧率、循环、播放和完成事件 | 不实现 AnimationTree 和骨骼动画 |
| Camera2D | 单活动相机、平移、缩放、直接跟随 | 平滑、限位和拖动边界后置 |
| StaticBody2D | 静态轴对齐矩形、碰撞分层 | 运行中不移动或旋转 |
| CharacterBody2D | 速度、对静态矩形的连续运动检测、墙地顶接触 | 无斜坡、移动平台、角色互撞和完整 Godot 物理解算 |
| Area2D | 矩形和圆形交叠、body_entered 与 exited | 离散触发检测，不承诺高速小物体的连续命中 |
| CollisionShape2D | 矩形；圆形仅用于 Area2D | 仅局部位置偏移；不接受旋转和缩放 |
| Timer | 基于模拟 tick 的 start、stop、timeout | 暂停时不计时；不使用墙上时钟推进玩法 |
| CanvasLayer 和 HUD | 固定屏幕层及简化 Label、Button | 不实现完整 Control anchors、containers 和焦点系统 |
| 行为扩展 | PlatformerController、TopDownController、SignalRule、StateMachine、Spawner | 有限规则及动作，不提供逐帧任意脚本 |



物理契约

v1 实体碰撞使用空间哈希作粗筛选，角色对静态矩形使用 swept AABB，按最早接触处理剩余运动，每 tick 最多 4 次滑动迭代。重力由控制器显式施加；速度单位为像素每秒，运动积分只乘一次物理步长。

包含物理对象的祖先链不得旋转、skew 或使用非单位 scale。CollisionShape2D 允许平移，尺寸由 shape 参数决定。视觉子节点可以独立缩放、旋转或翻转。非法组合直接产生节点级错误，不默默把旋转碰撞体退化为包围盒。

角色的 collision_mask 与静态体的 collision_layer 决定阻挡；Area 的 mask 与被监测身体的 layer 决定监测。明确区分物理阻挡与区域事件。出生或 Spawn 时发现实体与静态物体明显穿插，返回受限诊断，不实现复杂穿透恢复。

矩形与圆形触发区使用离散交叠检测。高速弹丸、极窄触发区和连续碰撞玩法不属于首版承诺；若后续扩展射击玩法，增加专门的 sweep 或 raycast 行为。TileMapLayer、刚体动力学、导航和完整布局系统安排在后续版本。

5 行为执行与游戏时间

固定步长执行顺序

运行时以固定 60 Hz 推进模拟，渲染跟随浏览器帧。该设置是调度约定，不代表跨浏览器位级确定性。Godot 也区分逐帧处理与固定间隔的物理处理；本项目保持这一区分。[S09]

1. 在安全点提交允许的作者热更新，准备本 tick 的输入快照。

2. 控制器读取输入，更新目标速度、重力和跳跃边沿；just_pressed 在所属 tick 只消费一次。

3. 执行角色运动与静态碰撞，更新地面、墙面和顶面接触状态。

4. 更新区域交叠、Timer 和动画事件，生成稳定顺序的事件队列。

5. SignalRule 和状态机处理事件，按 Action 顺序修改低频状态并排入结构命令。

6. 在 tick 末处理 Spawn、Destroy、Restart 等结构命令，再发布 HUD 和编辑器所需的变化摘要。

每帧最多补算 5 个模拟 tick；页面长时间离开后暂停模拟并清空积压，恢复时继续正常时间。设置每 tick 的事件和状态转移预算，例如最多 1000 个事件与 64 次转移；超额暂停该运行并显示具体规则诊断。上述数值是首版工程限额，需在基准场景中验证。

行为和动作

| 契约 | 参数或作用 | 执行规则 |
| --- | --- | --- |
| PlatformerController | 左右输入、跳跃输入、speed、jump_speed、gravity | 挂在角色下；跳跃设置向上的速度；重力配置来自控制器或场景默认 |
| TopDownController | 四方向输入与 speed | 归一化斜向输入；无重力；仍使用静态阻挡 |
| SignalRule | signal、filter_group、once、action | 订阅父节点；once 在排队前锁存，防止同 tick 重复执行 |
| StateMachine | initial、states、transitions、on_enter、on_exit | 只处理当前状态匹配的转移；无字符串 eval；条件使用受限表达式 |
| Spawner | 模板 ID、间隔、数量上限、出生参数 | 只从根可达的预制体注册表实例化；超上限拒绝继续生成 |
| @Set 与 @Reset | 低频全局 $variables | 使用 OpenUI 状态语义；每次试玩拥有独立状态实例 |
| 自定义动作 | EmitGameEvent、SetVisible、SetEnabled、SetInputEnabled、DestroyNode、Spawn、RestartScene | 注册名称和参数；由运行时执行器处理；不属于 OpenUI 内置能力 |



位置、速度、接触缓存和动画进度保留在 RuntimeWorld。分数、回合和 UI 选择等低频变量可使用 OpenUI store。变量变化只更新依赖它的属性，不重新解析源文本。游戏内 SetVisible 等动作属于运行覆盖值；无关作者补丁不得将未变化的作者默认值重新覆盖到它上面。

6 流式事务与提交规则

传输协议

使用 SSE 或等价流通道。传输信封由后端产生，模型内容始终是 OpenUI Lang。后端不把模型输出中的任意文本识别成提交指令。

begin {txId, sceneId, baseRevision, mode, libraryVersion}

delta {txId, seq, sourceDelta}

end   {txId, lastSeq, sourceHash}

error {txId, code, message}



mode 为 create 或 patch。seq 连续且可去重；sourceHash 按收到的累积源码计算。只有模型正常完成、未发生 token 截断且输出通过完整性检查，后端才发 end。连接关闭、取消和超时均不能代替 end。相同 txId 重放只返回既有结果，不重复应用。

草稿预览

首次生成可直接将累积文本交给 streaming parser 展示已有节点。编辑补丁则以已提交源码作为基线，在独立草稿映射中叠加已识别声明，保留尚未涉及的原有声明，预览不执行可达性清理。没有完整定义的节点只显示明确的占位，不启动物理、计时器、信号或 ready。

官方 mergeStatements 会按语句名合并并清理不可达声明，官方要求补丁结束后才进行正式合并。因此它只在本方案的完成提交阶段调用，不能每个 token 修改 live scene。[S06]

提交步骤

1. 检查 txId、chunk 顺序、完成信号、源码摘要、库版本和 baseRevision。

2. 先严格校验完整 create 或 patch 原文，拒绝未消费内容、截断和隐式闭合。patch 原文通过后才调用 mergeStatements，再校验合并后的完整程序；不能让宽容解析或可达性清理掩盖非法补丁。

3. 执行 schema 与场景语义校验，包括合法 root、引用闭合、唯一 ID、单父节点、无环、资源、动作目标和物理限制。

4. 准备所需资源和节点变更。资源异步准备完成后再次检查 baseRevision，防止等待期间用户的新编辑被覆盖。

5. 在运行安全点应用白名单热更新，或保存需要重新试玩的完整新定义。失败时保留旧版本，不执行部分节点变更。

6. 递增 authorRevision，记录 before 与 after source、变更摘要和关联标注；持久化成功后显示已保存。

源码切换在内存中一次完成，IndexedDB 在自身事务中保存完整项目记录。两者不是跨 GPU 和数据库的分布式事务；保存失败时保留内存结果并显示未保存，重启只读取最后完整保存的版本。

若需要边生成边试玩，将大任务拆成多个完整、可独立提交的小事务。每批具有引用闭合的 root；后续批次通过 patch 加入内容。不要根据 token 数或句号自动推断可运行边界。

7 热更新与生命周期

| 修改类型 | v1 生效方式 | 保留与重置规则 |
| --- | --- | --- |
| 颜色、纹理、HUD 文本、可见性 | 下一个安全点热更新 | 保留实体、当前位置、分数与计时进度 |
| 白名单 speed、jump_speed 等参数 | 下一模拟 tick 使用新配置 | 不回填出生位置，不重复 ready，不重启 Timer |
| 初始位置、碰撞形状、父子关系 | 保存到作者版本，重新试玩应用 | 当前世界保留旧运行基线 |
| 新增删除作者节点或修改 FSM 结构 | 保存到作者版本，重新试玩应用 | v1 不做任意结构的运行状态迁移 |
| 游戏中的 Spawn 或 Destroy | tick 末执行运行命令 | 只改变本次运行，不改变作者源码 |
| Restart | 按最新定义重新实例化 | 新 playSessionId 和 instanceId；重置状态、计时与运行销毁记录 |
| 撤销或重做 | 生成新的作者 revision | 恢复作者状态；不回放或倒退游戏时间 |



初次实例化先构造全部未激活节点并接好信号，再按父到子执行 enter_tree，按子到父执行 ready，最后进入下一模拟 tick。ready 每实例一次。该顺序参照 Godot；声明更新不能等同于 React 重新挂载。[S09]

暂停检查也有提交安全点：编辑器与渲染调度器可以提交颜色、纹理和文字更新，不推进物理或计时器。控制器参数保存后在恢复模拟时使用，避免暂停期间的外观编辑一直等待不存在的模拟 tick。

作者删除与游戏销毁必须分开。游戏中被拾取或击败的实例登记本 play session 的销毁记录；后续颜色补丁只更新仍存活的实例，不把它们重新生成。重新试玩才按作者定义重新实例化。

结构修改提交后设置 pendingRestart。runningRevision 不再跟随作者版本推进，直到重新试玩。暂停检查旧运行版本时，标注带上该基线；需要修改最新作者版本时重新定位并检查冲突，不能用旧语句直接覆盖新源码。

8 选取与 annotation

对象身份

| 字段 | 用途 |
| --- | --- |
| authorId | 作者节点或资源的稳定身份；移动层级和改名时保持 |
| statementId | OpenUI 语句名；用于定位补丁，不作为永久实例身份 |
| instanceId 和 playSessionId | 当前运行中的具体实例；区分同一模板的多个实例 |
| sceneRevision | 标注或修改所依据的作者版本 |
| scope | 作者节点、预制体模板或当前临时运行实例 |
| propertyPath 和 localAnchor | 属性定位及节点局部锚点；可附选取帧截图或状态摘要 |



当前 ElementNode 定义已有 statementId，内联组件可能没有它；因此可编辑对象独立命名，并维护 authorId 到源码范围和 runtime 对象的索引。[S07]

{

  "authorId": "player_visual",

  "statementId": "player_visual",

  "instanceId": "run_7/node_24",

  "playSessionId": "run_7",

  "sceneRevision": 12,

  "scope": "author_node",

  "propertyPath": "color",

  "localAnchor": {"x": 0, "y": -18},

  "instruction": "把角色改成橙色"

}



拾取和编辑模式

为每个可选元素维护 PickRegistry，包括编辑器命中形状、实际绘制矩阵、bounds、绘制顺序和身份。选取独立于物理层，装饰、背景、HUD 和无碰撞 Sprite 都可以选择。Pixi 指针事件和 hit area 提供基础能力；叠层候选、锁定与源码映射由编辑器实现。[S14]

1. 将鼠标坐标从页面转换为画布逻辑坐标，统一处理设备像素比、编辑视口和 Camera2D 变换。

2. 使用实际绘制矩阵变换到对象局部空间，按编辑器命中形状判断，默认选择可见且未锁定的最上层候选。

3. 支持穿透候选、多选和选父级；不可见行为节点通过场景树选择。选框与标注使用相同矩阵计算。

4. 记录目标身份、局部锚点、scope 和版本；模型请求携带所选声明、必要依赖、支持的组件签名及用户指令。

5. 收到完整补丁后定位修改范围，校验并显示变化。用户发起的普通修改按提交规则生效；删除、范围扩大或模板变更在界面清楚标出影响。

提供编辑、试玩、暂停检查三个模式。编辑模式接管拖动和选取；试玩模式将输入交给游戏；暂停检查冻结模拟以选取运行实例。一次输入只进入当前模式，避免点选时同时触发游戏动作。拖动使用全局 pointer move 或捕获策略，拖出元素仍能结束操作。

默认修改作者已放置的节点。预制体场景要明确选择本实例覆盖或模板修改；临时运行实例的修改先成为 session override，只有提升为作者实例覆盖或模板补丁才写入项目。节点删除后，原标注进入历史或失效状态，不绑定到碰巧同名的新节点。

OpenUI 的 @ToAssistant(message, context) 可以传递结构化上下文，但不会自动完成拾取、选框和标注存储。本方案可复用该动作传递编辑请求，也允许编辑器直接调用相同的后端请求入口。[S04]

9 资源与项目保存

项目以完整 OpenUI 源码为内容主文件。项目包额外保存 manifest、资源文件和 annotation；这些是宿主元数据，不成为第二套游戏逻辑语言。模型只引用资源目录里已经存在的 asset ID。图片未加载时可显示已知尺寸占位，碰撞尺寸始终来自显式 shape 参数。

资源与预制体通过 root 可达的 ResourceRegistry 或 PrefabRegistry，以实际语句引用登记。官方合并器只沿真实引用保留声明，@Spawn("enemyPrefab") 这样的字符串不会让同名定义自动保活。[S08]

| 项目包内容 | 保存内容 |
| --- | --- |
| project.oui | 完整作者源程序 |
| manifest.json | 项目 ID、schema 版本、运行时版本、资源映射和入口 |
| assets 目录 | 纹理、图集和其他允许的素材 |
| annotations.json | 持久化标注与作者身份，不含过期临时实例覆盖 |
| history.json 可选 | 作者事务记录；导出可以选择保留历史 |
| preview.png 可选 | 用于项目浏览的封面预览 |



IndexedDB 在一次项目事务内保存源码、manifest、标注和历史索引。导入先检查版本、资源引用与身份完整性，再创建编辑会话。自动保存与显式导出都使用同一份已提交作者数据，草稿单独保存，不伪装成可运行版本。

10 模型生成服务

采用后端直连所选模型供应商的适配层。为 create 和 edit 分别构建提示词，统一返回 OpenUI Lang。编辑模式由后端自己生成 prompt；当前 OpenUI 文档注明 Gateway 会丢弃 editMode 与 inlineMode，因此第一版不把该能力依赖放到 Gateway。[S06]

| 请求 | 必需上下文 | 返回 |
| --- | --- | --- |
| 创建项目 | 玩法要求、game2d schema、输入约定、可用资源、小型范例 | 完整 OpenUI 程序及宿主事务信封 |
| 局部编辑 | baseRevision、完整项目或必要依赖、选择身份、用户要求 | 仅新增或变化的 OpenUI 语句 |
| 修复错误 | 错误 code、authorId、statementId、propertyPath、合法签名 | 针对该错误的最小补丁 |



对小项目发送完整已提交源码；对大项目发送选中节点、祖先链、直接依赖、资源注册表和相关状态变量，仍在本地以完整项目合并校验。限制模型只能使用注册组件与动作，保持已有 ID，避免无关改名。

语法或语义失败时保留旧版本并最多进行两次定向自动修复；仍失败则展示可定位诊断和草稿。修复不得绕过相同提交检查。首屏速度依赖尽早输出合法 root 和小场景，局部编辑速度依赖短补丁，不能将 UI 案例的 token 节省比例直接视为游戏性能结果。

11 工程模块与实施顺序

| 模块 | 负责内容 |
| --- | --- |
| apps/editor | React 编辑界面、模式、对话、属性与历史 |
| apps/model-gateway | 模型适配、prompt、SSE 信封、取消与重试 |
| packages/game-schema | 节点、行为、动作签名与 game2d profile |
| packages/authoring | 源码索引、AST 编辑、语句补丁和严格检查 |
| packages/scene-compiler | SceneDefinition、语义校验、资源与引用图 |
| packages/runtime | 生命周期、输入、物理、状态机、命令和运行实例 |
| packages/render-pixi | 显示适配、资源、层级排序、相机 |
| packages/editor-tools | PickRegistry、选框、拖动、annotation 与源码映射 |
| packages/project-io | IndexedDB、历史、项目导入导出 |
| tests/fixtures | 语言切块、事务、物理、实例身份与可玩场景用例 |



| 里程碑 | 交付内容 | 完成标准 |
| --- | --- | --- |
| M0 契约 | 锁版本、schema、AST 适配、统一身份和诊断 | 手写程序可解析，错误有准确语句定位 |
| M1 画布与选取 | 静态场景、相机、PickRegistry、属性回写 | 选中正确节点，修改只影响目标源码 |
| M2 可玩运行时 | 输入、基础碰撞、控制器、区域、Timer、FSM | 手写完整关卡可通关与重开 |
| M3 生成与事务 | SSE、渐进预览、完成提交、修复和版本检查 | 流中断不影响旧版本，模型能生成受限玩法 |
| M4 Annotation 修改 | 对象标注、模型局部补丁、热更新、待重启规则 | 改外观保留运行状态，结构修改在重开后生效 |
| M5 保存与验收 | 自动保存、导入导出、资源、历史及端到端用例 | 关卡可恢复、可再编辑，验收场景全部通过 |



先使用手写 OpenUI 程序实现运行与编辑，完成后再接模型。这样生成错误与运行时错误可分别定位。优先完成一张含角色、地面、金币、终点和重开按钮的关卡，再增加节点种类。实时多人协作、完整刚体、复杂地图、导航与任意代码脚本不进入这些里程碑。

12 验收标准与性能目标

以下是待实施系统的验收目标，不是已经测得的性能结果。参考机、浏览器版本、画布尺寸和资源大小必须记录在基准报告中。

| 验收场景 | 必须观察到的结果 |
| --- | --- |
| 任意流式切块 | 完整文本、逐字符和随机 chunk 的最终定义一致；不完整节点无副作用 |
| 中断与非法程序 | 半写 root、重复 ID、悬空引用、未知属性或非法物理变换不能提交；旧世界继续可用 |
| 重复和过期事务 | 缺 chunk 不提交；同 txId 只执行一次；过期 baseRevision 不覆盖新编辑 |
| 生命周期 | 父先 enter、子先 ready，每实例一次；纹理修改不重复初始化或连接信号 |
| 高速撞墙与滑动 | 一个 tick 移动大于薄墙厚度时不穿墙；斜向碰撞可沿墙运动 |
| 帧率与计时 | 相同 tick 输入在不同渲染节奏下产生容差内一致结果；暂停和后台恢复不爆发补算 |
| 交叠事件 | 一次进入发一次 enter，持续交叠不重复计分，销毁不残留幽灵触发关系 |
| 热更新 | 改颜色或白名单速度保留位置、生命值、计分与 Timer；结构变更明确待重启 |
| 运行销毁 | 已收集金币不会因无关补丁复活；重开后按作者定义恢复 |
| 精确选取 | 相机、视觉父变换和 DPR 变化后命中正确对象；无 collider 对象仍可选 |
| 实例和模板 | 重复预制体实例可区分；本实例修改不会默默修改全部模板实例 |
| 往返保存 | 源码表达式、引用、资源和标注在导出导入后保持；撤销产生新 revision |
| 完整使用链路 | 生成关卡、试玩通关、选中角色改外观及速度、重新试玩、保存并恢复全部完成 |



基准场景设为 1080p 视口、500 个可见图形或精灵、100 个静态碰撞体、30 个动态角色和 100 个触发区。以记录的桌面参考机测量，目标为 steady-state 帧耗时 p95 不超过 16.7 ms，模拟耗时 p95 不超过 4 ms。该规模与阈值用于首轮验证，不能推断所有设备均达到 60 FPS。

客户端收到完整合法语句后，草稿可见更新目标为 100 ms 内；资源已就绪时，20 条以内补丁的校验与提交目标为 100 ms 内。模型首 token、输出速度、资源下载分别计量，不计入客户端指标，也不做固定总生成时长承诺。



附录 A 完整协议样例

此样例使用 game2d/1.0 自定义组件和动作，定义平台角色、地面、金币、终点、计分、通关状态与重开。图形使用 Polygon2D，避免依赖外部图片。下面展示的是目标协议，组件仍需按正文实现。

root = GameProject("demo", {profile: "game2d/1.0", entry_scene: "main", viewport: [960, 540], fixed_hz: 60, input_map: {move_left: ["KeyA", "ArrowLeft"], move_right: ["KeyD", "ArrowRight"], jump: ["Space"]}}, [main])

$score = 0

main = Scene2D("main", {gravity: [0, 980]}, [floor, player, coin, goal, hud, flow])

floor = StaticBody2D("floor", {position: [480, 500], collision_layer: 2}, [floor_shape, floor_visual])

floor_shape = CollisionShape2D("floor_shape", {shape: {type: "RectangleShape2D", size: [960, 40]}}, [])

floor_visual = Polygon2D("floor_visual", {polygon: [[-480, -20], [480, -20], [480, 20], [-480, 20]], color: "#334155"}, [])

player = CharacterBody2D("player", {position: [100, 430], groups: ["players"], collision_layer: 1, collision_mask: 2}, [player_shape, player_visual, move])

player_shape = CollisionShape2D("player_shape", {shape: {type: "RectangleShape2D", size: [28, 36]}}, [])

player_visual = Polygon2D("player_visual", {polygon: [[-14, -18], [14, -18], [14, 18], [-14, 18]], color: "#38BDF8"}, [])

move = PlatformerController("move", {left_action: "move_left", right_action: "move_right", jump_action: "jump", speed: 260, jump_speed: 420}, [])

coin = Area2D("coin", {position: [460, 450], collision_layer: 0, collision_mask: 1, monitoring: true}, [coin_shape, coin_visual, pickup])

coin_shape = CollisionShape2D("coin_shape", {shape: {type: "CircleShape2D", radius: 12}}, [])

coin_visual = Polygon2D("coin_visual", {polygon: [[0, -12], [12, 0], [0, 12], [-12, 0]], color: "#FBBF24"}, [])

pickup = SignalRule("pickup", {signal: "body_entered", filter_group: "players", once: true, action: Action([@Set($score, $score + 1), @DestroyNode("coin")])}, [])

goal = Area2D("goal", {position: [820, 440], collision_layer: 0, collision_mask: 1, monitoring: true}, [goal_shape, goal_visual, win_trigger])

goal_shape = CollisionShape2D("goal_shape", {shape: {type: "RectangleShape2D", size: [40, 80]}}, [])

goal_visual = Polygon2D("goal_visual", {polygon: [[-20, -40], [20, -40], [20, 40], [-20, 40]], color: "#22C55E"}, [])

win_trigger = SignalRule("win_trigger", {signal: "body_entered", filter_group: "players", once: true, action: @EmitGameEvent("goal_reached")}, [])

hud = CanvasLayer("hud", {layer: 10}, [help_label, score_label, win_label, restart])

help_label = Label("help_label", {position: [24, 20], text: "A / D 移动，空格跳跃，到达绿色终点"}, [])

score_label = Label("score_label", {position: [24, 48], text: "金币 " + $score}, [])

win_label = Label("win_label", {position: [360, 80], text: "通关", visible: false}, [])

restart = Button("restart", {position: [24, 80], size: [120, 40], text: "重新开始", action: @RestartScene("main")}, [])

flow = StateMachine("flow", {initial: "playing", states: [{name: "playing"}, {name: "won", on_enter: Action([@SetVisible("win_label", true), @SetInputEnabled("player", false)])}], transitions: [{from: "playing", event: "goal_reached", to: "won"}]}, [])



A1 样例执行约定

GameProject 和 Scene2D 是本项目容器；Polygon2D、Label 和 Button 实现正文列出的受限属性。

PlatformerController 读取父角色，jump_speed 为正数，跳跃时设置 velocity.y 为其负值。到终点后 SetInputEnabled 将角色输入置为零并屏蔽跳跃，控制器仍施加重力，使角色停止水平运动并正常落地。

SignalRule 订阅父 Area2D；group 过滤检查进入的身体。金币触发后先修改 $score，再在 tick 末销毁本实例。

SetVisible、SetInputEnabled、EmitGameEvent、DestroyNode、RestartScene 为自定义动作。动作目标字符串限定在当前场景实例内；进入预制体子实例时进一步限定实例作用域。

RestartScene 为当前项目创建新的试玩状态，恢复 $score 默认值并重置 FSM、once、Timer 和销毁记录。

A2 标注后的局部补丁

用户选中 player_visual 并要求角色变为橙色，同时移动速度降到 180。后端以当前 revision 构建修改请求，模型只返回两条语句。它们经同一事务校验后可热更新。

player_visual = Polygon2D("player_visual", {polygon: [[-14, -18], [14, -18], [14, 18], [-14, 18]], color: "#F97316"}, [])

move = PlatformerController("move", {left_action: "move_left", right_action: "move_right", jump_action: "jump", speed: 180, jump_speed: 420}, [])



补丁没有修改 player 的 position，因此当前角色位置保持。它没有修改 coin 的作者定义，也不会重新实例化已拾取的金币。若用户改的是 player_shape 尺寸，则保存新作者版本并等待重新试玩。



附录 B 官方依据

以下来源用于确认 OpenUI、Godot 与 Pixi 的现有能力和边界。本文的 game2d profile、运行时、事务信封、更新政策、指标和工程安排属于本项目设计。查阅日期为 2026年11月18日。

[S01] OpenUI Lang Core 官方 README

https://github.com/thesysdev/openui/blob/main/packages/lang-core/README.md

[S02] OpenUI 组件定义

https://www.openui.com/docs/openui-lang/defining-components

[S03] OpenUI Functions

https://www.openui.com/docs/openui-lang/functions

[S04] OpenUI Actions

https://www.openui.com/docs/openui-lang/actions

[S05] Lang Core 公开导出源码

https://github.com/thesysdev/openui/blob/main/packages/lang-core/src/index.ts

[S06] OpenUI Incremental Editing

https://www.openui.com/docs/openui-lang/incremental-editing

[S07] ElementNode 与解析结果定义

https://github.com/thesysdev/openui/blob/main/packages/lang-core/src/parser/types.ts

[S08] OpenUI 语句合并与可达性源码

https://github.com/thesysdev/openui/blob/main/packages/lang-core/src/parser/merge.ts

[S09] Godot Node

https://docs.godotengine.org/en/stable/classes/class_node.html

[S10] Godot Node2D

https://docs.godotengine.org/en/stable/classes/class_node2d.html

[S11] Godot CharacterBody2D

https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html

[S12] Godot CanvasItem

https://docs.godotengine.org/en/stable/classes/class_canvasitem.html

[S13] PixiJS 8 Scene Graph

https://pixijs.com/8.x/guides/concepts/scene-graph

[S14] PixiJS 8 Events

https://pixijs.com/8.x/guides/components/events

[S15] OpenUI 语言规范

https://github.com/thesysdev/openui/blob/main/spec/language.md