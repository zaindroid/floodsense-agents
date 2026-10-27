"""Whole result sets for the pages, beside the agents' sampled Evidence.

Evidence keeps `rows_sample[:20]` on purpose: a citation needs a witness row,
not a series. A chart needs every row, so this module asks the same engine the
same way and keeps them all.

It reuses `check_sql`, so the one place that decides what the app may run is
still the one place, and it reaches the engine through whatever client the
runtime already built -- `agents/` is mirrored from main and is not edited here.

One rule the SQL below obeys: Zetaris resolves a view once per statement.
Naming the same view twice, joined or under UNION, fails the whole statement
with MISSING_ATTRIBUTES. Read it once and aggregate.
"""

from __future__ import annotations

import logging
import uuid

import httpx

from floodsense_agents.__main__ import runtime
from floodsense_agents.settings import settings
from floodsense_agents.zetaris import ZetarisClient, check_sql

log = logging.getLogger("floodsense.console.warehouse")

TIMEOUT_S = 60


class WarehouseError(RuntimeError):
    """The engine refused or could not be reached. The page says so."""


def rows(sql: str, limit: int | None = None) -> list[dict]:
    """Every row the statement returns, not a sample. Raises WarehouseError."""
    sql = check_sql(sql)
    client = runtime().deps.zetaris
    if isinstance(client, ZetarisClient):
        return _live_rows(client, sql, limit or settings.zetaris_row_limit)
    return _fake_rows(client, sql)


def _live_rows(client: ZetarisClient, sql: str, limit: int) -> list[dict]:
    qid = str(uuid.uuid4())
    body = {"queryId": qid, "sql": sql, "limit": limit, "source": "SqlEditor"}
    try:
        for attempt in (0, 1):
            token = client._token or client._login()
            r = httpx.post(
                f"{client.rest}/sql-editor/sqls/run",
                json=body,
                timeout=TIMEOUT_S,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Org-ID": settings.zetaris_org_id,
                    "X-Request-ID": str(uuid.uuid4()),
                },
            )
            # An expired token looks like a refusal; log in once and retry.
            if attempt == 0 and not settings.zetaris_api_key and r.status_code in (401, 403):
                client._token = None
                continue
            if not r.is_success:
                raise WarehouseError(f"Zetaris HTTP {r.status_code}: {r.text[:200]}")
            return ZetarisClient._rows(r.json())
    except WarehouseError:
        raise
    except Exception as e:  # noqa: BLE001 - the page needs the reason, not a traceback
        log.warning("warehouse read failed: %s", str(e)[:200])
        raise WarehouseError(str(e)[:200]) from e
    raise WarehouseError("the engine did not answer")


def _fake_rows(client, sql: str) -> list[dict]:
    """Offline: the same SQL against the fake's own tables, all rows kept."""
    conn = getattr(client, "_conn", None)
    if conn is None:
        raise WarehouseError("no warehouse is configured")
    try:
        with client._lock:
            return [dict(r) for r in conn.execute(sql).fetchall()]
    except Exception as e:  # noqa: BLE001
        raise WarehouseError(str(e)[:200]) from e
