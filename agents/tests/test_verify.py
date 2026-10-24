"""Per-agent step verification, and which data path the run actually used.

Same discipline as test_readiness: every step is broken on purpose and
asserted to notice. The Judge's checks matter most, because they recompute
its own summary from its own per-claim scores.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CHECKPOINTER", "memory")
os.environ.setdefault("ZETARIS_MODE", "fake")
os.environ.setdefault("LLM_MODE", "fake")

from floodsense_agents import verify  # noqa: E402
from floodsense_agents.models import ApprovalDecision, RunRequest  # noqa: E402
from floodsense_agents.runtime import Runtime  # noqa: E402
from floodsense_agents.settings import settings  # noqa: E402


class VerifyTest(unittest.TestCase):
    snap: dict
    rt: Runtime

    @classmethod
    def setUpClass(cls) -> None:
        cls._judge_was = settings.ff_judge
        settings.ff_judge = True
        cls.rt = Runtime()
        started = cls.rt.start(RunRequest(question="Why are we at risk?", event_id="EMSR773"))
        cls.snap = cls.rt.resume(
            started["run_id"], ApprovalDecision(action="approve", reviewer="zain")
        )

    @classmethod
    def tearDownClass(cls) -> None:
        settings.ff_judge = cls._judge_was

    def fresh(self) -> dict:
        return copy.deepcopy(self.snap)

    # --- the run as it stands --------------------------------------------

    def test_every_agent_is_verified_on_a_clean_run(self) -> None:
        rep = verify.report(self.snap)
        self.assertEqual(
            [s["agent"] for s in rep["steps"]],
            ["watchers", "investigator", "skeptic", "exposure", "playbook", "judge", "hitl"],
        )
        self.assertEqual(rep["verified"], 7, rep["failures"])
        self.assertEqual(rep["failures"], [])
        self.assertGreater(rep["checks_run"], 20)
        self.assertEqual(rep["checks_passed"], rep["checks_run"])

    def test_each_step_shows_the_queries_it_ran_with_their_source(self) -> None:
        rep = verify.report(self.snap)
        by = {s["agent"]: s for s in rep["steps"]}
        self.assertTrue(by["watchers"]["queries"])
        self.assertTrue(by["skeptic"]["queries"])
        for q in by["watchers"]["queries"]:
            self.assertTrue(q["resolved"])
            self.assertIn("hazard_timeline", " ".join(q["views"]))
            self.assertTrue(q["sql"])
            self.assertEqual(q["source"], "zetaris-fake")

    # --- the data path ----------------------------------------------------

    def test_the_data_path_says_plainly_that_zetaris_was_not_reached(self) -> None:
        path = verify.report(self.snap)["data_path"]
        self.assertFalse(path["reached_zetaris"])
        self.assertFalse(path["rest_url_set"])
        self.assertIn("offline stand-in", path["verdict"])
        self.assertEqual(path["by_source"], {"zetaris-fake": path["queries"]})
        self.assertEqual(path["errors"], 0)
        self.assertGreater(path["rows"], 0)

    def test_the_data_path_would_say_so_if_zetaris_had_answered(self) -> None:
        run = self.fresh()
        for e in run["evidence"].values():
            e["source"] = "zetaris"
        path = verify.data_path(run)
        self.assertTrue(path["reached_zetaris"])
        self.assertIn("every query went to Zetaris", path["verdict"])

    def test_a_half_live_run_is_called_mixed_rather_than_live(self) -> None:
        run = self.fresh()
        for i, e in enumerate(run["evidence"].values()):
            e["source"] = "zetaris" if i % 2 else "zetaris-fake"
        path = verify.data_path(run)
        self.assertFalse(path["reached_zetaris"])
        self.assertIn("mixed", path["verdict"])

    # --- break each agent -------------------------------------------------

    def test_watchers_notices_an_anomaly_pointing_at_no_query(self) -> None:
        run = self.fresh()
        run["anomalies"][0]["query_id"] = "gone"
        step = verify.watchers(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("dangling" in c.detail for c in step.checks if not c.ok))

    def test_watchers_notices_a_value_below_the_threshold_it_claims(self) -> None:
        run = self.fresh()
        rain = next(a for a in run["anomalies"] if a["kind"] == "rain")
        rain["value"] = 1.0
        step = verify.watchers(run)
        self.assertTrue(
            any("clears that threshold" in c.name for c in step.checks if not c.ok),
            [c.name for c in step.checks if not c.ok],
        )

    def test_investigator_notices_a_hypothesis_leaning_on_a_missing_claim(self) -> None:
        run = self.fresh()
        run["hypotheses"][0]["citations"] = ["C99"]
        step = verify.investigator(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("C99" in c.detail for c in step.checks if not c.ok))

    def test_skeptic_notices_a_challenge_with_nothing_behind_it(self) -> None:
        run = self.fresh()
        run["hypotheses"][0]["evidence"] = []
        step = verify.skeptic(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("nothing behind them" in c.detail for c in step.checks if not c.ok))

    def test_skeptic_notices_more_rounds_than_it_is_allowed(self) -> None:
        run = self.fresh()
        run["hypotheses"][0]["rounds"] = settings.skeptic_max_rounds + 5
        step = verify.skeptic(run)
        self.assertTrue(any("round limit" in c.name for c in step.checks if not c.ok))

    def test_exposure_notices_a_total_that_does_not_add_up(self) -> None:
        run = self.fresh()
        run["exposure"]["sum_insured_eur"] = 99_000_000
        step = verify.exposure(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("rows add to" in c.detail for c in step.checks if not c.ok))

    def test_exposure_notices_a_policy_count_that_does_not_match_its_rows(self) -> None:
        run = self.fresh()
        run["exposure"]["policies"] = 99
        step = verify.exposure(run)
        self.assertTrue(any("listed" in c.detail for c in step.checks if not c.ok))

    def test_playbook_notices_an_action_citing_a_claim_that_does_not_exist(self) -> None:
        run = self.fresh()
        run["playbook"][0]["claim_ids"] = ["C404"]
        step = verify.playbook(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("C404" in c.detail for c in step.checks if not c.ok))

    def test_judge_notices_an_overall_it_did_not_derive(self) -> None:
        run = self.fresh()
        run["judge_summary"]["overall"] = 0.99
        step = verify.judge(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(
            any("per-claim scores average" in c.detail for c in step.checks if not c.ok)
        )

    def test_judge_notices_a_hallucination_rate_that_contradicts_its_verdicts(self) -> None:
        run = self.fresh()
        run["judge"][0]["grounding"] = "unsupported"
        step = verify.judge(run)
        failed = {c.name for c in step.checks if not c.ok}
        self.assertIn("its hallucination rate matches its own verdicts", failed)
        self.assertIn("it flagged exactly the claims it called unsupported", failed)

    def test_judge_notices_a_claim_it_never_scored(self) -> None:
        run = self.fresh()
        run["judge"] = run["judge"][:-1]
        step = verify.judge(run)
        self.assertTrue(any("skipped" in c.detail for c in step.checks if not c.ok))

    def test_hitl_notices_a_release_with_nobody_named(self) -> None:
        run = self.fresh()
        run["approval"]["reviewer"] = None
        step = verify.hitl(run)
        self.assertEqual(step.status, "partial")
        self.assertTrue(any("a reviewer is named" in c.name for c in step.checks if not c.ok))

    def test_hitl_notices_a_rejection_that_released_something_anyway(self) -> None:
        run = self.fresh()
        run["approval"]["status"] = "rejected"
        run["approval"]["decision"] = "reject"
        step = verify.hitl(run)
        self.assertTrue(any("matches the decision" in c.name for c in step.checks if not c.ok))

    def test_an_agent_that_never_ran_is_not_counted_as_verified(self) -> None:
        rep = verify.report({})
        self.assertEqual(rep["verified"], 0)
        self.assertTrue(all(s["status"] == "not reached" for s in rep["steps"]))
        self.assertIn("no query ran", rep["data_path"]["verdict"])


if __name__ == "__main__":
    unittest.main()
