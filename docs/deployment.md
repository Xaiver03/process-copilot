# 单机部署说明

状态：`REVIEW`  
当前远端 release：`20260828T0530Z`

本项目使用独立 Compose project `process-copilot`，部署在已审计的 `wunoos` 专用目录 `/opt/process-copilot`。部署过程不停止、不清理、不重建服务器上的其它 Compose project、容器或卷。

## 已部署拓扑

```text
Internet HTTPS -> host Caddy -> 127.0.0.1:18090 -> container Caddy:8080 -> web:3000
                                                                          -> api:8000 -> postgres:5432
                                                                                       worker -> postgres:5432
```

- Web、API、worker、PostgreSQL、Caddy 五个服务均已通过健康检查。
- PostgreSQL 只在内部 `backend` 网络可见，不发布宿主端口；数据使用独立命名卷。
- Redis 仅在 `cache` profile 启用，当前主链路不依赖 Redis。
- Web 显式监听 `0.0.0.0`；Caddy 仅增加绑定容器监听端口所需的 `NET_BIND_SERVICE`，其它服务继续使用非 root、只读根文件系统、禁止提权及最小 capability。
- 镜像显式包含冻结的 `data/processed`；API readiness 会真实检查数据库与数据 manifest，worker 会报告模型是否可用。
- 所有服务启用 JSON 日志轮转（10 MiB × 5）。

## 当前发布事实

- 服务器：`wunoos`（公网 IP `119.8.167.61`）
- 发布根目录：`/opt/process-copilot`
- 当前 release：`/opt/process-copilot/releases/20260828T0530Z`
- 稳定入口：`/opt/process-copilot/current`
- Compose project：`process-copilot`
- 宿主监听：`0.0.0.0:18090`
- 公网入口：`https://huagong.finlaw.cloud`
- 宿主机 Caddy 配置：`/etc/caddy/conf.d/huagong.caddy`
- 运行环境文件：`/opt/process-copilot/shared/runtime.env`，权限 `0600`、所有者 `root:root`

公网请求通过宿主机现有 Caddy 的 80/443 入口反向代理到 `127.0.0.1:18090`。高位端口 `18090` 无需对公网放行；未经基础设施所有者明确授权，不修改安全组、防火墙或 DNS。仓库中的事实源为 `infra/caddy/host-public.caddy`，部署前必须先用 Caddy 校验完整配置。

宿主机代理包含以下边界：

- HTTPS 由宿主机 Caddy 自动承接，DNS 与证书由既有域名运维流程负责。
- HSTS、`nosniff`、拒绝 iframe、严格 Referrer Policy 和禁用摄像头/麦克风/定位权限。
- 拦截 `.env`、`.git`、`.svn` 等敏感路径。
- `flush_interval -1` 禁用响应缓冲，确保 SSE 心跳及时穿透两层代理。
- 访问日志输出到 systemd journal，避免使用权限不匹配的宿主文件。

当前配置部署前已备份为 `/etc/caddy/conf.d/huagong.caddy.backup-20260828-140735`，并在完整 `/etc/caddy/Caddyfile` 校验成功后 reload。公网验证入口：

```bash
curl --fail --show-error https://huagong.finlaw.cloud/healthz
BASE_URL=https://huagong.finlaw.cloud CHECK_WEB=1 bash tests/e2e/smoke.sh
```

SSH 隧道作为公网代理不可用时的运维降级入口：

```bash
ssh -N -L 127.0.0.1:18091:127.0.0.1:18090 wunoos
```

随后访问 `http://127.0.0.1:18091/demo`。

## 本地与远端验证

项目根目录：

```bash
pnpm install --frozen-lockfile
make test
make lint
make build
bash infra/tests/validate_infra.sh
```

运行中 E2E：

```bash
BASE_URL=https://huagong.finlaw.cloud CHECK_WEB=1 bash tests/e2e/smoke.sh
```

该脚本覆盖：场景读取、创建回放、真实事件、两阶段时序不变量、幂等冲突、人工确认、审计记录以及非法 SSE 游标 `400`。

## 首次部署

首次部署只在目标目录和 Compose project 均不存在时执行：

```bash
export DEPLOY_DIR=/opt/process-copilot
export COMPOSE_PROJECT_NAME=process-copilot
export COPILOT_HTTP_PORT=18090
export POSTGRES_PASSWORD='由运维安全注入的强密码'
bash infra/scripts/deploy.sh
```

脚本会先校验路径、项目名、磁盘、端口、密码和 Compose 配置，再创建不可变 release。只有 `docker compose up -d --build --wait` 全部成功后才切换 `current`；失败不会让入口指向半成品。

## 后续不可变发布

1. 在 `/opt/process-copilot/releases/<release-id>` 创建新目录并同步源文件，不覆盖旧 release。
2. 复用 `/opt/process-copilot/shared/runtime.env`，不得把密码写进 release、命令输出或 Git。
3. 在新 release 中执行：

```bash
docker compose --env-file /opt/process-copilot/shared/runtime.env \
  -p process-copilot -f infra/compose.yaml up -d --build --wait
```

4. 健康检查全部通过后，原子更新 `/opt/process-copilot/current`。
5. 运行 E2E、检查日志敏感信息，并比较部署前后的其它容器清单与状态。

## 备份与回滚

```bash
bash infra/scripts/backup-postgres.sh
bash infra/scripts/rollback.sh <已有-release-id>
```

脚本复用受保护的 runtime env。备份写入 `/opt/process-copilot/backups`，使用 PostgreSQL custom format 并生成 SHA-256；回滚目标必须是 `releases/` 下的已有目录。当前保留 `20260828T0225Z` 作为上一可运行版本。

## 运行后检查清单

1. `docker compose --env-file /opt/process-copilot/shared/runtime.env -p process-copilot -f /opt/process-copilot/current/infra/compose.yaml ps`：五个服务均为 healthy。
2. `/healthz`、`/api/v1/healthz` 与 `/api/v1/readyz` 返回成功；readiness 中数据库和数据 manifest 可用。
3. E2E 从创建回放走到审计记录，并验证两阶段样本差固定为 20。
4. 项目日志不包含密码、令牌、私钥或数据库连接凭证。
5. 部署前后的其它容器数量、名称与运行状态不变。
6. 公网只通过宿主机 Caddy 的 80/443 入口访问；不为 Demo 临时开放 `18090`。
