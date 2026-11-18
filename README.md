# Ptah Studio

一个在浏览器中创作和试玩 2D 关卡的 OpenUI Lang 编辑器。内置「暮光遗迹」平台跳跃关卡、俯视收集关卡和设计文档的完整附录示例。项目的源码、纹理、标注与历史可以一起导出，下一次导入后继续编辑。

## 启动

需要 Node.js 22.12 或更高版本，持续集成使用 Node.js 24。

```sh
git clone https://github.com/jdfsank/ptah-oul.git
cd ptah-oul
npm ci
cp .env.example .env
npm run build
npm start
```

打开 **http://127.0.0.1:8787**。示例、试玩、属性编辑和项目保存均可离线使用。开发时可运行 `npm run dev`，打开 Vite 输出的地址。网关默认监听本机，使用 `PORT` 可以更改端口。

## 模型服务

将凭据放入服务端环境或本机的 `.env`。界面右上角的设置显示实际模型、服务地址和配置状态。

| 配置 | 语言生成和修改 | 图像生成 |
| --- | --- | --- |
| 模型 | `TEXT_MODEL=gpt-6.2-sol` | `IMAGE_MODEL=gpt-image-2.6-sunburst` |
| 地址 | `TEXT_BASE_URL=https://api.openai.com/v1` | `IMAGE_BASE_URL=https://api.openai.com/v1` |
| 密钥 | `TEXT_API_KEY` | `IMAGE_API_KEY` |
| 协议 | `TEXT_API=responses` 或 `chat` | Images API，PNG 的 `b64_json` |

官方地址可共用服务端 `OPENAI_API_KEY`。第三方服务需单独设置对应的密钥。地址填写包含 API 版本前缀的 base URL。语言与图像可以同时使用不同服务商。远程地址使用 HTTPS，本机兼容服务也可使用 HTTP。

语言生成通过 OpenAI Agents SDK 的 Agent、Runner 和 OpenAIProvider 执行。默认使用 Responses API。只提供 Chat Completions 的兼容服务可以选择 `chat`；流必须返回正常结束原因。图像使用独立的 OpenAI 客户端。Tracing 默认关闭。

## 编辑与试玩

1. 打开示例后点击「试玩关卡」。平台关卡使用 A、D 或方向键移动，空格跳跃。俯视关卡使用 WASD 或方向键移动。
2. 在编辑模式选择画布对象，或从场景树选择控制器、形状和行为。Alt 点击穿透选取，Shift 点击多选，拖动修改位置。属性面板能定位父节点和表达式。
3. 在「创作助手」选择生成关卡、局部修改或生成素材。局部修改附带选择身份和标注。涉及额外声明的补丁先显示修改范围。生图成功后自动登记纹理并插入可编辑的 Sprite2D。
4. 暂停检查后修改颜色或控制器速度，可以继续原来的试玩。碰撞形状和拓扑变更会提示重新试玩。动态生成的实例可使用本次试玩覆盖，修改模板则影响模板定义。
5. 保存状态显示在右上角。浏览器使用 IndexedDB 自动保存。导出的 ZIP 包包含 project.oui、manifest.json、annotations.json、history.json 和 assets/。更换浏览器或设备时可用「项目与示例」导入。

GitHub 保存系统代码、版本锁、示例和验收用例。用户在编辑器里创作的关卡由该浏览器或其导出的项目包保存。

## 工程入口

| 模块 | 职责 |
| --- | --- |
| apps/editor | React 编辑器、标注、助手、无副作用草稿预览 |
| apps/model-gateway | 服务端模型配置、Agents SDK、SSE、去重与取消 |
| packages/game-schema、authoring、scene-compiler | game2d/1.0、官方解析与合并、声明索引和严格校验 |
| packages/runtime | 固定 60 Hz、空间哈希与 swept AABB、触发器、FSM、预制体、热更新 |
| packages/render-pixi、editor-tools | PixiJS 8 WebGL、相机、HUD、纹理、变换与拾取 |
| packages/project-io | IndexedDB、导入导出、标注、历史 |
| tests | 两种玩法、模型服务协议、浏览器端到端测试与性能基准 |

## 验证与恢复

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run benchmark
```

端到端测试通过真实浏览器、编辑器、网关和 Agents SDK 执行，用本地协议服务提供固定模型输出；不需要 API 凭据。可通过 `CHROMIUM_EXECUTABLE` 指定已有 Chromium。性能基准在 1920 × 1080 下测量，输出环境和 p95。参考结果和已知边界见 [验收记录](docs/verification.md)。原始设计和作者协议见 [设计文档](docs/design.md)。

恢复系统时从 main 或指定提交检出代码，执行 npm ci，并在服务端恢复自己的凭据。恢复游戏项目时导入项目包。
