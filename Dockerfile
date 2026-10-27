# The engines run TypeScript directly and have no runtime dependencies,
# so the node binary alone is the whole of what they need. Both images
# are bookworm.
FROM node:22.18-bookworm-slim AS node

FROM python:3.12-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node

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

# H-MEM and the World Model, mirrored from the monorepo's engines/.
# vendor/ is the Meterless reference implementation, Apache-2.0, and
# NOTICE travels with it.
COPY engines/package.json engines/NOTICE /engines/
COPY engines/src /engines/src
COPY engines/vendor /engines/vendor
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Rewritten on every sync by .github/workflows/sync-from-monorepo.yml.
ENV GIT_SHA=8e80c592a11ebb1ec2e213520724c483937386d8 BUILT_AT=2026-10-27T05:47:39Z

# 8080 is the only port Coolify's healthcheck targets. Runs on the stand-ins:
# no Zetaris or Meterless credentials, so no secrets reach this image.
ENV AGENTS_HOST=0.0.0.0 \
    AGENTS_PORT=8080 \
    CHECKPOINTER=memory \
    FF_JUDGE=true \
    PYTHONUNBUFFERED=1

# The engines carry no authentication, so they stay on loopback: only
# this container's own console reaches them. .data survives a restart
# but not a rebuild, which is the right lifetime for a demo's memory.
ENV FF_HMEM=true \
    ENGINES_URL=http://127.0.0.1:8300 \
    ENGINES_HOST=127.0.0.1 \
    ENGINES_PORT=8300 \
    ENGINES_DATA_DIR=/engines/.data

EXPOSE 8080
CMD ["/start.sh"]
