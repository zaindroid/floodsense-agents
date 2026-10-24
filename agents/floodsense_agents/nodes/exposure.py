"""Exposure. Deterministic SQL only.

Which policies and sites sit inside the mapped flood footprint, the sum
insured, and the split by segment. Adds the site exposure hypothesis with
number claims the Judge can check exactly.
"""

from __future__ import annotations

import re
import time

from floodsense_agents.models import Claim, ExposedAsset, Exposure, Hypothesis
from floodsense_agents.nodes.investigator import cite
from floodsense_agents.settings import settings
from floodsense_agents.state import Deps, FloodState, add_evidence, answered, trace


def make(deps: Deps):
    def exposure(state: FloodState) -> dict:
        t = time.time()
        s = settings.schema
        ev = state["event"]
        # in_footprint alone is portfolio-wide: an Ahr run read the Valencia
        # sites. Scope to where this event actually is.
        lat0, lat1, lon0, lon1 = ev["bbox"]
        here = (
            f"in_footprint = 1 AND lat BETWEEN {lat0} AND {lat1} AND lon BETWEEN {lon0} AND {lon1}"
        )
        published = ev["footprint_published_utc"]
        clock = state.get("replay_ts")
        # The mapping is a published product. Before it existed, nobody could
        # have acted on it, so a replay before that moment must not use it.
        have_footprint = not clock or clock >= published
        if not have_footprint:
            q = deps.zetaris.run_sql(
                f"SELECT policy_id, site_id, lat, lon, segment, sum_insured_eur "
                f"FROM {s}.exposure_join WHERE 1 = 0"
            )
            agg = q
        else:
            q = deps.zetaris.run_sql(
                f"SELECT policy_id, site_id, lat, lon, segment, sum_insured_eur "
                f"FROM {s}.exposure_join WHERE {here} ORDER BY sum_insured_eur DESC"
            )
            agg = deps.zetaris.run_sql(
                f"SELECT segment, COUNT(*) AS policies, SUM(sum_insured_eur) AS sum_insured_eur "
                f"FROM {s}.exposure_join WHERE {here} "
                f"GROUP BY segment ORDER BY sum_insured_eur DESC"
            )
        # A query that errored returned nothing because it failed, not because
        # the portfolio is empty. Saying "no site is exposed" would be as wrong
        # as naming seven.
        ok = answered(q, agg)
        assets = [ExposedAsset(**r) for r in q.rows_sample] if ok else []
        total = sum(a.sum_insured_eur or 0 for a in assets)
        exp = Exposure(
            assets=assets,
            policies=q.row_count,
            sum_insured_eur=total,
            by_segment=agg.rows_sample,
            query_ids=[q.query_id, agg.query_id],
        )

        claims = [Claim(**c) for c in state["claims"]]
        n = max([int(m.group(1)) for c in claims if (m := re.match(r"C(\d+)$", c.claim_id))] or [0])
        prov = state.get("provenance", [])
        new_ids: list[str] = []
        if assets:
            n += 1
            cid = f"C{n}"
            claims.append(
                Claim(
                    claim_id=cid,
                    kind="number",
                    hypothesis_id="H4",
                    citations=cite(cid, q, prov, 1),
                    numbers=[q.row_count, total],
                    text=f"{q.row_count} policies sit inside the mapped footprint, sum insured "
                    f"{total:,.0f} EUR; the largest is {assets[0].policy_id} "
                    f"({assets[0].segment}, {assets[0].sum_insured_eur:,.0f} EUR).",
                )
            )
            new_ids.append(cid)
            if agg.rows_sample:
                top = agg.rows_sample[0]
                n += 1
                cid = f"C{n}"
                claims.append(
                    Claim(
                        claim_id=cid,
                        kind="number",
                        hypothesis_id="H4",
                        citations=cite(cid, agg, prov, 1),
                        numbers=[top["policies"], top["sum_insured_eur"]],
                        text=f"The most exposed segment is {top['segment']}: {top['policies']} "
                        f"policies, {top['sum_insured_eur']:,.0f} EUR sum insured.",
                    )
                )
                new_ids.append(cid)
        hyps = [Hypothesis(**h) for h in state["hypotheses"] if h["id"] != "H4"]
        if not have_footprint:
            statement = "The footprint is not published yet at this replay time"
            rationale = (
                f"{ev['event_id']} mapping published {published}; this replay stands at {clock}"
            )
        elif not ok:
            statement = "Exposure is unknown: the portfolio query failed"
            rationale = f"exposure_join query failed: {(q.error or agg.error or '')[:160]}"
        elif assets:
            statement = f"{len(assets)} insured sites are exposed"
            rationale = "deterministic join on exposure_join.in_footprint = 1"
        else:
            statement = "No insured site in the footprint"
            rationale = "deterministic join on exposure_join.in_footprint = 1"
        hyps.append(
            Hypothesis(
                id="H4",
                link="site->exposure",
                citations=new_ids,
                status="supported" if assets else "not_supported",
                rounds=0,
                evidence=[q.query_id],
                statement=statement,
                rationale=rationale,
            )
        )
        return {
            "exposure": exp.model_dump(),
            "claims": [c.model_dump() for c in claims],
            "hypotheses": [h.model_dump() for h in hyps],
            "evidence": add_evidence(state, q, agg),
            "trace": trace(
                state,
                "exposure",
                f"{len(assets)} exposed policies, {total:,.0f} EUR sum insured, {len(new_ids)} new "
                f"number claims"
                if ok
                else "exposure not computed: the portfolio query failed"
                if ok
                else f"footprint not published until {published}",
                lane="sql",
                started=t,
                evidence_ids=[q.query_id, agg.query_id],
            ),
        }

    return exposure
