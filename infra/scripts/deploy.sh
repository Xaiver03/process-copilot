#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

die() {
  printf 'deploy preflight failed: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/process-copilot}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-process-copilot}"
HTTP_PORT="${COPILOT_HTTP_PORT:-18090}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
COMPOSE_FILE="$SOURCE_DIR/infra/compose.yaml"

[[ -f "$COMPOSE_FILE" ]] || die "missing $COMPOSE_FILE"
[[ "$DEPLOY_DIR" = /* && "$DEPLOY_DIR" != "/" ]] || die "DEPLOY_DIR must be a dedicated absolute directory"
[[ "$DEPLOY_DIR" != "/opt" && "$DEPLOY_DIR" != "/var" && "$DEPLOY_DIR" != "/home" ]] || die "DEPLOY_DIR is too broad"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{1,62}$ ]] || die "invalid Compose project name"
[[ "$RELEASE_ID" =~ ^[0-9A-Za-z][0-9A-Za-z_.-]{0,62}$ ]] || die "invalid release id"
[[ "$HTTP_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" -ge 1024 && "$HTTP_PORT" -le 65535 ]] || die "invalid HTTP port"
[[ -n "${POSTGRES_PASSWORD:-}" && "${POSTGRES_PASSWORD}" != "change_me_before_deploy" ]] || die "export a non-default POSTGRES_PASSWORD"
[[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._-]{20,128}$ ]] || die "POSTGRES_PASSWORD must be 20-128 env-file-safe characters"
[[ "${AI_CONFIG_ENCRYPTION_KEY:-}" =~ ^[A-Za-z0-9_-]{43}=$ ]] || die "export a valid Fernet AI_CONFIG_ENCRYPTION_KEY"
[[ "${OPERATOR_TOKEN_SECRET:-}" =~ ^[A-Za-z0-9._-]{32,128}$ ]] || die "export a 32-128 character OPERATOR_TOKEN_SECRET"
[[ "${INFERENCE_MODE:-online}" =~ ^(online|template)$ ]] || die "INFERENCE_MODE must be online or template"
[[ "${LLM_PROVIDER:-disabled}" =~ ^[A-Za-z0-9._-]+$ ]] || die "LLM_PROVIDER contains unsafe env-file characters"
[[ "${LLM_ALLOWED_HOSTS:-api.openai.com}" =~ ^[A-Za-z0-9.,_-]+$ ]] || die "LLM_ALLOWED_HOSTS contains unsafe env-file characters"
[[ "${ADMIN_AI_CONFIG_WRITE_ENABLED:-false}" =~ ^(true|false|0|1)$ ]] || die "ADMIN_AI_CONFIG_WRITE_ENABLED must be true or false"
if [[ "${LLM_PROVIDER:-disabled}" != "disabled" ]]; then
  [[ -n "${LLM_API_KEY:-}" ]] || die "LLM_API_KEY is required when LLM_PROVIDER is enabled"
  [[ -n "${LLM_BASE_URL:-}" && -n "${LLM_MODEL:-}" ]] || die "LLM_BASE_URL and LLM_MODEL are required when LLM_PROVIDER is enabled"
fi

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v ss >/dev/null 2>&1 || die "ss is required for port preflight"
command -v df >/dev/null 2>&1 || die "df is required for disk preflight"
command -v tar >/dev/null 2>&1 || die "tar is required for filtered release copy"

DISK_PATH="$DEPLOY_DIR"
while [[ ! -e "$DISK_PATH" && "$DISK_PATH" != "/" ]]; do
  DISK_PATH="$(dirname "$DISK_PATH")"
done
FREE_KB="$(df -Pk "$DISK_PATH" | awk 'NR==2 {print $4}')"
MIN_FREE_KB="${MIN_FREE_KB:-10485760}"
[[ "$FREE_KB" =~ ^[0-9]+$ && "$FREE_KB" -ge "$MIN_FREE_KB" ]] || die "insufficient free disk on $DISK_PATH"

if ss -H -ltn 2>/dev/null | awk -v p="$HTTP_PORT" '{n=$4; sub(/^.*:/,"",n); if (n == p) found=1} END {exit found ? 0 : 1}'; then
  die "TCP port $HTTP_PORT is already listening"
fi

pushd "$SOURCE_DIR" >/dev/null
if docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps -q 2>/dev/null | grep -q .; then
  popd >/dev/null
  die "Compose project $PROJECT_NAME already has containers; choose a unique project name"
fi
POSTGRES_USER="${POSTGRES_USER:-process_copilot}" \
POSTGRES_DB="${POSTGRES_DB:-process_copilot}" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
COPILOT_HTTP_PORT="$HTTP_PORT" \
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" config --quiet
popd >/dev/null

RELEASE_DIR="$DEPLOY_DIR/releases/$RELEASE_ID"
[[ ! -e "$RELEASE_DIR" ]] || die "release already exists: $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

copy_tree() {
  local source_dir="$1"
  local destination_dir="$2"
  local excludes=(
    "--exclude=.venv"
    "--exclude=node_modules"
    "--exclude=.next"
    "--exclude=coverage"
    "--exclude=__pycache__"
    "--exclude=.pytest_cache"
    "--exclude=.ruff_cache"
    "--exclude=process_copilot.db"
    '--exclude=.env*'
  )
  mkdir -p "$destination_dir"
  tar -C "$source_dir" -cf - "${excludes[@]}" . | tar -C "$destination_dir" -xf -
}

for path in infra apps services packages data; do
  if [[ -e "$SOURCE_DIR/$path" ]]; then
    copy_tree "$SOURCE_DIR/$path" "$RELEASE_DIR/$path"
  fi
done

# Keep the restrictive process umask for secrets while making only the public,
# read-only model/demo artifacts traversable by the non-root API and worker.
find "$RELEASE_DIR/data/processed" -type d -exec chmod 755 {} +
find "$RELEASE_DIR/data/processed" -type f -exec chmod 644 {} +

for path in package.json pnpm-workspace.yaml pnpm-lock.yaml pyproject.toml .env.example; do
  if [[ -e "$SOURCE_DIR/$path" ]]; then
    cp "$SOURCE_DIR/$path" "$RELEASE_DIR/"
  fi
done

CURRENT_LINK="$DEPLOY_DIR/current"
if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
  die "refusing to replace non-symlink $CURRENT_LINK"
fi
if [[ -L "$CURRENT_LINK" ]]; then
  CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
  case "$CURRENT_TARGET" in
    "$DEPLOY_DIR/releases/"*) ;;
    *) die "current symlink points outside releases" ;;
  esac
fi

RUNTIME_ENV="$DEPLOY_DIR/shared/runtime.env"
mkdir -p "$(dirname "$RUNTIME_ENV")"
printf 'POSTGRES_USER=%s\nPOSTGRES_DB=%s\nPOSTGRES_PASSWORD=%s\nCOPILOT_HTTP_PORT=%s\nCOMPOSE_PROJECT_NAME=%s\nINFERENCE_MODE=%s\nLLM_PROVIDER=%s\nLLM_BASE_URL=%s\nLLM_MODEL=%s\nLLM_API_KEY=%s\nLLM_TIMEOUT_SECONDS=%s\nLLM_MAX_TOKENS=%s\nLLM_PROMPT_VERSION=%s\nLLM_ALLOWED_HOSTS=%s\nADMIN_AI_CONFIG_WRITE_ENABLED=%s\nAI_CONFIG_ENCRYPTION_KEY=%s\nOPERATOR_TOKEN_SECRET=%s\n' \
  "${POSTGRES_USER:-process_copilot}" \
  "${POSTGRES_DB:-process_copilot}" \
  "$POSTGRES_PASSWORD" \
  "$HTTP_PORT" \
  "$PROJECT_NAME" \
  "${INFERENCE_MODE:-online}" \
  "${LLM_PROVIDER:-disabled}" \
  "${LLM_BASE_URL:-https://localhost}" \
  "${LLM_MODEL:-not-configured}" \
  "${LLM_API_KEY:-}" \
  "${LLM_TIMEOUT_SECONDS:-8}" \
  "${LLM_MAX_TOKENS:-500}" \
  "${LLM_PROMPT_VERSION:-event-copilot-v01}" \
  "${LLM_ALLOWED_HOSTS:-api.openai.com}" \
  "${ADMIN_AI_CONFIG_WRITE_ENABLED:-false}" \
  "$AI_CONFIG_ENCRYPTION_KEY" \
  "$OPERATOR_TOKEN_SECRET" > "$RUNTIME_ENV"
chmod 600 "$RUNTIME_ENV"

pushd "$RELEASE_DIR" >/dev/null
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$RELEASE_DIR/infra/compose.yaml" config --quiet
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$RELEASE_DIR/infra/compose.yaml" up -d postgres --wait
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$RELEASE_DIR/infra/compose.yaml" build api
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$RELEASE_DIR/infra/compose.yaml" run --rm --no-deps api python -m process_copilot_api.migrations
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$RELEASE_DIR/infra/compose.yaml" up -d --build --wait
popd >/dev/null

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
printf 'deployed release %s to %s (project=%s, port=%s)\n' "$RELEASE_ID" "$CURRENT_LINK" "$PROJECT_NAME" "$HTTP_PORT"
