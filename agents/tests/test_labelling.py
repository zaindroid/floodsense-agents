"""Cached and replayed answers are never presented as live.

GAMEPLAN "Caching and the honest demo". The wording lives here so that every
console reading this service, and the video, all say the same thing.
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


from floodsense_agents import labelling  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
