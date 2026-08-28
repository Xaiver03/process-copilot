PYTHON ?= python3.12

.PHONY: contracts data data-force test test-ml test-api test-web test-e2e lint build compose-config infra-check

contracts:
	pnpm lint:contracts

data:
	uv run --project services/ml --frozen python -m process_copilot_ml.cli build-demo

data-force:
	uv run --project services/ml --frozen python -m process_copilot_ml.cli build-demo --force

test: test-ml test-api test-web contracts infra-check

test-ml:
	uv run --python 3.12 --project services/ml --extra test --frozen pytest -c services/ml/pyproject.toml services/ml/tests -q

test-api:
	uv run --python 3.12 --project apps/api --extra test pytest -c apps/api/pyproject.toml apps/api/tests -q

test-web:
	pnpm --filter web test

test-e2e:
	bash tests/e2e/smoke.sh

lint:
	uv run --project services/ml --frozen ruff check services/ml
	uvx --from ruff ruff check apps/api/process_copilot_api apps/api/tests
	pnpm --filter web lint
	pnpm --filter web typecheck

build:
	pnpm --filter web build

compose-config:
	POSTGRES_PASSWORD=test-only-password docker compose -f infra/compose.yaml config --quiet

infra-check:
	bash infra/tests/validate_infra.sh
