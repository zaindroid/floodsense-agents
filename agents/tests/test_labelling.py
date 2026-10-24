"""Cached and replayed answers are never presented as live.

GAMEPLAN "Caching and the honest demo". The wording lives in the service so
that this console, the team's console and the video all say the same thing.
"""

from __future__ import annotations

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
from floodsense_agents import labelling  # noqa: E402
from floodsense_agents.graph import build_graph  # noqa: E402
from floodsense_agents.nightshift import FakeNightshift  # noqa: E402
from floodsense_agents.runtime import Runtime  # noqa: E402
from floodsense_agents.state import Deps, NoMemory  # noqa: E402
from floodsense_agents.zetaris import FakeZetaris  # noqa: E402


class LabelTest(unittest.TestCase):
    def test_a_live_answer_carries_no_banner(self) -> None:
        got = labelling.label("live", None, "r1")
        self.assertTrue(got["live"])
        self.assertIsNone(got["text"])

    def test_a_cached_answer_says_so_with_the_time_and_the_run(self) -> None:
        got = labelling.label("cache", "2026-10-24T14:32:51Z", "R-123")
        self.assertFalse(got["live"])
        self.assertEqual(got["at"], "14:32")
        self.assertEqual(got["text"], "Cached answer from 14:32 · not live · original run R-123")

    def test_a_replay_says_it_is_a_replay(self) -> None:
        got = labelling.label("replay", "2026-10-24T09:05:00Z", "R-9")
        self.assertFalse(got["live"])
        self.assertIn("Replay of a recorded run from 09:05", got["text"])
        self.assertIn("not live", got["text"])

    def test_a_missing_timestamp_still_refuses_to_claim_live(self) -> None:
        got = labelling.label("cache", None, None)
        self.assertFalse(got["live"])
        self.assertEqual(got["text"], "Cached answer · not live")

    def test_anything_unrecognised_is_not_called_live(self) -> None:
        for value in (None, "", "fresh", "LIVE", "true"):
            got = labelling.label(value, None, None)
            self.assertFalse(got["live"], value)
            self.assertIn("not live", got["text"])

    def test_a_malformed_timestamp_is_dropped_rather_than_printed(self) -> None:
        got = labelling.label("cache", "yesterday", "R-1")
        self.assertIsNone(got["at"])
        self.assertNotIn("yesterday", got["text"])


class LabelOverTheApiTest(unittest.TestCase):
    def setUp(self) -> None:
        deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        service.set_runtime(Runtime(graph=build_graph(deps), deps=deps))
        self.c = TestClient(service.app)

    def test_every_response_carries_a_label(self) -> None:
        for path in ("/health", "/config", "/readiness", "/desk/events"):
            body = self.c.get(path).json()
            self.assertIn("label", body, path)
            self.assertIn("served_from", body, path)

    def test_a_freshly_computed_run_is_live_and_a_re_read_is_not(self) -> None:
        first = self.c.get("/desk/events/EMSR773").json()["run"]
        self.assertTrue(first["label"]["live"])
        self.assertIsNone(first["label"]["text"])

        # The same answer served again was computed earlier. Saying "live"
        # here is exactly what the rule forbids.
        again = self.c.get("/desk/events/EMSR773").json()["run"]
        self.assertEqual(again["run_id"], first["run_id"])
        self.assertFalse(again["label"]["live"])
        self.assertEqual(again["label"]["kind"], "cache")
        self.assertIn("not live", again["label"]["text"])
        self.assertIn(again["run_id"], again["label"]["text"])

    def test_the_snapshot_record_and_verify_endpoints_agree(self) -> None:
        run_id = self.c.get("/desk/events/EMSR773").json()["run"]["run_id"]
        for path in (f"/runs/{run_id}", f"/runs/{run_id}/record", f"/runs/{run_id}/verify"):
            body = self.c.get(path).json()
            self.assertFalse(body["label"]["live"], path)
            self.assertEqual(body["label"]["kind"], "cache", path)

    def test_the_decision_record_carries_its_own_provenance(self) -> None:
        run_id = self.c.get("/desk/events/EMSR773").json()["run"]["run_id"]
        rec = self.c.get(f"/runs/{run_id}/record").json()
        self.assertIn(rec["served_from"], ("live", "cache", "replay"))
        self.assertIsNotNone(rec["cached_at"])

    def test_the_console_renders_the_banner_only_when_it_is_not_live(self) -> None:
        app_js = self.c.get("/app/app.js").text
        self.assertIn("label.live === false", app_js)
        self.assertIn('class="stale"', app_js)
        # The wording is never assembled in the browser.
        self.assertNotIn("Cached answer from", app_js)


if __name__ == "__main__":
    unittest.main()
