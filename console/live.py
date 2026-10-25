"""A run watched while it happens, rather than replayed once it is over.

POST /runs answers when the graph has already paused at the approval
interrupt, so a page that opens the trace stream afterwards is animating a
finished run. Nothing is wrong with that, but it cannot show a query taking
900 ms or a skeptic round being spent, because by then both are history.

So the launch happens on a worker thread and the caller gets an id at once.
The events below are read from the run's own state as the graph writes it:
each poll diffs the trace, the evidence map and the model ids against what has
already been sent. Nothing here invents a step, a count or a duration -- the
only number this file produces is the wall clock since the launch, which it
measures itself.

The graph is in agents/, which this repository mirrors and does not change, so
the run id cannot be passed in: runtime.start() makes its own. It is found
instead by diffing the checkpointer's threads against the ones that existed
before the launch, which is why only one launch runs at a time.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any, Iterator

from floodsense_agents.__main__ import runtime
from floodsense_agents.models import RunRequest
from floodsense_agents.readiness import title_of

log = logging.getLogger("floodsense.console.live")

POLL_S = 0.25
# A launch that neither finishes nor fails still has to stop being "in flight".
STALE_S = 1800
_LOCK = threading.Lock()
_LAUNCHES: dict[str, dict[str, Any]] = {}


def _threads() -> set[str]:
    """Every run id the checkpointer knows, plus the ones this process indexed."""
    rt = runtime()
    out = set(rt.index)
    saver = getattr(rt.graph, "checkpointer", None)
    if saver is None or not hasattr(saver, "list"):
        return out
    try:
        for item in saver.list(None):
            config = getattr(item, "config", None) or {}
            thread = config.get("configurable", {}).get("thread_id")
            if thread:
                out.add(thread)
    except Exception as e:  # noqa: BLE001 - a busy checkpointer must not end the stream
        log.debug("listing threads failed: %s", str(e)[:120])
    return out


def in_flight() -> dict[str, Any] | None:
    for launch in _LAUNCHES.values():
        if launch["status"] == "running" and time.time() - launch["started"] < STALE_S:
            return launch
    return None


def get(launch_id: str) -> dict[str, Any] | None:
    return _LAUNCHES.get(launch_id)


def launch(req: RunRequest) -> tuple[dict[str, Any], bool]:
    """Start a run on a worker thread and return its record at once.

    The second value is False when a run was already in flight and the caller
    was attached to it instead: two at once could not be told apart in the
    checkpointer, and one page watching one run is what this view is for.
    """
    with _LOCK:
        running = in_flight()
        if running is not None:
            return running, False
        record: dict[str, Any] = {
            "launch_id": uuid.uuid4().hex[:12],
            "run_id": None,
            "status": "running",
            "question": req.question,
            "event_id": req.event_id,
            "started": time.time(),
            "known": _threads(),
            "error": None,
            "elapsed_ms": None,
        }
        _LAUNCHES[record["launch_id"]] = record

    def work() -> None:
        try:
            snap = runtime().start(req)
            record["run_id"] = snap.get("run_id")
            record["status"] = snap.get("status") or "done"
        except Exception as e:  # noqa: BLE001 - the page has to be told, not the log only
            log.exception("launch %s failed", record["launch_id"])
            record["status"] = "failed"
            record["error"] = f"{type(e).__name__}: {e}"[:300]
        finally:
            record["elapsed_ms"] = int((time.time() - record["started"]) * 1000)

    threading.Thread(target=work, name=f"live-{record['launch_id']}", daemon=True).start()
    return record, True


def _run_id(record: dict[str, Any]) -> str | None:
    """The run the worker is on, found as soon as its first checkpoint lands.

    If something else started a run in the same moment there is no way to tell
    the two apart, so this waits: the worker reports the id when it returns,
    and the stream catches up then rather than animating the wrong run.
    """
    if record["run_id"]:
        return record["run_id"]
    fresh = _threads() - record["known"]
    if len(fresh) == 1:
        record["run_id"] = fresh.pop()
    return record["run_id"]


def _snapshot(run_id: str) -> dict[str, Any] | None:
    try:
        return runtime().snapshot(run_id)
    except Exception as e:  # noqa: BLE001 - mid-write reads fail; the next poll gets it
        log.debug("snapshot %s not readable yet: %s", run_id, str(e)[:120])
        return None


def _query_event(ev: dict[str, Any], at: int) -> dict[str, Any]:
    return {
        "type": "query",
        "t": at,
        "query_id": ev.get("query_id"),
        "view": ev.get("view"),
        "rows": ev.get("row_count"),
        "source": ev.get("source"),
        "error": ev.get("error"),
    }


def _step_event(entry: dict[str, Any], at: int) -> dict[str, Any]:
    node = entry.get("node") or ""
    return {
        "type": "step",
        "t": at,
        "seq": entry.get("seq"),
        "agent": node,
        "title": title_of(node),
        "summary": entry.get("summary"),
        "lane": entry.get("lane"),
        "model_id": entry.get("model_id"),
        "latency_ms": entry.get("latency_ms"),
        "queries": entry.get("evidence_ids") or [],
    }


def events(launch_id: str) -> Iterator[dict[str, Any]]:
    """Every event of one launch, in order, until the run stops running.

    Yields None for "nothing new yet, ask again": the caller owns the pause
    between polls, because this generator is driven from an async route and
    sleeping in here would stop the whole event loop, the stream included.
    """
    record = _LAUNCHES.get(launch_id)
    if record is None:
        yield {"type": "error", "t": 0, "error": f"no launch {launch_id}"}
        return
    started = record["started"]
    yield {
        "type": "run",
        "t": 0,
        "status": "starting",
        "question": record["question"],
        "event_id": record["event_id"],
    }

    sent_steps, sent_queries, sent_models, said_running = 0, set(), 0, False
    while True:
        now = int((time.time() - started) * 1000)
        run_id = _run_id(record)
        snap = _snapshot(run_id) if run_id else None

        if snap is not None:
            if not said_running:
                said_running = True
                yield {
                    "type": "run",
                    "t": now,
                    "status": "running",
                    "run_id": run_id,
                    "served_from": snap.get("served_from"),
                }
            evidence = snap.get("evidence") or {}
            for key, ev in evidence.items():
                if key not in sent_queries:
                    sent_queries.add(key)
                    yield _query_event({"query_id": key, **(ev or {})}, now)
            models = snap.get("model_ids") or []
            for model_id in models[sent_models:]:
                yield {"type": "model", "t": now, "model_id": model_id}
            sent_models = len(models)
            trace = snap.get("trace") or []
            for entry in trace[sent_steps:]:
                yield _step_event(entry, now)
            sent_steps = len(trace)

        if record["status"] != "running":
            # The worker has returned. One more pass above has already drained
            # whatever the last node wrote.
            yield {
                "type": "done",
                "t": int((time.time() - started) * 1000),
                "run_id": record["run_id"],
                "status": record["status"],
                "error": record["error"],
                "elapsed_ms": record["elapsed_ms"],
                "steps": sent_steps,
                "queries": len(sent_queries),
                "models": sent_models,
            }
            return
        if time.time() - started > STALE_S:
            yield {"type": "done", "t": now, "status": "timed_out", "run_id": run_id}
            return
        yield None
