"""The console's own pages, and the honesty of what they print.

GAMEPLAN "Caching and the honest demo": a cached or replayed answer is never
presented as live. These tests came out of the monorepo's agents/tests when the
pages moved here, because the routes they exercise are this repository's.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "agents"))
sys.path.insert(0, str(_ROOT))
os.environ.setdefault("CHECKPOINTER", "memory")
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console.app as pages  # noqa: E402
from floodsense_agents import __main__ as service  # noqa: E402
from floodsense_agents.graph import build_graph  # noqa: E402
from floodsense_agents.nightshift import FakeNightshift  # noqa: E402
from floodsense_agents.runtime import Runtime  # noqa: E402
from floodsense_agents.state import Deps, NoMemory  # noqa: E402
from floodsense_agents.zetaris import FakeZetaris  # noqa: E402


class PagesTest(unittest.TestCase):
    def setUp(self) -> None:
        deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        service.set_runtime(Runtime(graph=build_graph(deps), deps=deps))
        self.c = TestClient(service.app)

    def test_the_desk_is_served_at_the_root(self) -> None:
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/html", r.headers["content-type"])
        self.assertIn("FloodSense EU", r.text)

    def test_mock_serves_both_views_and_their_data(self) -> None:
        bare = self.c.get("/mock", follow_redirects=False)
        self.assertEqual(bare.status_code, 308)
        self.assertEqual(bare.headers["location"], "/mock/")

        plain = self.c.get("/mock/")
        self.assertEqual(plain.status_code, 200)
        self.assertIn("text/html", plain.headers["content-type"])
        self.assertIn("Analyst view", plain.text)

        analyst = self.c.get("/mock/analyst")
        self.assertEqual(analyst.status_code, 200)
        self.assertIn("Plain view", analyst.text)

        data = self.c.get("/mock/data.js")
        self.assertEqual(data.status_code, 200)
        self.assertIn("javascript", data.headers["content-type"])

    def test_mock_serves_nothing_outside_its_own_folder(self) -> None:
        self.assertEqual(self.c.get("/mock/console.html").status_code, 404)
        for name in ("..", "../console.html", "..\\console.html"):
            with self.assertRaises(HTTPException) as caught:
                pages._mock_page(name)
            self.assertEqual(caught.exception.status_code, 404)


class LabelOverTheApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        service.set_runtime(Runtime(graph=build_graph(self.deps), deps=self.deps))
        self.c = TestClient(service.app)

    def test_every_response_carries_a_label(self) -> None:
        for path in ("/health", "/config", "/readiness", "/desk/events"):
            body = self.c.get(path).json()
            self.assertIn("label", body, path)
            self.assertIn("served_from", body, path)

    def test_a_run_on_the_stand_ins_is_never_called_live(self) -> None:
        run = self.c.get("/desk/events/EMSR773").json()["run"]
        self.assertFalse(run["label"]["live"])
        self.assertEqual(run["label"]["kind"], "replay")

    def test_the_same_run_served_again_still_names_its_provenance(self) -> None:
        first = self.c.get("/desk/events/EMSR773").json()["run"]
        again = self.c.get("/desk/events/EMSR773").json()["run"]
        self.assertEqual(again["run_id"], first["run_id"])
        # Nothing computed earlier may be served as fresh, whichever path
        # produced it. labelling.data_plane_is_live refuses a stand-in by
        # type, so this cannot be driven through a live first read here;
        # agents/tests/test_labelling.py holds that rule itself.
        self.assertFalse(again["label"]["live"])
        self.assertIn(again["label"]["kind"], ("cache", "replay"))
        self.assertIn("not live", again["label"]["text"])
        self.assertIsNotNone(again["cached_at"])

    def test_the_snapshot_record_and_verify_endpoints_agree(self) -> None:
        run_id = self.c.get("/desk/events/EMSR773").json()["run"]["run_id"]
        kinds = set()
        for path in (f"/runs/{run_id}", f"/runs/{run_id}/record", f"/runs/{run_id}/verify"):
            body = self.c.get(path).json()
            self.assertFalse(body["label"]["live"], path)
            kinds.add(body["label"]["kind"])
        # One run, one provenance: three views of it may not disagree about
        # where the answer came from.
        self.assertEqual(len(kinds), 1, kinds)

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

    def test_a_timeline_served_twice_says_the_second_one_came_from_the_cache(self) -> None:
        # The cache is module state, so another test's timeline would make
        # this one's first request the second.
        pages._TIMELINE.clear()
        first = self.c.get("/desk/events/EMSR773/timeline").json()
        self.assertEqual(first["served_from"], "replay")
        again = self.c.get("/desk/events/EMSR773/timeline").json()
        self.assertEqual(again["served_from"], "cache")
        self.assertIsNotNone(again["cached_at"])
        self.assertFalse(again["label"]["live"])


class RouteOwnershipTest(unittest.TestCase):
    """The console's page wins where both layers define one.

    The agents service grew a console of its own, so / and the /desk views
    exist in both. FastAPI answers with the first match, which would make
    import order decide which page a visitor gets. console.app drops the
    service's copy of the paths it owns; this holds that.
    """

    def test_no_path_is_registered_twice(self) -> None:
        from collections import Counter

        from floodsense_agents.__main__ import app

        paths = Counter(
            (r.path, tuple(sorted(getattr(r, "methods", ()) or ())))
            for r in app.router.routes
            if getattr(r, "path", None)
        )
        self.assertEqual([k for k, n in paths.items() if n > 1], [])

    def test_the_console_owns_the_pages_it_names(self) -> None:
        self.assertEqual(self.c.get("/", follow_redirects=False).headers["location"], "/app/")
        for path in pages.OURS:
            self.assertIn(path, [r.path for r in pages.app.router.routes], path)

    def setUp(self) -> None:
        self.c = TestClient(service.app)


if __name__ == "__main__":
    unittest.main()
