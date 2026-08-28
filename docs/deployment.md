# 单机部署说明

本项目使用独立 Compose project `process-copilot`，默认面向已审计的 `wunoos`。部署前不得复用已有 Compose project，也不得停止、清理或重建服务器上的其它容器。

## 拓扑与边界

```text
host:18090 -> caddy:8080 -> web:3000
                         -> api:8000 -> postgres:5432
                                      worker -> postgres:5432
```

- `web`、`api`、`worker` 使用自有镜像，Dockerfile 位于 `infra/docker/`，构建上下文为项目根目录。当前应用目录尚未完成，暂不执行 build。
- `postgres` 仅加入内部 `backend` 网络，不发布宿主机端口；数据保存在独立命名卷 `${COMPOSE_PROJECT_NAME}_pgdata`。
- `redis` 仅在 `cache` profile 启用：`docker compose --profile cache up -d`；默认关闭且不参与主链路。
- 服务默认只读根文件系统、非 root 用户、丢弃 Linux capabilities、禁止提权，并使用临时文件系统承载 `/tmp` 与必要缓存。
- 所有服务启用 JSON 日志轮转（10 MiB × 5）。Compose CPU/内存上限是保护值，需按实际模型负载调整。
- Caddy 当前监听容器高位端口 8080，宿主机默认映射 18090，避免占用 wunoos 已有的 80/443。生产 HTTPS 应由已审核的现有反向代理承载，或在确认端口和证书后另行配置。

## 本地检查

在项目根目录执行：

```bash
POSTGRES_USER=process_copilot \
POSTGRES_PASSWORD=test-only-password \
POSTGRES_DB=process_copilot \
docker compose -p process-copilot-test -f infra/compose.yaml config --quiet
bash infra/tests/validate_infra.sh
bash -n infra/scripts/*.sh
```

`config` 检查不要求 `apps/web` 或 `apps/api` 已存在；应用到位后才执行 `docker compose build`、healthcheck 和端到端验证。

## wunoos 部署前检查

审计记录：Ubuntu 24.04、16 CPU、54 GiB 内存、根盘余 47G；已有 25 个运行容器、147 个本地卷，80/443 等端口已有服务。Docker Registry HTTPS 出口可达。该主机磁盘和既有工作负载均需保守使用。

在目标主机的项目 checkout 中，使用专用目录和高位端口：

```bash
export DEPLOY_DIR=/opt/process-copilot
export COMPOSE_PROJECT_NAME=process-copilot
export COPILOT_HTTP_PORT=18090
export POSTGRES_PASSWORD='由运维安全注入的强密码'
bash infra/scripts/deploy.sh
```

脚本会依次检查：Docker/`ss`/`df` 是否可用、`DEPLOY_DIR` 是否为专用绝对路径、项目名格式、密码是否仍为默认值、磁盘余量（默认至少 10 GiB）、宿主机端口是否已监听、Compose project 是否已有容器，以及 `docker compose config`。通过后才创建 `$DEPLOY_DIR/releases/<release-id>` 和 `current` 链接，并只对该 project 执行 `up -d --build`。

脚本不执行全局 Docker prune，不使用 `--remove-orphans`，不修改防火墙、SSH、DNS、Nginx 或其它项目。

## 备份与回滚

```bash
bash infra/scripts/backup-postgres.sh
bash infra/scripts/rollback.sh 20260828T120000Z
```

备份只写入 `$DEPLOY_DIR/backups`，使用 `pg_dump --format=custom` 并生成同名 SHA-256 校验文件。回滚目标必须是 `$DEPLOY_DIR/releases/` 下已有发布目录；停止和启动操作只针对 `process-copilot` project。回滚前应先确认目标发布的 Compose config 和数据库兼容性。

## 运行后检查清单

1. `docker compose -p process-copilot -f current/infra/compose.yaml ps` 中各服务为 healthy。
2. 通过 `http://<host>:18090/healthz` 检查 Caddy/API 链路；确认无需直接暴露 API 或 PostgreSQL 端口。
3. 检查 `docker compose ... logs --tail=100`，不得出现密码、令牌或密钥。
4. 确认剩余磁盘、容器资源、宿主机监听端口，且既有容器状态未改变。
5. 首次发布完成后保留上一 release，完成一次可恢复的数据库备份和回滚演练。
