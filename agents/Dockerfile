# Dockerfile for the b2c agents (webhook server + scheduler).
# One image, two commands — controlled by CMD override in compose.

FROM python:3.12-slim

WORKDIR /app

# System deps: build tools for psycopg (binary wheel normally, but fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (cached layer)
COPY agents/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Copy code.
COPY agents/ /app/agents/
COPY db/ /app/db/

# Non-root runtime user
RUN useradd -u 1001 -m aa && chown -R aa:aa /app
USER aa

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Default: run the webhook server. Compose overrides for scheduler.
CMD ["python", "-m", "agents.webhook_server"]
