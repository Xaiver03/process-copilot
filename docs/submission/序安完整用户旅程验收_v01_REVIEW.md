# 序安 Process Sentinel 完整用户旅程验收 v01

状态：`REVIEW`

验收日期：2026-08-29

公网入口：<https://huagong.finlaw.cloud>

应用基线提交：`5d04377`

用户旅程验收提交：`8006d85`

## 1. 验收结论

本轮不是只检查“页面能否打开”，而是用同一套 Playwright 脚本分别对以下两个真实前后端环境执行完整用户旅程：

- 本地当前代码环境：Docker Compose 启动 Web、API、worker、PostgreSQL、Caddy 五个服务，入口为 `http://127.0.0.1:18092`。
- 公网部署环境：经 HTTPS 反向代理访问 `https://huagong.finlaw.cloud`。

两套环境均为 `11/11 passed`，无跳过、无重试、无 flaky。每套环境保存 24 个关键状态，每个状态同时保存“当前视口”和“完整页面”，即每套 48 张、合计 96 张 Playwright 截图。其中 UJ-09 至 UJ-11 专门验证 AI 的工业推理、证据引用、人工追问、调用审计、运行状态、降级透明度、密钥与配置安全边界，以及 AI Trace 绑定人工编辑动作后的持久化影子门禁。

| 环境 | 旅程 | 通过 | 失败 | 跳过 | 首屏截图 | 全页截图 |
|---|---:|---:|---:|---:|---:|---:|
| 本地当前代码 | 11 | 11 | 0 | 0 | 24 | 24 |
| 公网部署 | 11 | 11 | 0 | 0 | 24 | 24 |

机器可读证据：

- 本地：`90_构建与分析缓存/用户旅程验收_v01/local/journey-manifest.json`
- 公网：`90_构建与分析缓存/用户旅程验收_v01/public/journey-manifest.json`
- 原始 Playwright JSON：各环境目录下的 `playwright-results.json`
- HTML 报告与 trace：各环境目录下的 `html-report/`、`test-results/`，作为本地可重建缓存，不作为长期发布成品。

`journey-manifest.json` 记录每条旅程状态与耗时，并为每张截图保存文件名、类型、字节数和 SHA-256，可用于确认截图完整性。

## 2. 用户与权限模型

| 用户 | 可见能力 | 受限能力 | 本轮验证 |
|---|---|---|---|
| 未登录访客 | 演示引导、过程回放、事件证据、写回预演 | 不能在线追问、不能提交人工结论、不能进入后台 | UJ-01、UJ-02 |
| 中控操作员 | 在线追问、升级上报、查看自己的审计记录、编辑动作草案并运行影子门禁 | 不能确认或驳回；不能进入管理后台；不能向控制系统发送 | UJ-03、UJ-06、UJ-09、UJ-11 |
| 当班班长 | 在线追问、确认、驳回、升级、审计留痕 | 不能进入管理后台 | UJ-04 |
| 工艺工程师 | 在线追问、确认、驳回、升级、审计留痕 | 不能进入管理后台 | UJ-05 |
| 系统管理员 | 运行概览、AI 配置、调用记录、配置审计 | 公网 AI 配置只读，不能写入密钥或任意 Provider | UJ-06、UJ-09、UJ-10 |

Demo 不提供自助注册。生产部署应替换为企业 SSO / IAM，并移除页面可见的演示口令。

## 3. 完整用户旅程矩阵

### UJ-01 访客创建并控制真实回放

用户动作：进入演示页，打开过程回放，选择 F01 场景，点击开始，观察当前样本推进，切换 20 倍速，暂停并确认样本保持不变，再恢复并等待偏移事件出现。

前后端链路：

`GET /api/v1/scenarios` → `POST /api/v1/runs` → `POST /api/v1/runs/{runId}/control` → `GET /api/v1/runs/{runId}/stream` → `GET /api/v1/runs/{runId}/events`

通过标准：样本从 0 增长；暂停期间不增长；恢复后继续增长；当前 run 出现“进入事件研判”入口；页面无水平溢出。

证据状态：`UJ01-01_演示入口`、`UJ01-02_在线回放推进`、`UJ01-03_偏移捕获`。

### UJ-02 未登录访客查看 AI 依据和只读写回预演

用户动作：从事件直链查看 AI 研判结论、Top-3 关键变量证据和人工决策区，确认页面提示登录后才能使用在线 AI；点击“预演写回”。

前后端链路：`GET /api/v1/events/{eventId}`；写回预演只在前端生成草案，不向控制系统发送请求。

通过标准：证据、候选、建议与登录门均可见；写回状态明确显示“草案已生成，未校验、未发送”；没有 PLC / DCS / APC 写回。

证据状态：`UJ02-01_未登录事件研判`、`UJ02-02_受控写回仅预演`。

### UJ-03 中控操作员主动追问并升级

用户动作：以中控操作员登录，打开当前在线事件，输入“为什么不是传感器故障”，读取回答模式、模型、证据和 Trace；检查决策下拉框只有“升级处理”；填写说明并提交；打开审计记录。

前后端链路：`POST /api/v1/auth/login` → `POST /api/v1/events/{eventId}/ask` → `POST /api/v1/events/{eventId}/decision` → `GET /api/v1/records/{recordId}`。

通过标准：AI 回答可见且包含模型/证据/Trace；操作员无法确认或驳回；记录显示“升级处理”、操作员身份和 Trace ID。

证据状态：`UJ03-01_操作员AI追问`、`UJ03-02_操作员升级记录`。

### UJ-04 当班班长确认偏移

用户动作：以当班班长登录，打开独立事件，选择“确认偏移”，填写理由，提交并打开记录。

前后端链路：登录、读取事件、提交人工决策、读取记录。

通过标准：班长拥有确认/驳回/升级三种选项；审计字段精确显示“确认偏移”和 `当班班长 (shift-lead)`。

证据状态：`UJ04-01_班长确认记录`。

### UJ-05 工艺工程师驳回偏移

用户动作：以工艺工程师登录，打开另一独立事件，选择“驳回偏移”，把建议采纳情况设为“人工覆盖”，填写理由并提交。

前后端链路：登录、读取事件、提交人工决策、读取记录。

通过标准：审计字段精确显示“驳回偏移”和 `工艺工程师 (process-engineer)`；不与班长或操作员记录串线。

证据状态：`UJ05-01_工程师驳回记录`。

### UJ-06 管理后台与 RBAC

用户动作：先以中控操作员打开 `/admin`，确认被拒绝；再产生一条专用 AI 问答；退出并以系统管理员登录；依次查看运行概览、AI 配置、调用记录和配置审计；尝试保存 AI 配置。

前后端链路：

`GET /api/v1/admin/overview`、`GET /api/v1/admin/ai/status`、`GET /api/v1/admin/ai/config`、`PUT /api/v1/admin/ai/config`、`GET /api/v1/admin/ai/interactions`、`GET /api/v1/admin/audit`。

通过标准：普通账号得到前端拒绝且后台 API 受角色保护；管理员看到 Worker、工业模型和语言模型状态；公网保存配置返回只读警告；刚产生的 AI 问题在调用记录的同一行中可见，并带回答摘要、模型、延迟和 Trace ID；配置审计页可读取。

证据状态：`UJ06-01_普通账号拒绝后台`、`UJ06-02_管理运行概览`、`UJ06-03_AI配置只读边界`、`UJ06-04_AI调用记录`、`UJ06-05_配置审计`。

### UJ-07 前端系统状态与后端健康检查

用户动作：访问 `/system`，同时通过 API 请求 `healthz` 与 `readyz`。

通过标准：`healthz.status=ok`；`readyz` 至少确认数据库和工业模型可用；前端依赖表显示 `database`、`industrial_model`；主内容明确显示“当前 Demo 只读”。

证据状态：`UJ07-01_系统健康与只读边界`。

### UJ-08 桌面、平板和手机响应式

用户动作：以系统管理员登录，分别使用 1440×900、1024×768、768×1024、390×844 视口访问演示、回放、事件和后台页面，并点击 01–05 步骤导航验证锚点聚焦。

通过标准：每个视口下 `document.scrollWidth` 与 `body.scrollWidth` 均不超过视口宽度 1 像素；主内容可见；事件页分别保留完整截图。

证据状态：`UJ08-桌面1440_事件页`、`UJ08-平板1024_事件页`、`UJ08-平板768_事件页`、`UJ08-手机390_事件页`。

### UJ-09 AI 工业研判、解释与调用审计同链

用户动作：读取在线事件的工业模型研判，核对故障候选、Top-3 过程变量和只读安全边界；中控操作员主动向 AI 追问；系统管理员在调用记录中定位同一次回答。

前后端链路：

`GET /api/v1/events/{eventId}` → `POST /api/v1/events/{eventId}/ask` → `GET /api/v1/admin/ai/interactions`

通过标准：事件模型版本为 `tep-pca-hgb-*`；恰有三项变量证据；回答明确返回 `mode`、`model`、`evidenceRefs`、`latencyMs`、`traceId`；所有证据引用均属于该事件的 Top-3 变量；后台记录的事件、问题、答案、模式、模型、证据和 Trace 与原始回答逐字段一致。

证据状态：`UJ09-01_AI研判与证据解释`、`UJ09-02_AI调用同链审计`。

### UJ-10 AI 模式透明、密钥不回显与公网只读

用户动作：系统管理员检查 AI 运行概览和 AI 运行配置；同时直接核对状态与配置 API；尝试更新配置和发起连接测试。

前后端链路：

`GET /api/v1/admin/ai/status` → `GET /api/v1/admin/ai/config` → `PUT /api/v1/admin/ai/config` → `POST /api/v1/admin/ai/test`

通过标准：推理模式为在线，Worker 和工业模型就绪，工业模型版本可识别；语言模型状态只允许就绪、降级、离线或未知，非就绪时必须给出原因；配置响应明确返回 `apiKeyConfigured=true`，不得含 `apiKey` 或疑似密钥；密码输入框加载后为空；公开环境的配置写入与管理员手动连接测试均返回 `403 admin_ai_read_only`，但已配置的运行探针和事件问答必须真实返回 `llm_enhanced / gpt-5.5`，两者不得混淆。

证据状态：`UJ10-01_AI运行与降级状态透明`、`UJ10-02_AI配置密钥与只读边界`。

### UJ-11 AI Trace、人工编辑与持久化影子门禁

用户动作：中控操作员围绕当前事件发起一条新追问，取得该回答的 Trace；在“受控写回预演”中编辑拟议动作，点击“运行影子门禁”，再由 API 回查后端持久化的控制提案。

前后端链路：

`POST /api/v1/events/{eventId}/ask` → `POST /api/v1/events/{eventId}/control-proposals` → `GET /api/v1/events/{eventId}/control-proposals/{proposalId}`

通过标准：`sourceTraceId` 与刚产生的 AI 回答一致；拟议动作与人工编辑后的文本一致；5 项门禁中只有“人工确认拟议动作”和“校验操作者权限”通过，其余 3 项因 Demo 不具备工艺联锁、控制网关与二次确认而阻断；响应固定为 `executionMode=shadow`、`state=blocked_demo_boundary`、`sent=false`；页面明确“从未向 PLC/DCS 发送”。

证据状态：`UJ11-01_AI人工编辑影子门禁`。

AI 专项的逐步状态、数据契约与人机责任边界另见 `docs/submission/序安AI用户流程验收_v01_REVIEW.md`。

## 4. 截图完整性约定

每个证据状态固定产生两个文件：

- `*_首屏.png`：当前浏览器视口，用于产品手册、演示核对和排版检查。
- `*_全页.png`：页面从顶部到底部的完整长图，用于确认没有被截图边界截断。

完整截图目录：

- `90_构建与分析缓存/用户旅程验收_v01/local/screenshots/`
- `90_构建与分析缓存/用户旅程验收_v01/public/screenshots/`

产品手册只选取首屏图以保证可读性；所有全页图继续随本验收证据保留，不以手册缩略图替代完整页面证据。

## 5. 复现命令

本地当前代码环境：

```bash
NO_PROXY=127.0.0.1,localhost \
no_proxy=127.0.0.1,localhost \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:18092 \
PLAYWRIGHT_EVIDENCE_TARGET=local \
pnpm test:e2e:journeys
```

公网环境：

```bash
PLAYWRIGHT_BASE_URL=https://huagong.finlaw.cloud \
PLAYWRIGHT_EVIDENCE_TARGET=public \
pnpm test:e2e:journeys
```

重新生成带截图哈希的清单：

```bash
node tests/e2e/build-journey-manifest.mjs \
  --target public \
  --base-url https://huagong.finlaw.cloud
```

## 6. 已知边界

- 数据来自 Tennessee Eastman Process 公开仿真，不是贵州真实企业生产数据。
- 在线工业模型负责连续偏移检测和候选更新；当前公网自有 OpenAI-compatible 服务的 `gpt-5.5` 已产生真实 `llm_enhanced` 回答，若单次外部调用不可用则返回明确标记的模板/降级答案，不伪装成功。
- 当前 Demo 不向 APC、DCS、PLC 或 SIS 写回。页面和后端只持久化影子提案与门禁结果；生产版应在独立权限、约束、联锁、双人确认、受控网关、读回和回滚机制完成后再开放。
- 本轮证明的是软件链路、角色边界、证据组织、可追溯性和 Demo 稳定性；不据此声称真实工厂误报率、漏报率、提前量或经济收益。

## 7. 停止 Goal 的交付门

只有以下项目同时完成后，才可停止本 Goal：

- 本地与公网 Playwright 均 11/11；
- 96 张截图及两个哈希清单存在且通过校验；
- 前端、API、契约、infra、构建和 smoke 全量验证通过；
- 本文档与产品 README 已更新；
- 中央 LaTeX 产品手册创建新版本、编译成功、逐页渲染检查通过，并发布到 `04_交付成品/`；
- 变更按职责分组提交并推送，远端分支与本地提交一致。
