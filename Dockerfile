FROM python:3.12-slim

# Coolify runs its healthcheck inside the container and needs curl or wget.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY agents/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agents/floodsense_agents ./floodsense_agents

# Rewritten on every sync by .github/workflows/sync-from-monorepo.yml.
ENV GIT_SHA=e7f82d825fbfd39d807c3d1302c6c54bf04e46d7 BUILT_AT=2026-10-24T09:09:46Z

# 8080 is the only port Coolify's healthcheck targets. Runs on the stand-ins:
# no Zetaris or Meterless credentials, so no secrets reach this image.
ENV AGENTS_HOST=0.0.0.0 \
    AGENTS_PORT=8080 \
    CHECKPOINTER=memory \
    FF_JUDGE=true \
    PYTHONUNBUFFERED=1

EXPOSE 8080
CMD ["python", "-m", "floodsense_agents"]
