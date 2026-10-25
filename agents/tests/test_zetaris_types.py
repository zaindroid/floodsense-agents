"""Zetaris answers every column as a string. The nodes count and format these
values, so the client has to give them back their type before anything else
sees them. Measured against the real engine on 2026-10-25:

    segment          str  'retail'
    policies         str  '61'
    sum_insured_eur  str  '1.51465E8'
    in_footprint     str  'true'
    ts_utc           str  '2024-10-20 00:00:00.0'
"""

import unittest

from floodsense_agents.zetaris import ZetarisClient


class TypedTest(unittest.TestCase):
    def t(self, value):
        return ZetarisClient._typed(value)

    def test_a_number_written_as_a_string_comes_back_a_number(self) -> None:
        self.assertEqual(self.t("61"), 61)
        self.assertIsInstance(self.t("61"), int)
        self.assertEqual(self.t("3616000.0"), 3616000.0)
        self.assertEqual(self.t("-12.5"), -12.5)

    def test_scientific_notation_is_a_number(self) -> None:
        # SUM() over a large portfolio comes back like this.
        self.assertEqual(self.t("1.51465E8"), 151465000.0)

    def test_a_boolean_written_as_a_string_comes_back_a_boolean(self) -> None:
        self.assertIs(self.t("true"), True)
        self.assertIs(self.t("false"), False)
        self.assertIs(self.t("TRUE"), True)

    def test_an_identifier_is_left_alone(self) -> None:
        for v in ("VAL01", "SYN-00001", "retail", "", "  "):
            self.assertEqual(self.t(v), v)

    def test_a_leading_zero_means_an_identifier_not_a_number(self) -> None:
        # '007' is a code, not seven.
        self.assertEqual(self.t("007"), "007")
        self.assertEqual(self.t("0012.5"), "0012.5")
        # but a genuine zero, and a decimal below one, are numbers
        self.assertEqual(self.t("0"), 0)
        self.assertEqual(self.t("0.0"), 0.0)
        self.assertEqual(self.t("0.25"), 0.25)

    def test_a_timestamp_is_left_alone(self) -> None:
        for v in ("2024-10-20 00:00:00.0", "2024-10-29T17:00:00Z", "2024-10-29"):
            self.assertEqual(self.t(v), v)

    def test_values_that_are_already_typed_are_untouched(self) -> None:
        for v in (None, 1, 2.5, True, ["a"], {"k": "v"}):
            self.assertEqual(self.t(v), v)

    def test_rows_are_typed_whole(self) -> None:
        js = {
            "headers": [{"name": "segment"}, {"name": "policies"}, {"name": "sum_insured_eur"}],
            "data": [["retail", "61", "1.51465E8"]],
        }
        self.assertEqual(
            ZetarisClient._rows(js),
            [{"segment": "retail", "policies": 61, "sum_insured_eur": 151465000.0}],
        )

    def test_a_total_can_be_formatted_after_typing(self) -> None:
        # The bug this prevents: "Unknown format code 'f' for object of type
        # 'str'", which failed a whole run at the exposure node.
        row = ZetarisClient._rows(
            {"headers": ["sum_insured_eur"], "data": [["1.51465E8"]]}
        )[0]
        self.assertEqual(f"{row['sum_insured_eur']:,.0f}", "151,465,000")


if __name__ == "__main__":
    unittest.main()
