"""The pipeline view: a run watched while it happens.

The events are driven through console.live directly rather than over SSE. The
route is a thin wrapper around this generator, and a test that holds an open
stream would hang the suite the first time a run did not end.
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "agents"))
sys.path.insert(0, str(_ROOT))
os.environ.setdefault("CHECKPOINTER", "memory")
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from fastapi.testclient import TestClient  # noqa: E402

import console.app  # noqa: F401,E402 - importing it registers the routes
from console import live  # noqa: E402
from floodsense_agents.__main__ import app  # noqa: E402
from floodsense_agents.models import RunRequest  # noqa: E402


def drain(launch_id: str, limit: float = 60.0) -> list[dict]:
    """Every event of a launch. None means nothing new yet, so wait a little."""
    out: list[dict] = []
    deadline = time.time() + limit
    for event in live.events(launch_id):
        if event is None:
            if time.time() > deadline:
                raise AssertionError(f"launch {launch_id} never finished")
            time.sleep(live.POLL_S)
            continue
        out.append(event)
    return out


class PipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.c = TestClient(app)

    def test_the_page_draws_the_stages_the_graph_has(self) -> None:
        r = self.c.get("/pipeline/")
        self.assertEqual(r.status_code, 200)
        for stage in ("scope", "watchers", "investigator", "skeptic", "exposure", "playbook"):
            self.assertIn(stage, r.text, stage)
        # A page that is cached is a page showing yesterday's run.
        self.assertIn("no-store", r.headers.get("cache-control", ""))

    def test_the_sources_come_from_the_provenance_view(self) -> None:
        # The band on the page is what the warehouse declares, so a dataset
        # struck out for an unclear licence disappears from the drawing
        # without anyone editing it.
        body = self.c.get("/pipeline/sources").json()
        self.assertTrue(body["query_id"], "a source list with no query behind it is a claim")
        self.assertIn("provenance", body["view"])
        self.assertTrue(body["sources"])
        for row in body["sources"]:
            self.assertIn("dataset", row)
            self.assertIn("publisher", row)
            self.assertIn("licence", row)

    def test_the_page_names_the_stack_it_runs_on(self) -> None:
        page = self.c.get("/pipeline/").text
        self.assertIn("Meterless Nightshift", page)
        self.assertIn("Zetaris", page)

    def test_a_launch_answers_before_the_run_finishes(self) -> None:
        r = self.c.post("/pipeline/runs", json={"event_id": "EMSR773"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["launch_id"])
        self.assertTrue(body["started"])
        # The point of the launch: an id now, not a finished run now.
        self.assertEqual(body["status"], "running")
        drain(body["launch_id"])

    def test_an_unknown_event_is_refused_rather_than_launched(self) -> None:
        self.assertEqual(self.c.post("/pipeline/runs", json={"event_id": "EMSR999"}).status_code, 400)

    def test_the_stream_reports_the_run_it_actually_ran(self) -> None:
        launch = live.launch(RunRequest(question="Which sites are exposed?", event_id="EMSR773"))[0]
        events = drain(launch["launch_id"])
        kinds = [e["type"] for e in events]
        self.assertEqual(kinds[0], "run")
        self.assertEqual(kinds[-1], "done")

        done = events[-1]
        self.assertEqual(done["status"], "awaiting_approval")
        self.assertTrue(done["run_id"])

        steps = [e for e in events if e["type"] == "step"]
        queries = [e for e in events if e["type"] == "query"]
        self.assertEqual(done["steps"], len(steps))
        self.assertEqual(done["queries"], len(queries))

        # Every count the page shows has to come from the run's own record.
        run = self.c.get(f"/runs/{done['run_id']}").json()
        self.assertEqual(len(steps), len(run["trace"]))
        self.assertEqual(len(queries), len(run["evidence"]))
        self.assertEqual([s["agent"] for s in steps], [t["node"] for t in run["trace"]])
        self.assertIn("Hazard scan agent", [s["title"] for s in steps])

    def test_a_second_launch_attaches_rather_than_starting_a_rival_run(self) -> None:
        first = live.launch(RunRequest(question="q", event_id="EMSR773"))
        second = live.launch(RunRequest(question="q", event_id="EMSR773"))
        self.assertTrue(first[1])
        self.assertFalse(second[1], "two runs at once cannot be told apart in the checkpointer")
        self.assertEqual(first[0]["launch_id"], second[0]["launch_id"])
        drain(first[0]["launch_id"])

    def test_the_stream_of_an_unknown_launch_is_a_404(self) -> None:
        self.assertEqual(self.c.get("/pipeline/events?launch=nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
