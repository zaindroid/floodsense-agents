# floodsense-agents

Deploy mirror for the FloodSense EU agents service. The code is owned in
`GenAI-Open-Agent-Hackathon/Hackathon-Monorepo` under `agents/`; this repo
exists because the platform deploys one repo to one container and reads the
app contract from a repo root.

Nothing here should be edited by hand except the three deploy files.

| path | owner |
|---|---|
| `agents/` | the monorepo, overwritten on every sync |
| `app.yaml`, `Dockerfile`, `.github/workflows/sync-from-monorepo.yml` | this repo |

## Deployed shape

One container, no database, no Redis, no credentials. The graph runs against
the in-process stand-ins (`FakeZetaris`, `FakeNightshift`), which makes the
demo deterministic and keeps the image free of secrets.

- port 8080, the only port the platform's healthcheck targets
- `CHECKPOINTER=memory`, so a paused run dies with the process
- `FF_JUDGE=true`, so the Judge runs

## Endpoints

    GET  /health                  liveness, touches nothing
    GET  /ready                   readiness, 503 unless Zetaris answers
    GET  /version                 source sha and build time
    GET  /config                  flags, lanes, schema
    GET  /openapi.json            the spec
    POST /runs                    runs to the approval interrupt
    POST /runs/{id}/approval      approve | edit | reject, resumes the run
    GET  /runs/{id}/citations     every citation with the evidence behind it
    GET  /runs/{id}/events        SSE trace

A run pauses at `awaiting_approval` and no playbook action is released until a
reviewer approves or edits it.

## Sync

`sync-from-monorepo.yml` runs every 15 minutes and on demand. It copies
`agents/` from the monorepo, stamps the source sha into the `Dockerfile`, and
pushes only when something actually changed. That push is what triggers a
redeploy.

Two repository secrets:

- `MONOREPO_TOKEN`, required, read access to the private monorepo:
  `gh secret set MONOREPO_TOKEN --repo zaindroid/floodsense-agents`
- `DEPLOY_WEBHOOK`, needed for a sync to reach the running container. A push
  to this repo does not redeploy on its own: a test push left the container
  running untouched for four minutes. Use the per-app deploy hook from the
  Coolify dashboard, which is scoped to this one app, rather than a
  platform-wide API token. Without it a sync still lands in git, but the
  container keeps serving the previous code until someone redeploys.

`SOURCE_REF` at the top of the workflow points at the agents feature branch.
Change it to `main` once that pull request is merged.

## Live data and live inference

Both are env changes, no code change.

- live data: `FF_LIVE_DATA=true` plus `ZETARIS_REST_URL` and its credentials,
  which moves the queries off `floodsense_seed` onto `floodsense`
- live inference: the Nightshift client is OpenAI compatible, so
  `METERLESS_BASE_URL` and `METERLESS_API_KEY` can point at any compatible
  gateway. Set `ai: true` in `app.yaml` to have the platform's shared gateway
  injected as `LLM_BASE_URL` / `LLM_API_KEY`.

`agents/.env.example` lists every variable the service reads.

## Local run

    cd agents
    pip install -r requirements.txt
    python -m floodsense_agents        # http://127.0.0.1:8100
    python -m unittest discover -s tests
