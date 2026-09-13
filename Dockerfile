# syntax=docker/dockerfile:1

# The FastAPI RAG service (src/app.py) — SQLite, FAISS, sentence-transformers, llama-cpp-python.
# This is the service apps/health-service was a placeholder for; see docker-compose.yml.

# --- builder: compile llama-cpp-python and other native deps -----------------
FROM python:3.11-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
# sentence-transformers pulls in torch; without pinning to the CPU wheel index, pip
# resolves a CUDA build and drags in several GB of unused nvidia-* packages.
RUN pip install --no-cache-dir --prefix=/install \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    -r requirements.txt

# --- runtime -------------------------------------------------------------------
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /usr/local
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY schemas ./schemas
COPY config ./config

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

EXPOSE 8000

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)" || exit 1

CMD ["sh", "-c", "python scripts/db_migrate.py up && exec uvicorn src.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
