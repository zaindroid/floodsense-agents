"""When to log in again.

The engine does not answer 401 for a token it has rejected. Measured on
2026-10-25 against the real engine:

    expired or forged token   400  {"msg":"Not Allowed"}
    no Authorization header   401  Invalid value for: header Authorization
    rejected statement        400  {"msg":"[UNRESOLVED_COLUMN...]"}

So 400 alone cannot decide, and 401 alone would never fire for the case
that actually happens. The agents log in rather than carrying a static key,
so their token does expire mid-run and this is the only thing that recovers
it.
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

    def test_a_server_error_is_not_a_token_problem(self) -> None:
        self.assertFalse(_token_rejected(Reply(500, "boom")))

    def test_success_is_not_a_token_problem(self) -> None:
        self.assertFalse(_token_rejected(Reply(200, "{}")))


if __name__ == "__main__":
    unittest.main()
