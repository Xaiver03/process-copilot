FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    UV_COMPILE_BYTECODE=1 \
    UV_HTTP_TIMEOUT=120 \
    PATH="/app/apps/api/.venv/bin:$PATH"
WORKDIR /app

RUN groupadd --system --gid 10001 process \
    && useradd --system --uid 10001 --gid process --home-dir /app --shell /usr/sbin/nologin process

COPY services/ml/pyproject.toml /app/services/ml/pyproject.toml
COPY services/ml/process_copilot_ml /app/services/ml/process_copilot_ml
COPY apps/api/pyproject.toml apps/api/uv.lock /app/apps/api/
COPY apps/api/alembic.ini /app/apps/api/alembic.ini
COPY apps/api/alembic /app/apps/api/alembic
COPY apps/api/process_copilot_api /app/apps/api/process_copilot_api
WORKDIR /app/apps/api
RUN python -m pip install --retries 5 uv==0.10.7 \
    && uv sync --frozen --no-dev \
    && chown -R process:process /app
COPY --chown=process:process data/processed /app/data/processed

USER process
EXPOSE 8000
CMD ["sh", "-c", "python -m process_copilot_api.migrations && uvicorn process_copilot_api.main:app --host 0.0.0.0 --port 8000"]
