"""Agents service. FastAPI on port 8100, unpublished; the API container proxies it.

Routes follow the contract in docs/GAMEPLAN.md §5.5. Every response carries
served_from (live | cache | replay) and cached_at.

GET  /                             review console, one page, served from console.html
GET  /app/                         the duty desk: events, one case, the decision record
GET  /desk/events                  every known event and the case standing on it
GET  /desk/events/{id}             one case; starts it if nobody has
GET  /runs/{id}/outbound           approved messages per exposed site (never sent from here)
GET  /runs/{id}/exposure.csv       exposed policies for the claims system
GET  /runs/{id}/verify             every agent step checked, plus which data path it used
GET  /runs/{id}/record             the decision record: answer, sources, scores, signature
POST /runs/{id}/dispatch           post the decision to DECISION_WEBHOOK, off unless set
GET  /console                      the earlier single-page console
GET  /mock/                        design mock, plain view for a non-specialist (ui/mock)
GET  /mock/analyst                 design mock, analyst view: chain, judge, playbook, decision
GET  /health                       liveness: service, graph, version. Touches nothing.
GET  /ready                        readiness: Zetaris answers a trivial query (503 if not)
GET  /version                      build sha and timestamp
GET  /config                       flags, lanes, schema, checkpointer (no secrets)
GET  /readiness                    the eight foundations checked against the newest run
POST /runs                         RunRequest -> runs until the HITL interrupt; returns the run snapshot (status awaiting_approval)
GET  /runs/past                    runs started by this process, newest first (the checkpointer holds every run's state)
GET  /runs/{id}                    snapshot: contract state + claims, evidence, judge_summary, trace
GET  /runs/{id}/approval           what the reviewer sees (409 unless awaiting approval)
POST /runs/{id}/approval           ApprovalDecision {action: approve|edit|reject, edits?, reviewer_note?, reviewer?} -> resumes the run
GET  /runs/{id}/citations          every citation record of the run plus the evidence and provenance they point at
GET  /runs/{id}/events             SSE: TraceEvent json per `trace` event as they happen, then one `status` event

    python -m floodsense_agents            # host: http://127.0.0.1:8100
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)

from floodsense_agents import __version__
from floodsense_agents import desk, labelling
from floodsense_agents.models import ApprovalDecision, RunRequest
from floodsense_agents.readiness import report as readiness_report
from floodsense_agents.verify import report as verify_report
from floodsense_agents.runtime import NotAwaitingApproval, RunNotFound, Runtime
from floodsense_agents.settings import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = FastAPI(title="FloodSense EU — agents", version=__version__)
CONSOLE = Path(__file__).resolve().parent / "console.html"
# ui/ sits beside the package in the image and two levels up in the repo.
_HERE = Path(__file__).resolve().parent


def _ui(folder: str):
    for p in (_HERE.parent / "ui" / folder, _HERE.parent.parent / "ui" / folder):
        if p.is_dir():
            return p
    return None


APP_DIR = _ui("app")
MOCK_DIR = _ui("mock")
# The desk asks the graph the same thing every time; the operator picks the
# event, not the wording.
_DESK_QUESTION = "Which of our sites are at risk, and why?"
_rt: Runtime | None = None


def runtime() -> Runtime:
    global _rt
    if _rt is None:
        _rt = Runtime()
    return _rt


def set_runtime(rt: Runtime) -> None:
    global _rt
    _rt = rt


def _live(body: dict) -> dict:
    return labelling.labelled(body)


def _stored(run_id: str) -> dict:
    """A snapshot of a run computed earlier. Serving it as live would be a lie."""
    rt = runtime()
    run = rt.snapshot(run_id)
    row = next((r for r in rt.past() if r["run_id"] == run_id), None)
    if row and run.get("served_from") == labelling.LIVE:
        run["served_from"] = labelling.CACHE
        run["cached_at"] = row.get("created_at")
    return run


_TYPES = {".js": "text/javascript", ".css": "text/css", ".json": "application/json"}
# A CDN in front of this will happily serve a stale bundle for hours. Pages are
# never cached; assets are, but only under a URL that carries the build sha.
_ASSET_REF = re.compile(r'(src|href)="(?!https?:|//)([^"]+\.(?:js|css))"')


def _resolve(root, name: str):
    if root is None:
        raise HTTPException(404, "this page was not copied into the build")
    path = (root / name).resolve()
    # Direct children only. {name} never contains a slash, but ".." would.
    if path.parent != root.resolve() or not path.is_file():
        raise HTTPException(404, f"no file named {name}")
    return path


def _static(root, name: str, versioned: bool = False) -> FileResponse:
    path = _resolve(root, name)
    if path.suffix in ("", ".html"):
        return _page(root, name)
    return FileResponse(
        path,
        media_type=_TYPES.get(path.suffix, "text/html"),
        headers={
            "cache-control": "public, max-age=31536000, immutable"
            if versioned
            else "no-cache, must-revalidate"
        },
    )


def _page(root, name: str) -> HTMLResponse:
    """An HTML page, with its own assets pinned to this build."""
    path = _resolve(root, name)
    sha = (settings.git_sha or "dev")[:12]
    pinned = r'\1="\2?v=' + sha + '"'
    html = _ASSET_REF.sub(pinned, path.read_text(encoding="utf-8"))
    return HTMLResponse(html, headers={"cache-control": "no-store, must-revalidate"})


def _mock_page(name: str) -> FileResponse:
    return _static(MOCK_DIR, name)


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/app/", status_code=308)


@app.get("/console", include_in_schema=False)
def console():
    return _page(CONSOLE.parent, CONSOLE.name)


@app.get("/app", include_in_schema=False)
def app_bare():
    return RedirectResponse("/app/", status_code=308)


@app.get("/app/", include_in_schema=False)
def app_index():
    return _static(APP_DIR, "index.html")


@app.get("/app/{name}", include_in_schema=False)
def app_asset(name: str, v: str | None = None):
    return _static(APP_DIR, name, versioned=bool(v))


@app.get("/desk/events", include_in_schema=False)
def desk_events():
    """What the desk opens on: every known event, and the case on it."""
    return _live({"events": desk.events(runtime().past())})


@app.get("/desk/events/{event_id}", include_in_schema=False)
def desk_event(event_id: str):
    """The case for one event. Starts it if nobody has yet."""
    rt = runtime()
    row = next((r for r in rt.past() if r.get("event_id") == event_id), None)
    if row is not None:
        run = _stored(row["run_id"])
    else:
        try:
            run = rt.start(RunRequest(question=_DESK_QUESTION, event_id=event_id))
        except KeyError as e:
            raise HTTPException(400, str(e).strip('"')) from e
    run = labelling.labelled(run)
    return _live({"run": run, "figures": desk.summarise(run), "released": desk.is_released(run)})


@app.get("/desk/dispatch-target", include_in_schema=False)
def desk_dispatch_target():
    target = desk.webhook_target()
    return _live({"configured": bool(target), "target": target})


def _released_run(run_id: str) -> dict:
    run = _stored(run_id)
    if not desk.is_released(run):
        raise HTTPException(409, "nothing is released until a reviewer approves or edits")
    return run


@app.get("/runs/{run_id}/outbound", include_in_schema=False)
def run_outbound(run_id: str):
    """The messages, rendered. This endpoint does not send them."""
    return _live({"messages": desk.outbound(_released_run(run_id))})


@app.get("/runs/{run_id}/exposure.csv", include_in_schema=False)
def run_exposure_csv(run_id: str):
    return PlainTextResponse(
        desk.exposure_csv(_released_run(run_id)),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="exposure-{run_id}.csv"'},
    )


@app.get("/runs/{run_id}/verify", include_in_schema=False)
def run_verify(run_id: str):
    """Every agent step, checked against the run's own record."""
    return _live(verify_report(_stored(run_id)))


@app.get("/runs/{run_id}/record", include_in_schema=False)
def run_record(run_id: str):
    return _live(desk.record(_stored(run_id)))


@app.post("/runs/{run_id}/dispatch", include_in_schema=False)
def run_dispatch(run_id: str):
    """Post the decision to the nominated endpoint. Off unless one is set."""
    return _live(desk.dispatch(_released_run(run_id)))


@app.get("/readiness", include_in_schema=False)
def readiness(run_id: str | None = None):
    """The eight foundations, checked against one run. Newest run by default."""
    rt = runtime()
    if run_id is None:
        past = rt.past(limit=1)
        run_id = past[0]["run_id"] if past else None
    run = _stored(run_id) if run_id else {}
    routes = {getattr(r, "path", "") for r in app.routes}
    return _live(readiness_report(run, rt.deps, routes))


@app.get("/mock", include_in_schema=False)
def mock():
    # The pages link to each other and to data.js by relative path, so the
    # browser needs the trailing slash or they resolve against the site root.
    return RedirectResponse("/mock/", status_code=308)


@app.get("/mock/", include_in_schema=False)
def mock_index():
    return _mock_page("index.html")


@app.get("/mock/analyst", include_in_schema=False)
def mock_analyst():
    return _mock_page("analyst.html")


@app.get("/mock/{name}", include_in_schema=False)
def mock_asset(name: str, v: str | None = None):
    return _static(MOCK_DIR, name, versioned=bool(v))


def _dep_name(rt: Runtime, attr: str) -> str:
    return type(getattr(rt.deps, attr, None)).__name__ if rt.deps else "injected"


@app.get("/health")
def health():
    # Liveness only. A slow probe here marks every app on the node unhealthy.
    return _live(
        {
            "status": "ok",
            "service": "floodsense-agents",
            "graph": "compiled",
            "version": __version__,
        }
    )


@app.get("/ready")
def ready():
    rt = runtime()
    try:
        rt.deps.zetaris.run_sql("SELECT 1")
    except Exception as e:
        raise HTTPException(503, f"zetaris unreachable: {type(e).__name__}")
    return _live(
        {
            "status": "ready",
            "llm": _dep_name(rt, "llm"),
            "zetaris": _dep_name(rt, "zetaris"),
        }
    )


@app.get("/version")
def version():
    return _live({"sha": settings.git_sha, "built": settings.built_at, "version": __version__})


@app.get("/config")
def config():
    return _live(
        {
            "flags": {
                "FF_LIVE_DATA": settings.live_data,
                "FF_SKEPTIC": settings.ff_skeptic,
                "FF_JUDGE": settings.ff_judge,
                "FF_HITL": settings.ff_hitl,
                "FF_HMEM": settings.ff_hmem,
                "FF_RAG_DOCS": settings.ff_rag_docs,
            },
            "lanes": {"fast": settings.model_fast, "deep": settings.model_deep},
            "schema": settings.schema,
            "checkpointer": settings.checkpointer,
            "skeptic_max_rounds": settings.skeptic_max_rounds,
            "judge_repair_rounds": settings.judge_repair_rounds,
            "judge_min_score": settings.judge_min_score,
            "events": ["EMSR773", "EMSR517"],
        }
    )


@app.post("/runs", status_code=201)
def start_run(req: RunRequest):
    try:
        return _live(runtime().start(req))
    except KeyError as e:
        raise HTTPException(422, str(e))


@app.get("/runs/past")
def past_runs(limit: int = 50):
    return _live({"runs": runtime().past(limit)})


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        return _live(_stored(run_id))
    except RunNotFound:
        raise HTTPException(404, f"run {run_id} not found")


@app.get("/runs/{run_id}/approval")
def get_approval(run_id: str):
    try:
        return _live(runtime().approval(run_id))
    except RunNotFound:
        raise HTTPException(404, f"run {run_id} not found")
    except NotAwaitingApproval as e:
        raise HTTPException(409, str(e))


@app.post("/runs/{run_id}/approval")
def post_approval(run_id: str, decision: ApprovalDecision):
    if decision.action == "edit" and not (decision.edits or "").strip():
        raise HTTPException(422, "action=edit requires edits")
    try:
        return _live(runtime().resume(run_id, decision))
    except RunNotFound:
        raise HTTPException(404, f"run {run_id} not found")
    except NotAwaitingApproval as e:
        raise HTTPException(409, str(e))


@app.get("/runs/{run_id}/citations")
def get_citations(run_id: str):
    try:
        return _live(runtime().citations(run_id))
    except RunNotFound:
        raise HTTPException(404, f"run {run_id} not found")


@app.get("/runs/{run_id}/events")
async def events(run_id: str):
    rt = runtime()
    try:
        rt.snapshot(run_id)
    except RunNotFound:
        raise HTTPException(404, f"run {run_id} not found")

    async def gen():
        sent, t0 = 0, time.time()
        while time.time() - t0 < 900:
            s = rt.snapshot(run_id)
            for ev in s["trace"][sent:]:
                yield f"event: trace\ndata: {json.dumps(ev)}\n\n"
            sent = len(s["trace"])
            if s["status"] != "running":
                done = {
                    "run_id": run_id,
                    "status": s["status"],
                    "served_from": s["served_from"],
                    "cached_at": s["cached_at"],
                }
                yield f"event: status\ndata: {json.dumps(done)}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
