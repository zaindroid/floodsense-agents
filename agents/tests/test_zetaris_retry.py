"""When to log in again.

The engine does not answer 401 for a token it has rejected. Measured on
2026-10-25 against the real engine:

    expired or forged token   400  {"msg":"Not Allowed"}
    stale cached token        400  {"msg":"Bad Request"}
    no Authorization header   401  Invalid value for: header Authorization
    rejected statement        400  {"msg":"[UNRESOLVED_COLUMN...]"}
    queryId of the wrong kind 400  Got value ... with wrong type, expecting

So 400 alone cannot decide, and 401 alone would never fire for the case that
actually happens. Matching the wordings does not work either: the second one
turned up a day after the first and stopped every query in a session until
the process was restarted. The rule is the other way round -- a 400 is a
token problem unless the body names the statement.
"""

import unittest

from floodsense_agents.zetaris import _token_rejected


class Reply:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class TokenRejectedTest(unittest.TestCase):
    def test_an_expired_token_is_a_400_not_allowed(self) -> None:
        self.assertTrue(_token_rejected(Reply(400, '{"msg":"Not Allowed"}')))

    def test_case_does_not_matter(self) -> None:
        self.assertTrue(_token_rejected(Reply(400, '{"msg":"NOT ALLOWED"}')))

    def test_a_stale_token_can_also_be_a_400_bad_request(self) -> None:
        # Seen live: every statement, including SELECT 1, until a re-login.
        self.assertTrue(_token_rejected(Reply(400, '{"msg":"Bad Request"}')))

    def test_an_unrecognised_400_is_treated_as_a_token_problem(self) -> None:
        # One re-login costs a round trip; not retrying cost a whole session.
        self.assertTrue(_token_rejected(Reply(400, '{"msg":"something new"}')))

    def test_a_missing_header_is_a_401(self) -> None:
        self.assertTrue(_token_rejected(Reply(401, "Invalid value for: header Authorization")))

    def test_a_forbidden_reply_counts_too(self) -> None:
        self.assertTrue(_token_rejected(Reply(403, "")))

    def test_bad_sql_is_not_a_token_problem(self) -> None:
        # Retrying this would only double the wait before the same error.
        self.assertFalse(
            _token_rejected(Reply(400, '{"msg":"[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column '
                                       'or function parameter with name `nope` cannot be resolved"}'))
        )

    def test_a_rejected_query_id_is_not_a_token_problem(self) -> None:
        self.assertFalse(
            _token_rejected(
                Reply(400, "Got value '\"gw-probe\"' with wrong type, expecting string at "
                           "'queryId'")
            )
        )

    def test_any_bracketed_error_class_names_the_statement(self) -> None:
        self.assertFalse(_token_rejected(Reply(400, '{"msg":"[PARSE_SYNTAX_ERROR] near FROM"}')))
        self.assertFalse(_token_rejected(Reply(400, '{"msg":"[MISSING_ATTRIBUTES.X] hourly"}')))

    def test_a_server_error_is_not_a_token_problem(self) -> None:
        self.assertFalse(_token_rejected(Reply(500, "boom")))

    def test_success_is_not_a_token_problem(self) -> None:
        self.assertFalse(_token_rejected(Reply(200, "{}")))


if __name__ == "__main__":
    unittest.main()
