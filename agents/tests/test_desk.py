"""The desk: events in, a decision, artifacts out.

The gate matters most. Nothing an approval produces may exist before the
approval, and dispatch must stay inert until an operator nominates a target.
"""

from __future__ import annotations

import csv
import io
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CHECKPOINTER", "memory")
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from fastapi.testclient import TestClient  # noqa: E402

from floodsense_agents import __main__ as service  # noqa: E402
from floodsense_agents import desk  # noqa: E402
from floodsense_agents.graph import build_graph  # noqa: E402
from floodsense_agents.nightshift import FakeNightshift  # noqa: E402
from floodsense_agents.runtime import Runtime  # noqa: E402
from floodsense_agents.state import Deps, NoMemory  # noqa: E402
from floodsense_agents.zetaris import FakeZetaris  # noqa: E402


class DeskTest(unittest.TestCase):
    def setUp(self) -> None:
        deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        service.set_runtime(Runtime(graph=build_graph(deps), deps=deps))
        self.c = TestClient(service.app)
        os.environ.pop(desk.WEBHOOK_ENV, None)

    def tearDown(self) -> None:
        os.environ.pop(desk.WEBHOOK_ENV, None)

    def open_case(self, event_id: str = "EMSR773") -> dict:
        return self.c.get(f"/desk/events/{event_id}").json()

    def approve(self, run_id: str) -> None:
        r = self.c.post(f"/runs/{run_id}/approval", json={"action": "approve", "reviewer": "zain"})
        self.assertEqual(r.status_code, 200)

    # --- the desk opens on events, not runs ----------------------------

    def test_the_desk_lists_known_events_before_any_case_exists(self) -> None:
        events = self.c.get("/desk/events").json()["events"]
        self.assertEqual([e["event_id"] for e in events], ["EMSR773", "EMSR517"])
        self.assertTrue(all(e["run_id"] is None for e in events))
        self.assertTrue(all(e["name"] and e["region"] for e in events))

    def test_opening_an_event_starts_its_case_once(self) -> None:
        first = self.open_case()
        self.assertEqual(first["run"]["status"], "awaiting_approval")
        self.assertEqual(first["figures"]["policies"], 7)
        self.assertFalse(first["released"])
        again = self.open_case()
        self.assertEqual(again["run"]["run_id"], first["run"]["run_id"])

    def test_the_desk_then_shows_the_case_as_waiting(self) -> None:
        self.open_case()
        events = {e["event_id"]: e for e in self.c.get("/desk/events").json()["events"]}
        self.assertEqual(events["EMSR773"]["approval"], "awaiting")
        self.assertIsNone(events["EMSR517"]["run_id"])

    def test_an_unknown_event_is_refused_rather_than_invented(self) -> None:
        self.assertEqual(self.c.get("/desk/events/EMSR999").status_code, 400)

    # --- the gate --------------------------------------------------------

    def test_no_artifact_exists_before_the_decision(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        for path in ("/outbound", "/exposure.csv"):
            r = self.c.get(f"/runs/{run_id}{path}")
            self.assertEqual(r.status_code, 409, path)
        self.assertEqual(self.c.post(f"/runs/{run_id}/dispatch").status_code, 409)

    def test_rejecting_keeps_the_artifacts_shut(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.c.post(f"/runs/{run_id}/approval", json={"action": "reject", "reviewer": "zain"})
        self.assertEqual(self.c.get(f"/runs/{run_id}/outbound").status_code, 409)

    # --- what an approval produces ----------------------------------------

    def test_approving_produces_one_message_per_exposed_site(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.approve(run_id)
        msgs = self.c.get(f"/runs/{run_id}/outbound").json()["messages"]
        self.assertEqual(len(msgs), 7)
        # Largest sum insured first, so the biggest exposure is contacted first.
        self.assertEqual(msgs[0]["policy_id"], "P-1003")
        self.assertEqual(
            [m["sum_insured_eur"] for m in msgs],
            sorted([m["sum_insured_eur"] for m in msgs], reverse=True),
        )
        # The wording is the approved action text, not a paraphrase of it.
        run = self.c.get(f"/runs/{run_id}").json()
        approved = [a["text"] for a in run["playbook"] if a["outbound"] and a["released"]]
        self.assertTrue(approved)
        for text in approved:
            self.assertIn(text, msgs[0]["body"])

    def test_the_csv_carries_the_policies_and_the_signature(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.approve(run_id)
        r = self.c.get(f"/runs/{run_id}/exposure.csv")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers["content-type"])
        self.assertIn("attachment", r.headers["content-disposition"])
        rows = list(csv.DictReader(io.StringIO(r.text)))
        self.assertEqual(len(rows), 7)
        self.assertEqual({row["decided_by"] for row in rows}, {"zain"})
        self.assertEqual({row["in_footprint"] for row in rows}, {"1"})
        self.assertEqual(sum(float(row["sum_insured_eur"]) for row in rows), 21_600_000)

    def test_the_record_stands_on_its_own(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.approve(run_id)
        rec = self.c.get(f"/runs/{run_id}/record").json()
        self.assertEqual(rec["approval"]["reviewer"], "zain")
        self.assertEqual(len(rec["claims"]), 10)
        self.assertTrue(rec["sources"])
        self.assertTrue(any("to confirm" in (s["licence"] or "") for s in rec["sources"]))
        self.assertEqual(rec["figures"]["policies"], 7)
        self.assertTrue(rec["definitions"])

    def test_the_record_is_readable_before_a_decision_too(self) -> None:
        # Audit may need to see a case that was never approved.
        run_id = self.open_case()["run"]["run_id"]
        rec = self.c.get(f"/runs/{run_id}/record").json()
        self.assertEqual(rec["approval"]["status"], "awaiting")

    # --- dispatch stays off until someone nominates a target ---------------

    def test_dispatch_is_off_by_default_and_says_what_it_would_send(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.approve(run_id)
        out = self.c.post(f"/runs/{run_id}/dispatch").json()
        self.assertFalse(out["sent"])
        self.assertIn("no endpoint nominated", out["reason"])
        self.assertEqual(out["payload"]["reviewer"], "zain")
        self.assertEqual(len(out["payload"]["policies"]), 7)

    def test_dispatch_refuses_a_target_that_is_not_https(self) -> None:
        run_id = self.open_case()["run"]["run_id"]
        self.approve(run_id)
        os.environ[desk.WEBHOOK_ENV] = "http://example.invalid/hook"
        out = self.c.post(f"/runs/{run_id}/dispatch").json()
        self.assertFalse(out["sent"])
        self.assertIn("https", out["reason"])

    def test_the_app_reports_whether_a_target_is_set(self) -> None:
        self.assertFalse(self.c.get("/desk/dispatch-target").json()["configured"])
        os.environ[desk.WEBHOOK_ENV] = "https://example.invalid/hook"
        body = self.c.get("/desk/dispatch-target").json()
        self.assertTrue(body["configured"])
        self.assertEqual(body["target"], "https://example.invalid/hook")

    # --- the app is the front door -----------------------------------------

    def test_the_root_now_leads_to_the_app(self) -> None:
        r = self.c.get("/", follow_redirects=False)
        self.assertEqual(r.status_code, 308)
        self.assertEqual(r.headers["location"], "/app/")
        self.assertEqual(self.c.get("/app/").status_code, 200)
        self.assertIn("FloodSense EU", self.c.get("/app/").text)

    def test_the_app_assets_are_served_and_scoped(self) -> None:
        for name, kind in (("app.js", "javascript"), ("app.css", "css")):
            r = self.c.get(f"/app/{name}")
            self.assertEqual(r.status_code, 200, name)
            self.assertIn(kind, r.headers["content-type"])
        self.assertEqual(self.c.get("/app/console.html").status_code, 404)

    def test_the_earlier_pages_keep_their_own_urls(self) -> None:
        self.assertEqual(self.c.get("/console").status_code, 200)
        self.assertEqual(self.c.get("/mock/").status_code, 200)
        self.assertEqual(self.c.get("/mock/analyst").status_code, 200)


if __name__ == "__main__":
    unittest.main()
