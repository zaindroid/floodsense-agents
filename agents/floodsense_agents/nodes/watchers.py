"""Watchers. Deterministic SQL over hazard_timeline.

Scans the event window, cut at replay_ts, so the Investigator starts from
anomalies that each carry a query_id. Also loads the provenance view once
for layer (b) citations. No model call.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta

from floodsense_agents.governance import DEFINITIONS
from floodsense_agents.models import UTC_TS, Anomaly
from floodsense_agents.settings import settings
from floodsense_agents.state import Deps, FloodState, add_evidence, trace


def last_complete_day(end_utc: str) -> str:
    """The last date whose daily aggregate is actually known at end_utc.

    S2: discharge_daily was filtered with end[:10], so a replay standing at
    noon read that whole day's total, which nobody had yet. A daily value is
    known once the day is over.
    """
    date, _, clock = end_utc.partition("T")
    if clock.rstrip("Z") >= "23:59":
        return date
    day = datetime.strptime(date, "%Y-%m-%d") - timedelta(days=1)
    return day.strftime("%Y-%m-%d")


def window(state: FloodState) -> tuple[str, str]:
    """The event window, cut at the replay clock.

    The clock is re-checked here because these values are interpolated into
    SQL predicates, and state can be resumed from a checkpoint written by an
    older build.
    """
    ev = state["event"]
    end = state.get("replay_ts") or ev["window_to_utc"]
    if not UTC_TS.match(str(end)):
        raise ValueError(f"replay_ts is not a UTC instant: {end!r}")
    return ev["window_from_utc"], min(end, ev["window_to_utc"])


def peak_per_point(rows: list[dict]) -> list[dict]:
    """One row per point, keeping the first.

    The hazard queries are ordered by the value, so the first row a point
    appears in is its peak. hazard_timeline repeats a daily discharge across
    the 24 hours of its day, so the raw top rows were three copies of one
    point reported as three anomalies.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        if r["point_id"] not in seen:
            seen.add(r["point_id"])
            out.append(r)
    return out


def make(deps: Deps):
    def watchers(state: FloodState) -> dict:
        t = time.time()
        s = settings.schema
        rain_at = DEFINITIONS["anomaly_rain"]
        day_at = DEFINITIONS["anomaly_rain_24h"]
        flow_at = DEFINITIONS["anomaly_discharge"]
        t0, t1 = window(state)
        q = {
            "rain": f"SELECT point_id, ts_utc, rain_mm FROM {s}.hazard_timeline WHERE ts_utc "
            f"BETWEEN "
            f"'{t0}' AND '{t1}' AND rain_mm >= {rain_at.value} ORDER BY rain_mm DESC",
            # An hourly cell mean understates a convective peak, so the
            # accumulation is the screen that sees this kind of event. Grouped
            # per point, so each one reports the hour its total crossed.
            "rain_24h": f"SELECT point_id, MIN(ts_utc) AS ts_utc, ROUND(MAX(acc), 1) AS "
            f"rain_24h_mm FROM ("
            f"SELECT point_id, ts_utc, SUM(rain_mm) OVER (PARTITION BY point_id ORDER BY ts_utc "
            f"ROWS BETWEEN 23 PRECEDING AND CURRENT ROW) AS acc FROM {s}.hazard_timeline WHERE "
            f"ts_utc BETWEEN '{t0}' AND '{t1}') z WHERE acc >= {day_at.value} GROUP BY point_id "
            f"ORDER BY MAX(acc) DESC",
            "discharge": f"SELECT point_id, ts_utc, discharge_m3s FROM {s}.hazard_timeline WHERE "
            f"ts_utc BETWEEN "
            f"'{t0}' AND '{t1}' AND discharge_m3s >= {flow_at.value} ORDER BY discharge_m3s DESC",
            "warning": f"SELECT point_id, MIN(ts_utc) AS first_utc, warning_level FROM "
            f"{s}.hazard_timeline "
            f"WHERE ts_utc BETWEEN '{t0}' AND '{t1}' "
            f"AND warning_level IS NOT NULL GROUP BY point_id, warning_level ORDER BY first_utc",
        }
        evid = {k: deps.zetaris.run_sql(sql) for k, sql in q.items()}
        prov = deps.zetaris.run_sql(
            f"SELECT dataset, source_url, publisher, licence, attribution, fetched_at FROM "
            f"{s}.provenance"
        )
        items: list[Anomaly] = []
        for r in peak_per_point(evid["rain"].rows_sample)[:5]:
            items.append(
                Anomaly(
                    id=f"A{len(items) + 1}",
                    kind="rain",
                    point_id=r["point_id"],
                    ts_utc=r["ts_utc"],
                    value=r["rain_mm"],
                    unit="mm/h",
                    why=rain_at.wording,
                    query_id=evid["rain"].query_id,
                )
            )
        for r in evid["rain_24h"].rows_sample[:3]:
            items.append(
                Anomaly(
                    id=f"A{len(items) + 1}",
                    kind="rain",
                    point_id=r["point_id"],
                    ts_utc=r["ts_utc"],
                    value=r["rain_24h_mm"],
                    unit="mm/24h",
                    why=day_at.wording,
                    query_id=evid["rain_24h"].query_id,
                )
            )
        for r in peak_per_point(evid["discharge"].rows_sample)[:3]:
            items.append(
                Anomaly(
                    id=f"A{len(items) + 1}",
                    kind="discharge",
                    point_id=r["point_id"],
                    ts_utc=r["ts_utc"],
                    value=r["discharge_m3s"],
                    unit="m3/s",
                    why=flow_at.wording,
                    query_id=evid["discharge"].query_id,
                )
            )
        for r in evid["warning"].rows_sample:
            items.append(
                Anomaly(
                    id=f"A{len(items) + 1}",
                    kind="warning",
                    point_id=r["point_id"],
                    ts_utc=r["first_utc"],
                    why=f"warning level {r['warning_level']}",
                    query_id=evid["warning"].query_id,
                )
            )
        return {
            "anomalies": [i.model_dump() for i in items],
            "evidence": add_evidence(state, *evid.values(), prov),
            "provenance": prov.rows_sample,
            "status": "running",
            "trace": trace(
                state,
                "watchers",
                f"{len(items)} anomalies in window {t0[:16]}..{t1[:16]} ({len(evid)} hazard "
                f"queries)",
                lane="sql",
                started=t,
                evidence_ids=[e.query_id for e in evid.values()],
            ),
        }

    return watchers
