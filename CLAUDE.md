# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

面向连续化工装置中控室工程师的「偏移副驾驶」demo，基于 Tennessee Eastman Process (TEP) 公开仿真数据演示完整路径：`过程数据回放 -> 偏移发现 -> 故障研判 -> 关键变量证据 -> 处置建议 -> 人工确认与留痕`。

**硬边界（写入产品定位，勿越界）**：只做读侧分析与建议，不自动回写 DCS/PLC；演示必须标注数据来源为公开仿真（非贵州真实工厂数据）。处置建议中的固定安全边界文案见 `apps/api/process_copilot_api/main.py` 的 `DEFAULT_SAFETY_BOUNDARY`。

## 常用命令

pnpm workspace (web/contracts) + uv (Python) 双包管理。所有 Python 命令带 `--frozen`。

```bash
# 数据构建（从 TEP zip 生成确定性 demo 产物到 data/processed/）
make data            # 已存在时跳过；--force 强制重建用 make data-force

# 测试（全部）
make test            # = test-ml + test-api + test-web + contracts + infra-check
make test-ml         # services/ml: uv run --project services/ml --frozen pytest services/ml/tests -q
make test-api        # apps/api: uv run --python 3.12 --project apps/api --extra test pytest -c apps/api/pyproject.toml apps/api/tests -q
make test-web        # pnpm --filter web test
make test-e2e        # bash tests/e2e/smoke.sh（需服务运行，默认 BASE_URL=http://127.0.0.1:18090）
pnpm lint:contracts  # redocly lint packages/contracts/openapi.yaml

# Lint / 构建
make lint            # ruff (ml + api) + web eslint + web typecheck
make build           # pnpm --filter web build
make compose-config  # docker compose config 校验（POSTGRES_PASSWORD=test-only-password）
make infra-check     # bash infra/tests/validate_infra.sh
```

根 `pyproject.toml` 定义 pytest/ruff 配置（ruff: line-length 100, 规则 E/F/I/B/UP），但各包需用各自的 `-c <pyproject>` 或 `--project` 运行。

## 多 Claude Code 并行门禁

- 只要存在两个或以上互不依赖同一中间状态、且能划分为不重叠写集的任务，必须优先启动多个 Claude Code 会话并行处理；不得让调研、实现、测试设计和文档审阅无故串行等待。
- 每个会话启动前必须写清目标、基线提交、唯一可写路径、禁止范围、验证命令、提交要求和验收证据。边界不清或会修改同一共享文件时，先由 Codex 拆分或改为串行。
- 并行实现必须使用独立 Git worktree 和独立 `codex/` 分支；每个任务只做单一职责提交，不 push、不改写历史、不操作生产服务器。
- 共享契约、数据库迁移、部署配置、README、中央 LaTeX 主文件、版本号和最终 Git 集成只由 Codex 处理。Claude Code 可以运行局部门禁，但其自报结果不能代替 Codex 的 diff 复核、全量测试、Playwright、视觉 QA 和部署后 smoke。
- 不向任何并行会话暴露无关密钥、生产凭据或个人数据。发现必须跨越写集才能解决的问题时，只报告证据与建议，由 Codex 重新编排。

## 架构

三层数据流，契约先行：

1. **services/ml**（Python, uv）：CLI `build-demo` 从上游 TEP zip（路径在 `services/ml/process_copilot_ml/cli.py` 的 `_default_source_zip`，位于兄弟目录 `02_AI与贵州特色产业数据研究/`）确定性生成 `data/processed/`：bronze parquet（train/test 各 fault_00–21）、模型产物（PCA 检测器 + 故障分类器，joblib + model_manifest.json）、3 个回放 scenario（telemetry.parquet + scenario.json + event-template.json）、variable_dictionary.json。构建有 staged 验证 + build hash + manifest。
2. **apps/api**（FastAPI + SQLAlchemy）：读 `data/processed/`（DataCatalog），API 版本前缀 `/api/v1`，经 Caddy 反代。写 Postgres（runs/events/decisions/audit/idempotency 表）；支持 `Idempotency-Key` 头；错误响应用统一 Problem 格式；无 DATABASE_URL 时回退到本地 sqlite。`worker.py` 是刻意的只读单进程检查器（无外部队列），入口保持稳定以便未来加 replay executor。
3. **apps/web**（Next.js + vitest）：路由 `/`、`/demo`、`/replay`、`/overview`、`/events`、`/events/[id]`、`/records/[id]`、`/system`、`/healthz`。API 类型手写在 `src/lib/api-schema.ts`，客户端在 `src/lib/api-client.ts`。视觉继承 Wuno 设计 token（`packages/ui/src/tokens.css`）。

**packages/contracts/openapi.yaml 是 API 契约的权威来源**（redocly lint 把关）；`packages/contracts/schemas/domain.schema.json` 为领域 schema。改动 API 时先改契约。

## 部署约束（重要）

单机部署到已审计的 `wunoos` 主机，规则见 `docs/deployment.md`：

- Compose project 名固定 `process-copilot`，**不得复用/触碰服务器上其他容器**。
- 宿主机端口用高位 18090（80/443 已被占用），postgres 不发布端口。
- 所有容器只读根文件系统、非 root、no-new-privileges。
- `infra/scripts/deploy.sh` 有前置安全检查（密码非默认、磁盘余量、端口冲突等），不要绕过。

## 文档

`docs/plans/` 存放方案设计与实施计划（DRAFT 状态），`docs/submission/` 是参赛材料。README 明确了上游资料位置（数据研究、选题建议、Wuno 设计系统）。
