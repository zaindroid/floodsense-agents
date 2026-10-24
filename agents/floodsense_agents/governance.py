"""What the agents are allowed to assume: owners, definitions, products.

Three registries that the rest of the package reads instead of hard-coding
the same facts in several places, and that readiness.py checks a finished
run against. Changing a number here changes the system; changing it in a
node does not, because the check then fails.

Owners      who decides what a view means and who may release what it feeds
Definitions one wording and one number per term the agents assert
Products    what a consumer is promised, and where
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Rung 06. The agents read these four and nothing else. zetaris.py builds them
# in the fake and expects them in the live warehouse; readiness checks that no
# executed query reached past them.
CONTRACT_VIEWS = ("hazard_timeline", "discharge_daily", "exposure_join", "provenance")


@dataclass(frozen=True)
class Owner:
    """Rung 01. One accountable role per view, and who may let its output out."""

    view: str
    owner: str  # accountable for what the view means
    steward: str  # keeps it loaded and correct
    releases: str  # signs off before anything derived from it leaves the building


OWNERS: dict[str, Owner] = {
    "hazard_timeline": Owner(
        view="hazard_timeline",
        owner="hazard data lead",
        steward="ingestion",
        releases="duty underwriter",
    ),
    "discharge_daily": Owner(
        view="discharge_daily",
        owner="hazard data lead",
        steward="ingestion",
        releases="duty underwriter",
    ),
    "exposure_join": Owner(
        view="exposure_join",
        owner="portfolio lead",
        steward="portfolio ops",
        releases="duty underwriter",
    ),
    "provenance": Owner(
        view="provenance",
        owner="data governance",
        steward="ingestion",
        releases="data governance",
    ),
}


@dataclass(frozen=True)
class Definition:
    """Rung 02. A term the agents assert, with the number behind it.

    `wording` is what a node must say when it applies the term, so a reader
    and the check see the same sentence.
    """

    term: str
    value: float
    unit: str
    wording: str
    used_by: str
    owner: str
    agreed_on: str | None = None  # None until the team signs it off


DEFINITIONS: dict[str, Definition] = {
    # Screening and corroboration ask different questions, so they carry
    # different numbers. Both are declared; neither is a loose literal.
    "anomaly_rain": Definition(
        term="anomaly_rain",
        value=30,
        unit="mm/h",
        wording="hourly rain at or above 30 mm",
        used_by="watchers",
        owner="hazard data lead",
    ),
    "anomaly_discharge": Definition(
        term="anomaly_discharge",
        value=100,
        unit="m3/s",
        wording="discharge at or above 100 m3/s",
        used_by="watchers",
        owner="hazard data lead",
    ),
    "extreme_rain": Definition(
        term="extreme_rain",
        value=20,
        unit="mm/h",
        wording="rain was extreme (an hour >= 20 mm at a catchment point)",
        used_by="skeptic",
        owner="hazard data lead",
    ),
    "extreme_discharge_rise": Definition(
        term="extreme_discharge_rise",
        value=10,
        unit="x baseline",
        wording="discharge rose at least tenfold in the window",
        used_by="skeptic",
        owner="hazard data lead",
    ),
    "exposed_site": Definition(
        term="exposed_site",
        value=1,
        unit="in_footprint flag",
        wording="the site falls inside the mapped Copernicus footprint",
        used_by="exposure",
        owner="portfolio lead",
    ),
    "numeric_tolerance": Definition(
        term="numeric_tolerance",
        value=0.02,
        unit="relative",
        wording="a stated number matches its source within 2 per cent",
        used_by="judge",
        owner="data governance",
    ),
}


@dataclass(frozen=True)
class Product:
    """Rung 08. Something a named consumer can depend on."""

    name: str
    route: str
    consumer: str
    promise: str
    shape: str  # the model in models.py, or the page
    fields: tuple[str, ...] = field(default=())


DATA_PRODUCTS: tuple[Product, ...] = (
    Product(
        name="run snapshot",
        route="/runs/{run_id}",
        consumer="the console and the API proxy",
        promise="every claim carries its citations and the evidence they point at",
        shape="FloodState",
        fields=("run_id", "claims", "evidence", "judge_summary", "trace", "served_from"),
    ),
    Product(
        name="citation bundle",
        route="/runs/{run_id}/citations",
        consumer="anyone auditing an answer",
        promise="each citation resolves to the query that produced it",
        shape="Citation[] + Evidence",
        fields=("citations", "evidence", "provenance"),
    ),
    Product(
        name="approval packet",
        route="/runs/{run_id}/approval",
        consumer="the duty underwriter",
        promise="nothing outbound is released until this is answered",
        shape="Approval",
        fields=("status", "playbook", "judge_summary"),
    ),
    Product(
        name="live trace",
        route="/runs/{run_id}/events",
        consumer="the console",
        promise="one event per node as it happens, in order",
        shape="TraceEvent",
        fields=("seq", "node", "lane", "summary"),
    ),
    Product(
        name="readiness report",
        route="/readiness",
        consumer="the team and the judges",
        promise="each foundation states its own evidence and its own gaps",
        shape="Report",
        fields=("rungs", "overall", "generated_at"),
    ),
)
