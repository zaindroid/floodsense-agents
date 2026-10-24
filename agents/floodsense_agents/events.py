"""The two reference events, keyed by Copernicus EMS activation id.

Fixes the replay window the Watchers query and the point ids involved.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class EventSpec:
    event_id: str
    name: str
    window_from_utc: str
    window_to_utc: str
    region: str
    river: str
    catchment: str
    river_points: tuple[
        str, ...
    ]  # point_ids in hazard_timeline / discharge_daily that carry discharge
    rain_points: tuple[str, ...]  # point_ids that carry rain
    # (lat_min, lat_max, lon_min, lon_max). exposure_join has no event column,
    # so this is what keeps one event's footprint off another's portfolio.
    bbox: tuple[float, float, float, float]
    # When Copernicus first published the mapping. A replay before this cannot
    # use the footprint, because nobody had it yet. Proposed: confirm against
    # the activation record.
    footprint_published_utc: str
    # Moments worth replaying the run at, so a reviewer can see what was
    # knowable when. Proposed from the seed; Saleeta and Urvashi confirm.
    moments: tuple[tuple[str, str], ...]

    def as_dict(self) -> dict:
        return asdict(self)


EVENTS: dict[str, EventSpec] = {
    "EMSR773": EventSpec(
        "EMSR773",
        "Valencia DANA, 29 Oct 2024",
        "2024-10-28T00:00:00Z",
        "2024-10-30T23:59:59Z",
        "Valencia province",
        "Barranco del Poyo",
        "Poyo ravine catchment",
        ("poyo-ribaroja",),
        ("chiva", "turis"),
        (38.90, 39.70, -1.10, -0.20),
        "2024-10-30T00:00:00Z",
        (
            ("2024-10-29T09:00:00Z", "Rain begins, red warning at Chiva"),
            ("2024-10-29T13:00:00Z", "Rain over the catchment for four hours"),
            ("2024-10-29T15:00:00Z", "Discharge reaches 310 m3/s"),
            ("2024-10-29T17:00:00Z", "Peak reading, 2,282 m3/s"),
            ("2024-10-29T18:00:00Z", "The gauge stops reporting"),
            ("2024-10-29T19:11:00Z", "ES-Alert reaches phones"),
            ("2024-10-30T06:00:00Z", "Copernicus publishes the footprint"),
        ),
    ),
    "EMSR517": EventSpec(
        "EMSR517",
        "Ahr valley flood, 14-15 Jul 2021",
        "2021-07-12T00:00:00Z",
        "2021-07-16T23:59:59Z",
        "Ahr valley, Rhineland-Palatinate",
        "Ahr",
        "Ahr catchment (Eifel)",
        ("altenahr",),
        ("ahrweiler",),
        (50.20, 50.70, 6.60, 7.40),
        "2021-07-15T00:00:00Z",
        (
            ("2021-07-14T14:00:00Z", "Rain over the Eifel"),
            ("2021-07-14T19:00:00Z", "Altenahr at 1,000 m3/s"),
            ("2021-07-14T20:00:00Z", "The gauge stops reporting"),
            ("2021-07-15T06:00:00Z", "Copernicus publishes the footprint"),
        ),
    ),
}
ALIASES = {"valencia_2024": "EMSR773", "ahr_2021": "EMSR517"}


def spec(event_id: str) -> EventSpec:
    key = ALIASES.get(event_id, event_id)
    if key not in EVENTS:
        raise KeyError(
            f"unknown event_id {event_id!r}; known: {', '.join(EVENTS)} (aliases: "
            f"{', '.join(ALIASES)})"
        )
    return EVENTS[key]
