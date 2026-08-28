#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf 'rollback failed: %s\n' "$1" >&2; exit 1; }
TARGET_RELEASE="${1:-}"
[[ -n "$TARGET_RELEASE" ]] || die "usage: rollback.sh <release-id>"
[[ "$TARGET_RELEASE" =~ ^[0-9A-Za-z][0-9A-Za-z_.-]{0,62}$ ]] || die "invalid release id"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/process-copilot}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-process-copilot}"
CURRENT_DIR="$DEPLOY_DIR/current"
TARGET_DIR="$DEPLOY_DIR/releases/$TARGET_RELEASE"
CURRENT_COMPOSE="$CURRENT_DIR/infra/compose.yaml"
TARGET_COMPOSE="$TARGET_DIR/infra/compose.yaml"
RUNTIME_ENV="$DEPLOY_DIR/shared/runtime.env"

[[ "$DEPLOY_DIR" = /* && "$DEPLOY_DIR" != "/" ]] || die "DEPLOY_DIR must be a dedicated absolute directory"
[[ "$DEPLOY_DIR" != "/opt" && "$DEPLOY_DIR" != "/var" && "$DEPLOY_DIR" != "/home" ]] || die "DEPLOY_DIR is too broad"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{1,62}$ ]] || die "invalid Compose project name"
[[ -L "$CURRENT_DIR" && -f "$CURRENT_COMPOSE" ]] || die "current release is missing"
[[ -d "$TARGET_DIR" && -f "$TARGET_COMPOSE" ]] || die "target release is missing"
[[ -f "$RUNTIME_ENV" ]] || die "runtime env is missing"
CURRENT_TARGET="$(readlink "$CURRENT_DIR")"
case "$CURRENT_TARGET" in
  "$DEPLOY_DIR/releases/"*) ;;
  *) die "current symlink points outside releases" ;;
esac

docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$TARGET_COMPOSE" config --quiet
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$CURRENT_COMPOSE" down
docker compose --env-file "$RUNTIME_ENV" -p "$PROJECT_NAME" -f "$TARGET_COMPOSE" up -d --wait
ln -sfn "$TARGET_DIR" "$CURRENT_DIR"
printf 'rolled back project %s to %s\n' "$PROJECT_NAME" "$TARGET_RELEASE"
