#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DEPLOY_DIR="${DEPLOY_DIR:-/opt/process-copilot}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-process-copilot}"
CURRENT_DIR="$DEPLOY_DIR/current"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
COMPOSE_FILE="$CURRENT_DIR/infra/compose.yaml"
RUNTIME_ENV="$DEPLOY_DIR/shared/runtime.env"

die() { printf 'backup failed: %s\n' "$1" >&2; exit 1; }
[[ "$DEPLOY_DIR" = /* && "$DEPLOY_DIR" != "/" ]] || die "DEPLOY_DIR must be a dedicated absolute directory"
[[ "$DEPLOY_DIR" != "/opt" && "$DEPLOY_DIR" != "/var" && "$DEPLOY_DIR" != "/home" ]] || die "DEPLOY_DIR is too broad"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{1,62}$ ]] || die "invalid Compose project name"
[[ -L "$CURRENT_DIR" && -f "$COMPOSE_FILE" ]] || die "current release is missing"
[[ -f "$RUNTIME_ENV" ]] || die "runtime env is missing"
case "$BACKUP_DIR" in
  "$DEPLOY_DIR"/*) ;;
  *) die "BACKUP_DIR must stay under DEPLOY_DIR" ;;
esac
command -v docker >/dev/null 2>&1 || die "docker is required"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/postgres-$STAMP.dump"
TEMP_TARGET="$TARGET.partial"
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  > "$TEMP_TARGET"
mv "$TEMP_TARGET" "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
printf 'backup created: %s\n' "$TARGET"
