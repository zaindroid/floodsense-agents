"""Watchers. Deterministic SQL over hazard_timeline.

Scans the event window, cut at replay_ts, so the Investigator starts from
anomalies that each carry a query_id. Also loads the provenance view once
for layer (b) citations. No model call.
"""

from __future__ import annotations

import time

from floodsense_agents.governance import DEFINITIONS
from floodsense_agents.models import Anomaly
from floodsense_agents.settings import settings
from floodsense_agents.state import Deps, FloodState, add_evidence, trace


def window(state: FloodState) -> tuple[str, str]:
    ev = state["event"]
    end = state.get("replay_ts") or ev["window_to_utc"]
    return ev["window_from_utc"], min(end, ev["window_to_utc"])


def make(deps: Deps):
    def watchers(state: FloodState) -> dict:
        t = time.time()
        s = settings.schema
        rain_at = DEFINITIONS["anomaly_rain"]
        flow_at = DEFINITIONS["anomaly_discharge"]
        t0, t1 = window(state)
        q = {
            "rain": f"SELECT point_id, ts_utc, rain_mm FROM {s}.hazard_timeline WHERE ts_utc "
            f"BETWEEN "
            f"'{t0}' AND '{t1}' AND rain_mm >= {rain_at.value} ORDER BY rain_mm DESC",
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
        for r in evid["rain"].rows_sample[:5]:
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
        for r in evid["discharge"].rows_sample[:3]:
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
