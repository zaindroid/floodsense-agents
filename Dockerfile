FROM python:3.12-slim

# Coolify runs its healthcheck inside the container and needs curl or wget.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY agents/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agents/floodsense_agents ./floodsense_agents
# The service serves ui/mock at /mock and looks for it beside the package.
COPY ui/mock ./ui/mock
COPY ui/app ./ui/app

# Rewritten on every sync by .github/workflows/sync-from-monorepo.yml.
ENV GIT_SHA=442d19f25c1f44468c18b11419f83e5616d6e448 BUILT_AT=2026-10-25T14:50:15Z

# 8080 is the only port Coolify's healthcheck targets. Runs on the stand-ins:
# no Zetaris or Meterless credentials, so no secrets reach this image.
ENV AGENTS_HOST=0.0.0.0 \
    AGENTS_PORT=8080 \
    CHECKPOINTER=memory \
    FF_JUDGE=true \
    PYTHONUNBUFFERED=1

EXPOSE 8080
CMD ["python", "-m", "floodsense_agents"]
