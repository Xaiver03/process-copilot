# 序安 Process Sentinel（序安·过程哨兵）

状态：`REVIEW`  
当前 release：`20260828T0530Z`  
主链路：`过程数据回放 -> 偏移发现 -> 候选刷新 -> Top-3 变量证据 -> 安全建议 -> 人工确认 -> 审计留痕`

这不是泛化的“智慧工厂大屏”。它只聚焦连续生产装置的一个动作：当班工程师看到过程偏移后，快速判断“是不是真偏了、先看哪三个变量、下一步先查什么、谁确认过”。

## 已完成

- TEP 数据基座：原始包校验、Parquet 分层、变量字典、manifest 和冻结场景。
- 模型基线：PCA T²/SPE 偏移检测、SPE 变量贡献、三类 Demo 候选分类和确定性建议模板。
- 诚实的两阶段时间轴：首次异常点立即锁定事件；候选和证据在预注册的 20 个样本后刷新。`已更新` 不表示 `已确认`。
- FastAPI + PostgreSQL：场景、回放、SSE、事件、幂等人工决策、审计记录和真实 readiness。
- Next.js 驾驶舱：真实 scenario/run/event/decision/record 链路、网络降级、响应式和可访问性。
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

详细口径见 [数据说明](docs/submission/数据说明_v01_DRAFT.md)。

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

当前 Web 验收基线：`39 passed`；本轮同时通过 ESLint、TypeScript 和 Next.js production build。ML、API、契约与 infra 使用各自验收命令独立复核。

## 运行与部署

- 远端主机：`wunoos`
- 专用目录：`/opt/process-copilot`
- Compose project：`process-copilot`
- 宿主高位端口：`18090`
- 当前 release：`20260828T0530Z`

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
- [黑客松易拉宝 CMYK REVIEW PDF](04_交付成品/序安_Process_Sentinel_黑客松易拉宝_v05_ZH_CMYK_REVIEW.pdf)
- [黑客松易拉宝普通观众讲解逐字稿](docs/submission/序安黑客松易拉宝讲解逐字稿_v03_REVIEW.md)
- [黑客松易拉宝观看距离与字高验收](docs/submission/序安黑客松易拉宝观看距离与字高验收_v01_REVIEW.md)
- [序安现行标志应用审计](docs/submission/序安品牌标志应用审计_v01_REVIEW.md)
- [黑客松易拉宝实施计划](docs/plans/2026-08-28_序安黑客松易拉宝实施计划.md)
- [黑客松路演叙事稿](docs/submission/序安黑客松路演叙事_v01_DRAFT.md)
- [黑客松路演实施计划](docs/plans/2026-08-28_序安黑客松路演PPT实施计划.md)
- [作品说明](docs/submission/作品说明_v01_DRAFT.md)
- [三分钟 Demo 脚本](docs/submission/三分钟Demo脚本_v01_DRAFT.md)
- [连续化工 AI 判别与“工业小郎中”论文启示](docs/research/2026-08-28_连续化工AI判别与工业小郎中论文启示_v01_DRAFT.md)
- [UI 可读性与响应式审查](docs/design/2026-08-28_UI可读性与响应式审查_v01_REVIEW.md)
- [产品手册交付目录](04_交付成品/README.md)
- [产品手册唯一 LaTeX 源入口](02_方案源文件/README.md)
- [多 Agent 协作编排规范](docs/plans/2026-08-28_多Agent协作编排规范_v01_DRAFT.md)
- [Claude Code 独立验收 Prompt](docs/plans/2026-08-28_Claude_Code_独立验收Prompt_v01.md)
- [Figma 设计系统](https://www.figma.com/design/lpsBWvjCx54fF28rWLMpBx)
- [上游数据研究](../02_AI与贵州特色产业数据研究/README.md)
