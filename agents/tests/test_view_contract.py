"""The fake serves the columns the live views declare.

contracts/views.yaml is the team's declaration and zetaris/migrations/ build the
live views from it. The fake stands in for those views offline, so a column added
live has to arrive here too, or the offline tests pass against a shape the
warehouse no longer has. Migration 018 added synthetic and this test is why the
fake has it.
"""

import re
import unittest
from pathlib import Path

from floodsense_agents.governance import CONTRACT_VIEWS
from floodsense_agents.settings import settings
from floodsense_agents.zetaris import FakeZetaris

VIEWS = Path(__file__).resolve().parents[2] / "contracts" / "views.yaml"
_VIEW = re.compile(r"^ {2}([a-z][a-z0-9_]*):\s*$")
_COLUMN = re.compile(r"^\s*- \{name:\s*([a-z][a-z0-9_]*),\s*type:\s*([a-z]+)\}")


def declared() -> dict[str, list[str]]:
    """Read contracts/views.yaml without a yaml dependency, as scripts/ does."""
    out: dict[str, list[str]] = {}
    name = None
    for line in VIEWS.read_text(encoding="utf-8").splitlines():
        if m := _VIEW.match(line):
            name = m.group(1)
            out[name] = []
        elif name and (m := _COLUMN.match(line)):
            out[name].append(m.group(1))
    return out


@unittest.skipUnless(VIEWS.is_file(), "contracts/views.yaml is not in this checkout")
class ViewContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.declared = declared()
        self.zetaris = FakeZetaris()

    def test_the_contract_covers_every_view_the_agents_read(self) -> None:
        self.assertEqual(set(self.declared), set(CONTRACT_VIEWS))

    def test_the_fake_serves_the_declared_columns(self) -> None:
        for view, columns in self.declared.items():
            ev = self.zetaris.run_sql(f"SELECT * FROM {settings.schema}.{view} LIMIT 1")
            self.assertIsNone(ev.error, f"{view}: {ev.error}")
            self.assertTrue(ev.rows_sample, f"{view} returned no rows")
            self.assertEqual(sorted(ev.rows_sample[0]), sorted(columns), view)

    def test_the_portfolio_says_it_is_synthetic(self) -> None:
        ev = self.zetaris.run_sql(
            f"SELECT DISTINCT synthetic FROM {settings.schema}.exposure_join"
        )
        self.assertEqual([r["synthetic"] for r in ev.rows_sample], ["yes"])


if __name__ == "__main__":
    unittest.main()
