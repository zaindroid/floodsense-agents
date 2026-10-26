FROM python:3.12-slim

# Coolify runs its healthcheck inside the container and needs curl or wget.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY agents/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agents/floodsense_agents ./floodsense_agents
# The console and the pages are this repository's own: the monorepo's agents/
# is the graph's API and nothing else. console/ finds ui/ beside itself.
COPY console/*.py console/*.html ./console/
COPY ui/mock ./ui/mock
COPY ui/app ./ui/app

# Rewritten on every sync by .github/workflows/sync-from-monorepo.yml.
ENV GIT_SHA=423deb17653597eb12609f337d91378e576a365a BUILT_AT=2026-10-26T00:33:57Z

# 8080 is the only port Coolify's healthcheck targets. Runs on the stand-ins:
# no Zetaris or Meterless credentials, so no secrets reach this image.
ENV AGENTS_HOST=0.0.0.0 \
    AGENTS_PORT=8080 \
    CHECKPOINTER=memory \
    FF_JUDGE=true \
    PYTHONUNBUFFERED=1

EXPOSE 8080
CMD ["python", "-m", "console"]
