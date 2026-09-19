# ==============================================================================
# Stage 1: Build virtualenv and compile C++ native extensions (fasttext)
# ==============================================================================
FROM python:3.11-slim-bookworm AS builder

# Install build tools (build-essential provides g++ C++17 compiler required by fasttext)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:0.6.14 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=0 \
    UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

# Copy dependency specifications
COPY pyproject.toml uv.lock* ./

# Install project dependencies into /app/.venv
RUN uv sync --frozen --no-dev --no-install-project || uv sync --no-dev --no-install-project

# Copy application files
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
COPY run.py ./
COPY entrypoint.sh ./

# Install project package into virtualenv
RUN uv sync --frozen --no-dev || uv sync --no-dev

# ==============================================================================
# Stage 2: Minimal runtime image
# ==============================================================================
FROM python:3.11-slim-bookworm AS runner

# Install only runtime dependencies:
# - libgomp1: OpenMP runtime required by fasttext
# - curl: required by container healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binary for scripts
COPY --from=ghcr.io/astral-sh/uv:0.6.14 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000

# Copy application and pre-built virtualenv from builder
COPY --from=builder /app /app

RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
