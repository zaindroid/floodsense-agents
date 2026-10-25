"""The FloodSense console: the duty desk, the design mocks, the audit views.

This layer is ours and lives only in this repository. The review on monorepo
PR #4 asked the agents service to be the graph's API and nothing else, so the
pages moved here rather than into agents/. It imports that service and hangs
the console's routes on the same app, so there is still one container and one
port.

GET  /                          redirects to the desk
GET  /app/                      the duty desk: events, one case, the decision record
GET  /console                   the earlier single-page console
GET  /desk/events               every known event and the case standing on it
GET  /desk/events/{id}          one case; starts it if nobody has
GET  /desk/events/{id}/timeline the same question asked at each declared moment
GET  /desk/dispatch-target      whether a decision endpoint is configured
GET  /runs/{id}/outbound        approved messages per exposed site (never sent from here)
GET  /runs/{id}/exposure.csv    exposed policies for the claims system
GET  /runs/{id}/verify          every agent step checked, and which data path it used
GET  /runs/{id}/record          the decision record: answer, sources, scores, signature
POST /runs/{id}/dispatch        post the decision to DECISION_WEBHOOK, off unless set
GET  /readiness                 the eight foundations checked against the newest run
GET  /mock/                     design mock, plain view for a non-specialist
GET  /mock/analyst              design mock, analyst view
GET  /pipeline/                 the pipeline view: the graph drawn, animated as a run happens
POST /pipeline/runs             start a run on a worker thread, answer with its launch id
GET  /pipeline/events           SSE: that launch's steps, queries and model calls as they land
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)

from floodsense_agents import labelling
from floodsense_agents.__main__ import app, runtime
from floodsense_agents.events import spec
from floodsense_agents.models import RunRequest
from floodsense_agents.readiness import report as readiness_report
from floodsense_agents.settings import settings

from console import desk, live
from console.verify import report as verify_report

HERE = Path(__file__).resolve().parent
CONSOLE = HERE / "console.html"
PIPELINE = HERE / "pipeline.html"


def _ui(folder: str):
    """ui/ sits beside this package, in the image and in the checkout alike."""
    p = HERE.parent / "ui" / folder
    return p if p.is_dir() else None


APP_DIR = _ui("app")
MOCK_DIR = _ui("mock")
# The desk asks the graph the same thing every time; the operator picks the
# event, not the wording.
_DESK_QUESTION = desk.DESK_QUESTION


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


def _build() -> str:
    return (settings.git_sha or "dev")[:12]


def _static(root, name: str, version: str | None = None) -> FileResponse:
    path = _resolve(root, name)
    if path.suffix in ("", ".html"):
        return _page(root, name)
    if version and version != _build():
        # Another build's URL. During a rollout both containers answer, and
        # serving this one's file would let a CDN pin the wrong bytes under
        # the new name, immutably. A miss is cheap; a poisoned cache is not.
        raise HTTPException(404, f"asset {name} is not from build {version}")
    return FileResponse(
        path,
        media_type=_TYPES.get(path.suffix, "text/html"),
        headers={
            "cache-control": "public, max-age=31536000, immutable"
            if version
            else "no-cache, must-revalidate"
        },
    )


def _page(root, name: str) -> HTMLResponse:
    """An HTML page, with its own assets pinned to this build."""
    path = _resolve(root, name)
    sha = _build()
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
    return _static(APP_DIR, name, version=v)


@app.get("/desk/events", include_in_schema=False)
def desk_events():
    """What the desk opens on: every known event, and the case on it."""
    return _live({"events": desk.events(runtime().past())})


@app.get("/desk/events/{event_id}", include_in_schema=False)
def desk_event(event_id: str):
    """The case for one event. Starts it if nobody has yet."""
    rt = runtime()
    row = next(
        (r for r in rt.past() if r.get("event_id") == event_id and desk.is_case(r)),
        None,
    )
    if row is not None:
        run = _stored(row["run_id"])
    else:
        try:
            run = rt.start(RunRequest(question=_DESK_QUESTION, event_id=event_id))
        except KeyError as e:
            raise HTTPException(400, str(e).strip('"')) from e
    run = labelling.labelled(run)
    return _live({"run": run, "figures": desk.summarise(run), "released": desk.is_released(run)})


_TIMELINE: dict[str, dict] = {}


@app.get("/desk/events/{event_id}/timeline", include_in_schema=False)
def desk_timeline(event_id: str):
    """The same question asked at each declared moment of the event.

    What was knowable when: the chain fills in, the footprint appears only
    once Copernicus published it, and the gauge going out is visible as the
    reading that stops rather than as a gap nobody mentions.
    """
    if event_id in _TIMELINE:
        # Built by an earlier request, so it says cache rather than live.
        body = dict(_TIMELINE[event_id])
        body["served_from"] = labelling.CACHE
        return _live(body)
    try:
        ev = spec(event_id)
    except KeyError as e:
        raise HTTPException(400, str(e).strip('"')) from e
    rt = runtime()
    points = []
    for ts, label in ev.moments:
        try:
            run = rt.start(RunRequest(question=_DESK_QUESTION, event_id=event_id, replay_ts=ts))
            point = desk.moment(run)
        except Exception as e:  # noqa: BLE001 - one bad moment must not lose the rest
            point = {"replay_ts": ts, "error": f"{type(e).__name__}: {e}"[:160]}
        point["label"] = label
        points.append(point)
    body = {
        "event_id": event_id,
        "name": ev.name,
        "footprint_published_utc": ev.footprint_published_utc,
        "moments": points,
        "cached_at": desk.now_utc(),
    }
    _TIMELINE[event_id] = body
    return _live(dict(body))


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
    return _static(MOCK_DIR, name, version=v)


@app.get("/pipeline", include_in_schema=False)
def pipeline_bare():
    return RedirectResponse("/pipeline/", status_code=308)


@app.get("/pipeline/", include_in_schema=False)
def pipeline_page():
    return _page(PIPELINE.parent, PIPELINE.name)


@app.post("/pipeline/runs", include_in_schema=False)
def pipeline_start(body: dict | None = None):
    """Start a run and answer at once, so the page can watch it happen."""
    body = body or {}
    event_id = (body.get("event_id") or "EMSR773").strip()
    try:
        spec(event_id)
    except KeyError as e:
        raise HTTPException(400, str(e).strip('"')) from e
    req = RunRequest(
        question=(body.get("question") or _DESK_QUESTION).strip(),
        event_id=event_id,
        replay_ts=body.get("replay_ts"),
    )
    record, fresh = live.launch(req)
    return _live(
        {
            "launch_id": record["launch_id"],
            "run_id": record["run_id"],
            "status": record["status"],
            "event_id": record["event_id"],
            "question": record["question"],
            "started": fresh,
        }
    )


@app.get("/pipeline/events", include_in_schema=False)
def pipeline_events(launch: str):
    """One launch's events as they land.

    The stream is paced by the run, not by a timer: each poll sends whatever
    the graph has written since the last one. A comment line every 15 seconds
    keeps proxies from closing a quiet connection, and X-Accel-Buffering tells
    the ones that would otherwise hold the body back not to.
    """
    if live.get(launch) is None:
        raise HTTPException(404, f"no launch {launch}")

    async def gen():
        yield "retry: 2000\n\n"
        quiet = 0.0
        for event in live.events(launch):
            if event is None:
                await asyncio.sleep(live.POLL_S)
                quiet += live.POLL_S
                if quiet >= 15:
                    quiet = 0.0
                    yield ": ping\n\n"
                continue
            quiet = 0.0
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
