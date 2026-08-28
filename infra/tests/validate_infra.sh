#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/compose.yaml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  printf 'missing compose file: %s\n' "$COMPOSE_FILE" >&2
  exit 1
fi

compose_config="$(
  cd "$ROOT_DIR"
  POSTGRES_USER=process_copilot \
  POSTGRES_PASSWORD=test-only-password \
  POSTGRES_DB=process_copilot \
  docker compose -p process-copilot-test -f "$COMPOSE_FILE" config
)"

for service in caddy web api worker postgres; do
  if ! grep -qE "^  ${service}:$" <<<"$compose_config"; then
    printf 'missing service: %s\n' "$service" >&2
    exit 1
  fi
done

if ! grep -q 'MODEL_ARTIFACT_DIR: /app/data/processed/models' <<<"$compose_config"; then
  printf 'MODEL_ARTIFACT_DIR must point inside processed artifacts\n' >&2
  exit 1
fi

web_config="$(sed -n '/^  web:/,/^  [^ ]/p' <<<"$compose_config")"
if ! grep -q 'HOSTNAME: 0.0.0.0' <<<"$web_config"; then
  printf 'standalone Next.js must bind 0.0.0.0 so its loopback healthcheck can connect\n' >&2
  exit 1
fi

if ! grep -q 'target: /app/data/processed' <<<"$compose_config" || ! grep -q 'read_only: true' <<<"$compose_config"; then
  printf 'api and worker must mount processed artifacts read-only\n' >&2
  exit 1
fi

if ! sed -n '/^  caddy:/,/^  [^ ]/p' <<<"$compose_config" | grep -qE ' - /config:' \
  || ! sed -n '/^  caddy:/,/^  [^ ]/p' <<<"$compose_config" | grep -qE ' - /data:'; then
  printf 'caddy needs writable /config and /data mounts\n' >&2
  exit 1
fi

caddy_config="$(sed -n '/^  caddy:/,/^  [^ ]/p' <<<"$compose_config")"
if ! grep -q 'NET_BIND_SERVICE' <<<"$caddy_config"; then
  printf 'official Caddy image requires NET_BIND_SERVICE because its binary carries that file capability\n' >&2
  exit 1
fi

if ! grep -q 'data/processed' "$ROOT_DIR/infra/docker/api.Dockerfile"; then
  printf 'api image must include processed artifacts\n' >&2
  exit 1
fi

up_line="$(grep -nE 'docker compose .* up -d --build --wait([[:space:]]|$)' "$ROOT_DIR/infra/scripts/deploy.sh" | head -n1 | cut -d: -f1 || true)"
switch_line="$(grep -nF 'ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"' "$ROOT_DIR/infra/scripts/deploy.sh" | head -n1 | cut -d: -f1 || true)"
if [[ -z "$up_line" || -z "$switch_line" || "$switch_line" -le "$up_line" ]]; then
  printf 'current symlink must switch only after compose up --wait succeeds\n' >&2
  exit 1
fi

if ! grep -q 'uv sync --frozen' "$ROOT_DIR/infra/docker/api.Dockerfile" \
  || ! grep -q 'pnpm install --frozen-lockfile' "$ROOT_DIR/infra/docker/web.Dockerfile"; then
  printf 'application images must install from frozen dependency locks\n' >&2
  exit 1
fi

if ! grep -q 'PIP_DEFAULT_TIMEOUT=120' "$ROOT_DIR/infra/docker/api.Dockerfile" \
  || ! grep -q 'UV_HTTP_TIMEOUT=120' "$ROOT_DIR/infra/docker/api.Dockerfile" \
  || ! grep -q 'pip install --retries 5' "$ROOT_DIR/infra/docker/api.Dockerfile"; then
  printf 'api image build must tolerate bounded dependency-download latency\n' >&2
  exit 1
fi

if grep -qE '^COPY --from=build .*apps/web/public ' "$ROOT_DIR/infra/docker/web.Dockerfile"; then
  printf 'web image must not unconditionally copy an optional public directory\n' >&2
  exit 1
fi

for exclude in .venv node_modules .next coverage __pycache__ .pytest_cache .ruff_cache process_copilot.db; do
  if ! grep -q -- "--exclude=$exclude" "$ROOT_DIR/infra/scripts/deploy.sh"; then
    printf 'deploy must exclude %s\n' "$exclude" >&2
    exit 1
  fi
done

if ! grep -q -- '--exclude=.env\*' "$ROOT_DIR/infra/scripts/deploy.sh" || ! grep -q 'env.example' "$ROOT_DIR/infra/scripts/deploy.sh"; then
  printf 'deploy must exclude env files but retain optional .env.example\n' >&2
  exit 1
fi

if ! grep -q 'shared/runtime.env' "$ROOT_DIR/infra/scripts/deploy.sh" \
  || ! grep -q -- '--env-file "$RUNTIME_ENV"' "$ROOT_DIR/infra/scripts/deploy.sh" \
  || ! grep -q 'chmod 600 "$RUNTIME_ENV"' "$ROOT_DIR/infra/scripts/deploy.sh"; then
  printf 'deploy must persist a protected runtime env and use it for compose up\n' >&2
  exit 1
fi

for script in rollback.sh backup-postgres.sh; do
  if ! grep -q -- '--env-file "$RUNTIME_ENV"' "$ROOT_DIR/infra/scripts/$script"; then
    printf '%s must reuse the protected runtime env\n' "$script" >&2
    exit 1
  fi
done

if grep -qE '^    ports:' <<<"$(sed -n '/^  postgres:/,/^  [^ ]/p' <<<"$compose_config")"; then
  printf 'postgres must not publish host ports\n' >&2
  exit 1
fi

printf 'infra validation passed\n'
