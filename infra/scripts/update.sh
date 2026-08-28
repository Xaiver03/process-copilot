#!/usr/bin/env bash
# 已有部署的滚动更新：git 同步到 origin/main 后原地重建容器。
# 首次部署仍使用 deploy.sh；本脚本仅在 /opt/process-copilot-repo 已 clone 后运行。
set -Eeuo pipefail
umask 077

die() {
  printf 'update failed: %s\n' "$1" >&2
  exit 1
}

DEPLOY_DIR="${DEPLOY_DIR:-/opt/process-copilot}"
REPO_DIR="${COPILOT_REPO_DIR:-/opt/process-copilot-repo}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-process-copilot}"
BRANCH="${DEPLOY_BRANCH:-main}"
RUNTIME_ENV="$DEPLOY_DIR/shared/runtime.env"
GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i /root/.ssh/copilot-deploy/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/root/.ssh/copilot-deploy/known_hosts}"
export GIT_SSH_COMMAND

[[ -f "$RUNTIME_ENV" ]] || die "missing $RUNTIME_ENV"
[[ -d "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git checkout; clone the repo first"

command -v git >/dev/null 2>&1 || die "git is required"
command -v docker >/dev/null 2>&1 || die "docker is required"

cd "$REPO_DIR"
git remote get-url origin >/dev/null 2>&1 || die "no origin remote in $REPO_DIR"
git fetch --prune origin "$BRANCH"
git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null || die "origin/$BRANCH not found"

LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo none)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
printf 'updating %s: %s -> %s\n' "$REPO_DIR" "${LOCAL_SHA:0:12}" "${REMOTE_SHA:0:12}"

git reset --hard "origin/$BRANCH"

COMPOSE_FILE="$REPO_DIR/infra/compose.yaml"
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --build --wait

HTTP_PORT="$(grep '^COPILOT_HTTP_PORT=' "$RUNTIME_ENV" | cut -d= -f2)"
curl -fsS --max-time 10 "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null || die "post-deploy health check failed"

printf 'updated to %s\n' "${REMOTE_SHA:0:12}"
