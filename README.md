# 序安 Process Sentinel（序安·过程哨兵）

状态：`REVIEW`

当前交付分支：`codex/process-sentinel-online-ai`

主链路：`过程数据回放 -> 在线偏移发现 -> Top-3 候选与变量证据 -> 人机主动追问 -> 人工确认 -> 影子门禁 -> 调用与决策审计`

这不是泛化的“智慧工厂大屏”。它只聚焦连续生产装置的一个动作：当班工程师看到过程偏移后，快速判断“是不是真偏了、先看哪三个变量、下一步先查什么、谁确认过”。

## 已完成

- TEP 数据基座：原始包校验、Parquet 分层、变量字典、manifest 和冻结场景。
- 模型基线：PCA T²/SPE 偏移检测、SPE 变量贡献、三类 Demo 候选分类和确定性建议模板。
- 诚实的两阶段时间轴：首次异常点立即锁定事件；候选和证据在预注册的 20 个样本后刷新。`已更新` 不表示 `已确认`。
- FastAPI + PostgreSQL：场景、回放、SSE、事件、幂等人工决策、审计记录和真实 readiness。
- Next.js 驾驶舱：真实 scenario/run/event/decision/record 链路、网络降级、响应式和可访问性。
- 完整管理后台：AI 运行概览、Provider 配置、密钥只写、调用记录、配置审计与管理员 RBAC。
- 人机协同研判：事件证据内主动追问；公网复用 SSOS 的配置管理模式，通过 OpenAI-compatible API 接入 DeepSeek，已实测返回 `llm_enhanced / deepseek-v4-flash`。单次失败仍按后端策略进入模板或降级，页面始终显示实际 mode/model/Trace；供应商密钥不写入仓库。
- 受控执行预演：AI Trace 绑定人工编辑后的动作草案，后端持久化 5 道影子门禁；Demo 永远 `sent=false`，不向 PLC/DCS 发送。
- 序安产品界面与组件规范：[Figma](https://www.figma.com/design/lpsBWvjCx54fF28rWLMpBx)。
- Docker Compose：Web、API、worker、PostgreSQL、Caddy 五个健康服务，含发布、备份和回滚脚本。

## 数据与产品边界

- 上游：[camaramm/tennessee-eastman-profBraatz](https://github.com/camaramm/tennessee-eastman-profBraatz)
- ZIP SHA-256：`fe3a3b0f096c9bd3f90fd33bfea0d54e0626d1e4dda7df0eb9daea7e103a24f4`
- buildHash：`c8920c786aea6d7171d27629e0be703a6222b383ba3672a930cb2328ede6c83b`
- modelVersion：`tep-pca-hgb-5bc36d3f4e6b`
- 场景：`F01 Feed composition step deviation`、`F06 A-feed loss`、`F13 Reaction kinetics slow drift`
- 这是公开仿真数据，不是贵州企业真实生产数据；不能据此声称生产误报率、漏报率、提前量或收益。
- 系统只提供读侧证据与建议，没有 DCS、PLC、联锁或控制回路写回能力。
- 公网管理后台可查看真实运行状态，但 AI 配置写入和连接测试默认关闭；有效密钥经受控管理员路由写入并由目标环境重新加密，不复制 SSOS 密文、不写入仓库。私有部署才可按白名单和出站策略开启变更。

详细口径见 [数据说明](docs/submission/数据说明_v01_DRAFT.md)。

## 技术栈与技术选型

以下是当前代码和部署配置中的技术事实；版本范围以各层 `package.json`、`pyproject.toml` 和 [Compose 配置](infra/compose.yaml) 为准。

| 层 | 当前选型 | 选择理由与边界 |
| --- | --- | --- |
| 前端 | Next.js 15、React 19、TypeScript；ECharts 用于过程图表 | 适合把驾驶舱、路由和服务端交付放在同一 Web 应用中，同时保留响应式、可访问性和可测试组件；前端只展示 API 返回的证据与状态。见 [`apps/web/package.json`](apps/web/package.json)。 |
| 后端 | FastAPI、Pydantic 2、SQLAlchemy 2、Uvicorn；REST API + SSE 回放事件流 | 类型化契约、健康检查和实时回放边界清晰，便于把场景、run、事件、人工决策和审计记录拆开；接口契约集中在 [`packages/contracts/openapi.yaml`](packages/contracts/openapi.yaml)。 |
| 数据库 | 部署使用 PostgreSQL 16、psycopg 3、Alembic；测试可注入 SQLite | PostgreSQL 负责持久化运行、事件、AI 交互、配置、决策和审计数据；SQLite 仅用于轻量测试与本地隔离，不代表生产数据库。 |
| ML 与数据 | Python 3.12；NumPy、scikit-learn、PyArrow、Joblib、Parquet | TEP 使用 PCA T²/SPE 和候选分类，污水场景使用基于 7 个在线变量的 RandomForest 软测量；冻结数据和模型产物可校验、可重放，不把 Demo 结果表述为生产性能。见 [`services/ml/pyproject.toml`](services/ml/pyproject.toml)。 |
| LLM 接入 | OpenAI-compatible HTTP 接口；配置项包括 provider、base URL、model、超时、token 上限和 fallback 策略 | 通过统一协议保留供应商可替换性，并将结构校验、只读提示词和模板/降级路径放在后端；当前公网使用 DeepSeek 配置，但供应商密钥、完整 endpoint 和运行时敏感配置不写入 README 或仓库。 |
| 认证与权限 | 预置操作员账号、PBKDF2 口令哈希、HS256 JWT Bearer；operator / shift lead / admin 角色 | 满足 Demo 的登录、角色门禁和审计链路；不提供自助注册，不把 Demo 账号模式当作完整生产 IAM。实现见 [`apps/api/process_copilot_api/auth.py`](apps/api/process_copilot_api/auth.py)。 |
| 部署与反向代理 | Docker Compose 编排 Web、API、worker、PostgreSQL、Caddy；Web 使用 Node 22 standalone，API/worker 使用 Python 3.12；Caddy 转发 Web 与 `/api`、健康检查路由 | 服务隔离、健康依赖、内部后端网络和公网 HTTPS 入口更容易复现；Caddy 对外提供入口，高位应用端口保持在宿主机回环/运维路径，不直接暴露给公网。见 [`infra/caddy/Caddyfile`](infra/caddy/Caddyfile)。 |
| 测试与质量门禁 | API/ML 使用 pytest，Web 使用 Vitest + Testing Library；Playwright 做跨 BASE_URL 用户旅程；Redocly 做 OpenAPI 契约检查；另有 Ruff、ESLint、TypeScript、Next build 与基础设施校验 | 分层验证数据/模型、接口/持久化、组件交互、真实浏览器旅程和发布配置，避免只用单元测试推断端到端行为。统一入口见 [`Makefile`](Makefile) 与 [`tests/e2e`](tests/e2e)。 |

### 当前 Demo 只读边界

- 数据来自公开仿真或公开污水传感器记录，不是贵州企业真实生产数据；当前文档不宣称生产误报率、漏报率、提前量、收益或任何未验证性能。
- AI 输出是证据整理、风险解释和检查建议，不是法规超限结论；预测边界、候选变量和模板回答均需人工确认。
- Demo 不连接 PLC/DCS、联锁或控制回路；受控执行仅为影子门禁预演，保持 `sent=false`，不会向生产控制系统写回。
- 公网或本地环境的 LLM 调用可能返回在线增强、模板或降级模式；页面必须展示实际 mode/model/Trace，不能把配置目标写成已验证结果。

## 快速验证

需要 Node 22、pnpm 9.15.4、Python 3.12、uv 和 Docker Compose。

```bash
pnpm install --frozen-lockfile
make test
make lint
make build
```

数据重建必须显式使用 `make data-force`。运行中的 E2E：

```bash
BASE_URL=http://127.0.0.1:18090 CHECK_WEB=1 bash tests/e2e/smoke.sh
```

当前 Web 验收基线：`83 passed`；本轮同时通过 ESLint、TypeScript 和 Next.js production build。API 为 `162 passed`，ML 为 `63 passed`；契约与基础设施校验均通过。

正式前后端用户旅程验收：

```bash
PLAYWRIGHT_BASE_URL=https://huagong.finlaw.cloud \
PLAYWRIGHT_EVIDENCE_TARGET=public \
pnpm test:e2e:journeys
```

同一套 Playwright 脚本在本地与公网均通过 `11/11`，每套覆盖 24 个关键状态并同时保存首屏与完整页面，共 96 张截图；响应式证据覆盖 1440、1024、768、390 像素宽度。UJ-09 至 UJ-11 专门验证工业模型证据、AI 追问、调用审计、运行与降级状态、密钥不回显、人工编辑动作和后端持久化影子门禁。详见 [完整用户旅程验收](docs/submission/序安完整用户旅程验收_v01_REVIEW.md)与 [AI 用户流程验收](docs/submission/序安AI用户流程验收_v01_REVIEW.md)。

## 运行与部署

- 远端主机：`wunoos`
- 专用目录：`/opt/process-copilot`
- Compose project：`process-copilot`
- 宿主高位端口：`18090`
- 当前部署源：`main@261330f`（应用代码）；Playwright 契约与公网完整 11/11 证据提交：`92b4bf7`

公网 HTTPS 入口已经通过宿主机 Caddy 反向代理接通：

- Demo：<https://huagong.finlaw.cloud/demo>
- Caddy 将公网请求转发到回环地址 `127.0.0.1:18090`；无需对公网开放高位端口。
- DNS 与证书继续由既有域名运维流程负责，本项目不修改域名解析。
- 已验证完整 E2E、SSE 心跳透传、敏感路径拦截和安全响应头。

SSH 隧道保留为运维降级入口：

```bash
ssh -N -L 127.0.0.1:18091:127.0.0.1:18090 wunoos
```

然后打开 `http://127.0.0.1:18091/demo`。详见 [部署说明](docs/deployment.md)。

## 核心目录

```text
apps/web/                 Next.js 驾驶舱
apps/api/                 FastAPI、PostgreSQL 与 worker
services/ml/              数据/模型构建管线
packages/contracts/       OpenAPI 与 domain schema
packages/ui/              Wuno/WUWUI 产品 token
data/processed/           冻结数据、模型与场景
data/manifests/           产物 hash 台账
infra/                    镜像、Compose、Caddy 与运维脚本
tests/e2e/                针对任意 BASE_URL 的 smoke
docs/plans/               方案、实施、Agent 编排和 Claude Code Prompt
docs/submission/          作品、数据与 Demo 材料
```

## 交付入口

- [黑客松路演 PPTX / PDF](04_交付成品/README.md)
- [黑客松易拉宝唯一 LaTeX 源与构建说明](../../04_品牌与市场资产/Wuno_WUWEI品牌市场/07_LaTeX文档工程/02_产品手册/2026-08_连续化工过程偏移副驾驶/易拉宝_2026-08_序安黑客松/README.md)
- [黑客松易拉宝普通观众讲解逐字稿](docs/submission/序安黑客松易拉宝讲解逐字稿_v03_REVIEW.md)
- [黑客松易拉宝观看距离与字高验收](docs/submission/序安黑客松易拉宝观看距离与字高验收_v01_REVIEW.md)
- [序安现行标志应用审计](docs/submission/序安品牌标志应用审计_v01_REVIEW.md)
- [黑客松易拉宝实施计划](docs/plans/2026-08-28_序安黑客松易拉宝实施计划.md)
- [黑客松路演叙事稿](docs/submission/序安黑客松路演叙事_v01_DRAFT.md)
- [黑客松路演实施计划](docs/plans/2026-08-28_序安黑客松路演PPT实施计划.md)
- [作品说明](docs/submission/作品说明_v01_DRAFT.md)
- [三分钟 Demo 脚本](docs/submission/三分钟Demo脚本_v01_DRAFT.md)
- [完整演示演习手册](docs/submission/序安完整演示演习手册_v01_REVIEW.md)
- [Codex 与 Claude Code 多智能体协作规范](docs/development/多智能体协作规范_v01.md)
- [连续化工 AI 判别与“工业小郎中”论文启示](docs/research/2026-08-28_连续化工AI判别与工业小郎中论文启示_v01_DRAFT.md)
- [UI 可读性与响应式审查](docs/design/2026-08-28_UI可读性与响应式审查_v01_REVIEW.md)
- [产品手册交付目录](04_交付成品/README.md)
- [产品手册唯一 LaTeX 源入口](02_方案源文件/README.md)
- [完整前后端用户旅程验收](docs/submission/序安完整用户旅程验收_v01_REVIEW.md)
- [AI 用户流程验收](docs/submission/序安AI用户流程验收_v01_REVIEW.md)
- [多 Agent 协作编排规范](docs/plans/2026-08-28_多Agent协作编排规范_v01_DRAFT.md)
- [Claude Code 独立验收 Prompt](docs/plans/2026-08-28_Claude_Code_独立验收Prompt_v01.md)
- [Figma 设计系统](https://www.figma.com/design/lpsBWvjCx54fF28rWLMpBx)
- [上游数据研究](../02_AI与贵州特色产业数据研究/README.md)
