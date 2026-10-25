"""The screens that have to work on gridded reanalysis, not on gauges.

The live warehouse federates a 0.25 degree cell mean, which averages away the
station peak: measured over the whole loaded record on 2026-10-25 the hourly
rain tops out at 16.4 mm against a 30 mm screen, so the EMSR773 event produced
no anomalies at all. These tests pin what was changed to fix that, and the two
query shapes Lightning rejected or answered misleadingly.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from floodsense_agents.events import spec  # noqa: E402
from floodsense_agents.governance import DEFINITIONS  # noqa: E402
from floodsense_agents.nightshift import FakeNightshift  # noqa: E402
from floodsense_agents.nodes import skeptic, watchers  # noqa: E402
from floodsense_agents.state import Deps, NoMemory  # noqa: E402
from floodsense_agents.zetaris import FakeZetaris  # noqa: E402


def state(event_id: str = "EMSR773", replay_ts: str | None = None) -> dict:
    ev = spec(event_id)
    return {"event": ev.as_dict(), "replay_ts": replay_ts, "hypotheses": [], "claims": []}


class ThresholdTest(unittest.TestCase):
    def test_every_screen_is_reachable_by_a_cell_mean(self) -> None:
        # The record's own ceiling. A screen above it can never fire, which is
        # how the whole event came back empty.
        self.assertLessEqual(DEFINITIONS["anomaly_rain"].value, 16.4)
        self.assertLessEqual(DEFINITIONS["extreme_rain"].value, 16.4)

    def test_corroboration_asks_less_than_screening(self) -> None:
        self.assertLess(DEFINITIONS["extreme_rain"].value, DEFINITIONS["anomaly_rain"].value)

    def test_the_accumulation_screen_is_declared(self) -> None:
        d = DEFINITIONS["anomaly_rain_24h"]
        self.assertEqual(d.unit, "mm/24h")
        self.assertEqual(d.used_by, "watchers")
        self.assertIn(str(int(d.value)), d.wording)


class PeakPerPointTest(unittest.TestCase):
    def test_one_row_per_point_keeping_the_first(self) -> None:
        # hazard_timeline repeats a daily discharge across the 24 hours of its
        # day, so the top rows were three copies of one point.
        rows = [
            {"point_id": "VAL03", "discharge_m3s": 471.06},
            {"point_id": "VAL03", "discharge_m3s": 471.06},
            {"point_id": "VAL01", "discharge_m3s": 467.81},
        ]
        kept = watchers.peak_per_point(rows)
        self.assertEqual([r["point_id"] for r in kept], ["VAL03", "VAL01"])

    def test_empty_stays_empty(self) -> None:
        self.assertEqual(watchers.peak_per_point([]), [])


class WatcherQueryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        self.out = watchers.make(self.deps)(state())

    def test_it_runs_the_accumulation_screen(self) -> None:
        sqls = [e["sql"] for e in self.out["evidence"].values() if e.get("sql")]
        rolling = [q for q in sqls if "ROWS BETWEEN 23 PRECEDING" in q]
        self.assertEqual(len(rolling), 1, "no 24-hour accumulation query was run")
        self.assertIn(f">= {DEFINITIONS['anomaly_rain_24h'].value}", rolling[0])

    def test_no_point_is_reported_twice_for_one_kind(self) -> None:
        seen = [(a["kind"], a["point_id"], a["unit"]) for a in self.out["anomalies"]]
        self.assertEqual(len(seen), len(set(seen)))

    def test_each_anomaly_quotes_a_declared_wording(self) -> None:
        by_wording = {
            d.wording: d.value for d in DEFINITIONS.values() if d.used_by == "watchers"
        }
        for a in self.out["anomalies"]:
            if a["kind"] in ("rain", "discharge"):
                self.assertIn(a["why"], by_wording)
                self.assertGreaterEqual(a["value"], by_wording[a["why"]])


class SkepticSqlTest(unittest.TestCase):
    def setUp(self) -> None:
        self.deps = Deps(zetaris=FakeZetaris(), llm=FakeNightshift(), memory=NoMemory())
        self.st = state()
        self.pts, self.ev, self.note = skeptic.resolve_points(self.deps, self.st)

    def _all_sql(self) -> list[str]:
        from floodsense_agents.models import Hypothesis

        out = []
        for link in ("rain->catchment", "catchment->river", "river->site"):
            h = Hypothesis(id="H1", statement="s", link=link, citations=[])
            out += [sql for _, sql in skeptic._checks_for(h, self.st, self.pts)]
        return out

    def test_no_check_joins_the_view_to_itself(self) -> None:
        # Lightning federates hazard_timeline from a REST source and fails
        # with MISSING_ATTRIBUTES when one statement resolves it twice.
        for sql in self._all_sql():
            self.assertLessEqual(
                sql.count("hazard_timeline"), 1, f"self-join would fail on Lightning: {sql}"
            )

    def test_rises_are_measured_per_point(self) -> None:
        rises = [q for q in self._all_sql() if "MIN(discharge_m3s)" in q]
        self.assertTrue(rises)
        for sql in rises:
            self.assertIn("GROUP BY point_id", sql)
            self.assertIn(f">= {DEFINITIONS['extreme_discharge_rise'].value} *", sql)

    def test_named_points_are_used_when_the_view_has_them(self) -> None:
        self.assertIn("chiva", self.pts["rain"])
        self.assertEqual(self.note, "")

    def test_it_falls_back_to_the_points_the_view_carries(self) -> None:
        st = state()
        st["event"] = dict(st["event"], rain_points=("VAL99",), river_points=("VAL98",))
        pts, _, note = skeptic.resolve_points(self.deps, st)
        self.assertTrue(pts["rain"], "fell back to nothing, so every check would fail")
        self.assertIn("not the named points", note)

    def test_an_empty_point_list_cannot_become_invalid_sql(self) -> None:
        self.assertEqual(skeptic._in([]), "'no-such-point'")


if __name__ == "__main__":
    unittest.main()
