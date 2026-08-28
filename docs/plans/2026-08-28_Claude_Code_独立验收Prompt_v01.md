# Claude Code 独立验收 Prompt v01

将下面整段 Prompt 粘贴到 Claude Code。建议在项目根目录启动 Claude Code，本轮保持只读，不要让它和正在进行的部署任务同时改文件。

```text
你是“连续化工过程偏移副驾驶”项目的独立验收工程师。请对当前工作树进行一次严格、只读、可复现的交付验收。

项目绝对路径：
/Users/rocalight/Desktop/All in one Data/01_PROJECTS/FDE任务/03_产品与解决方案/03_连续化工过程偏移副驾驶

一、工作模式和禁止事项

1. 本轮只做只读验收，不修改任何文件，不生成提交，不推送，不部署。
2. 不运行 git reset、git checkout --、git clean、rm -rf、docker system prune、docker volume prune 或任何破坏性命令。
3. 当前工作树很可能是 dirty；所有已有改动都属于用户或其他 Agent，不得撤销、覆盖或整理。
4. 不操作 wunoos 或任何远程服务器；远端部署由主 Agent 正在执行。
5. 如果本机 Docker daemon 不响应，记录为环境阻塞，不重启 Docker Desktop/OrbStack，不影响其他项目容器。
6. 不把“命令无法执行”自动当成代码失败；必须区分代码缺陷、依赖问题、本机环境问题和外部网络问题。

二、必读材料

进入项目根目录后，按顺序阅读：

1. 当前目录和上级适用的 AGENTS.md。
2. README.md。
3. docs/plans/2026-08-28_多Agent协作编排规范_v01_DRAFT.md。
4. docs/plans/2026-08-28_连续化工过程偏移副驾驶_方案设计_v01_DRAFT.md。
5. docs/plans/2026-08-28_连续化工过程偏移副驾驶_实施计划_v01_DRAFT.md。
6. docs/submission/数据说明_v01_DRAFT.md。
7. docs/submission/三分钟Demo脚本_v01_DRAFT.md。
8. docs/deployment.md。
9. packages/contracts/openapi.yaml 与 packages/contracts/schemas/domain.schema.json。

三、已知交付基线

- 数据源是 Tennessee Eastman Process 公开仿真数据，不是贵州企业真实生产数据。
- 原始 ZIP SHA-256：fe3a3b0f096c9bd3f90fd33bfea0d54e0626d1e4dda7df0eb9daea7e103a24f4。
- 冻结 buildHash：c8920c786aea6d7171d27629e0be703a6222b383ba3672a930cb2328ede6c83b。
- 冻结 modelVersion：tep-pca-hgb-5bc36d3f4e6b。
- 正式 manifest 应包含 57 个产物，serving telemetry 不得出现 activeFaultId。
- 事件采用两阶段语义：detectionSample 是首次发现；diagnosisSample 是固定延迟 20 样本后的候选/证据刷新。updated 不等于 confirmed。
- 产品只读，不自动回写 DCS/PLC；人工 decision 只是 Demo 内审计留痕。
- 本机主 Agent 之前的基线：ML 23 tests、API 19 tests、Web 26 tests，但你必须独立复跑，不得直接采信。

四、验收范围

A. 数据与模型诚实性

- 检查数据导入的 shape、d00 转置、故障起点 160、窗口不跨 run。
- 检查模型拟合与冻结事件选择是否读取测试真值标签。
- 检查 scenario telemetry 是否泄露 activeFaultId 或其他答案字段。
- 检查检测点与研判点是否固定延迟、与 faultId/分类正确性无关。
- 检查 manifest 的路径、size、SHA-256 和 buildHash。

B. 契约与 API

- 对照 OpenAPI、domain schema、Pydantic schema 和实际响应。
- 检查 Scenario.description、variableId regex、EventDetail 两阶段字段、错误状态码。
- 检查幂等键：同 key 同 body 必须回放；同 key 不同 body 必须 409；并发时不得 500。
- 检查 readiness 真实访问数据库，错误 provenance 不得被静默改写为 TEP。
- 检查 SSE 的稳定排序和非法 Last-Event-ID=400。

C. 前端现场主链路

- 确认 /demo 和 /replay 是 scenario -> run -> 该 run 的真实 event -> decision -> record，不是硬编码 demo-run/demo-event。
- 确认只有 fetch 网络不可达时进入静态降级；HTTP 4xx/5xx 必须对用户显示错误，不得伪装成成功。
- 检查事件严重度、open/confirmed/rejected/escalated、faultId=0、审计时间和回放倍速。
- 检查两阶段字段的显示是否明确表达“候选已更新≠故障已确认”。
- 检查 1440/1024/768/390 宽度的溢出风险和基本键盘/语义化可访问性。

D. 容器、部署与安全边界

- 检查 Docker build context 是否排除 node_modules、.next、.venv、本地 DB 和密钥。
- 检查镜像是否从锁定文件安装，API 镜像是否包含冻结数据/模型。
- 检查 web 是否显式 HOSTNAME=0.0.0.0。
- 检查官方 Caddy 镜像的 NET_BIND_SERVICE 文件 capability 与 Compose cap_drop 是否兼容，不得简单取消所有容器硬化。
- 检查 PostgreSQL 不发布宿主端口，所有服务有 healthcheck，Caddy 只发布高位端口。
- 检查 deploy.sh 只在 compose up --wait 成功后切 current；失败不得切链。
- 检查强密码是否真正用于 compose up，是否持久化到权限 600 的 shared/runtime.env，backup/rollback 是否复用它。
- 检查脚本不清理其他 Compose project、卷、镜像、网络、防火墙、DNS 或反向代理。

E. 文档与黑客松可交付性

- 检查 README、数据说明、Demo 脚本、部署说明是否与当前实现一致。
- 任何“尚未创建/审批后实现/尚未构建”的过时文案都要报告。
- 检查数据源、ZIP hash、buildHash、modelVersion、三个场景、两阶段语义、只读边界是否可被评委一页读懂。

五、独立复跑命令

按顺序执行；不要并发运行 Next build/typecheck，避免共享 .next 竞态：

git status --short
pnpm lint:contracts
uv run --project services/ml --frozen pytest services/ml/tests -q
uv run --project services/ml --frozen ruff check services/ml
uv run --python 3.12 --project apps/api --extra test pytest -c apps/api/pyproject.toml apps/api/tests -q
uvx --from ruff ruff check apps/api/process_copilot_api apps/api/tests
python3 -m compileall -q apps/api/process_copilot_api
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
bash infra/tests/validate_infra.sh
bash -n infra/scripts/*.sh infra/tests/*.sh tests/e2e/*.sh
POSTGRES_PASSWORD=test-only-password docker compose -f infra/compose.yaml config --quiet
POSTGRES_PASSWORD=test-only-password docker compose --profile cache -f infra/compose.yaml config --quiet

再独立验证 manifest：以 data/processed 为 artifacts[].path 的基准目录，使用 sizeBytes 和 sha256 核对全部 57 个文件。不要假设字段名是 bytes。

如果本机 Docker daemon 可正常使用，仅使用独立 project name 和空闲高位端口做容器检查；否则跳过并报告环境阻塞。不要停止或重建任何现有容器。

六、输出格式

先给“验收结论”：PASS / PASS WITH RISKS / FAIL。

然后只输出以下部分：

1. P0/P1/P2/P3 发现，按严重度排序。每条必须包含：标题、绝对文件路径与行号、可复现命令/输入、期望行为、实际行为、影响、最小修复建议。
2. 已通过的证据：命令、测试数量、hash、build 产物。
3. 未能执行的检查及原因：明确区分环境阻塞与代码缺陷。
4. 按得分项评估：问题洞察 25、Demo 25、方案完整度 20、落地可行性 20、大众人气 10；每项给分和一句证据。
5. “是否适合进入 100 天 PoC”的 Go / Conditional Go / No-Go 建议，以及最优先的三个下一步。

如果没有发现，明确写“未发现可复现缺陷”，但不得省略验收证据。
```

## 启动方式

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/FDE任务/03_产品与解决方案/03_连续化工过程偏移副驾驶"
claude
```

启动后粘贴上面的 Prompt。如果你希望 Claude Code 后续修复它发现的问题，先让它完成只读报告，再对具体缺陷单独授权，避免和其他 Agent 产生并发写冲突。
