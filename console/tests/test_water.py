"""The two water reads: the gauges now, and the event hour by hour.

Both go round Evidence, which keeps 20 rows, so the thing worth asserting is
that a whole series comes back and that neither statement names its view twice
-- Zetaris resolves a view once per statement and fails the rest.
"""

from __future__ import annotations

import os
import re
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "agents"))
sys.path.insert(0, str(_ROOT))
os.environ.setdefault("CHECKPOINTER", "memory")
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from fastapi.testclient import TestClient  # noqa: E402

from floodsense_agents import __main__ as service  # noqa: E402
import console.app as pages  # noqa: E402 - importing it registers the console's routes
from console import warehouse  # noqa: E402
from floodsense_agents.graph import build_graph  # noqa: E402
from floodsense_agents.nightshift import FakeNightshift  # noqa: E402
from floodsense_agents.runtime import Runtime  # noqa: E402
from floodsense_agents.state import Deps, NoMemory  # noqa: E402
from floodsense_agents.zetaris import FakeZetaris  # noqa: E402

VIEW = re.compile(r"\bfloodsense(?:_seed)?\.(\w+)", re.I)


def named_twice(sql: str) -> set[str]:
    names = VIEW.findall(sql)
    return {n for n in names if names.count(n) > 1}


class WaterTest(unittest.TestCase):
    def setUp(self) -> None:
        deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        service.set_runtime(Runtime(graph=build_graph(deps), deps=deps))
        self.c = TestClient(service.app)

    # --- the gauges ----------------------------------------------------

    def test_the_gauges_answer_even_without_the_published_marks(self) -> None:
        """The fake is still on the five original columns; the page gets rows."""
        body = self.c.get("/desk/rivers").json()
        self.assertTrue(body["stations"])
        self.assertEqual(body["count"], len(body["stations"]))
        self.assertFalse(body["marks"], "the fake has no mhw_cm, so marks is false")
        self.assertTrue(all(s.get("station") for s in body["stations"]))

    # --- the hourly series ---------------------------------------------

    def test_the_series_returns_every_row_not_a_sample(self) -> None:
        body = self.c.get("/desk/events/EMSR773/series").json()
        self.assertGreater(body["count"], 20, "Evidence caps at 20; this must not")
        self.assertEqual(body["count"], len(body["readings"]))
        self.assertTrue(body["view"].endswith(".hazard_timeline"))

    def test_the_series_stays_inside_the_event_window(self) -> None:
        body = self.c.get("/desk/events/EMSR773/series").json()
        stamps = [str(r["ts_utc"])[:10] for r in body["readings"]]
        self.assertTrue(min(stamps) >= body["from_utc"][:10])
        self.assertTrue(max(stamps) <= body["to_utc"][:10])

    def test_the_series_carries_the_moments_the_replay_marks(self) -> None:
        body = self.c.get("/desk/events/EMSR773/series").json()
        self.assertTrue(body["moments"])
        self.assertTrue(all(m["ts"] and m["label"] for m in body["moments"]))

    def test_an_unknown_event_is_refused_not_guessed(self) -> None:
        self.assertEqual(self.c.get("/desk/events/NOPE/series").status_code, 400)

    # --- the rule the engine enforces ----------------------------------

    def test_neither_statement_names_its_view_twice(self) -> None:
        seen: list[str] = []
        original = warehouse.rows

        def spy(sql, limit=None):
            seen.append(sql)
            return original(sql, limit)

        warehouse.rows = spy
        try:
            self.c.get("/desk/rivers")
            self.c.get("/desk/events/EMSR773/series")
        finally:
            warehouse.rows = original
        self.assertTrue(seen)
        offenders = [s for s in seen if named_twice(s)]
        self.assertEqual([], offenders)

    def test_a_write_never_reaches_the_engine(self) -> None:
        """check_sql is the one gate, and warehouse.rows goes through it."""
        with self.assertRaises(ValueError):
            warehouse.rows("DROP TABLE floodsense.gauge_levels")


if __name__ == "__main__":
    unittest.main()
