// The water itself: where the rivers stand now, and the event hour by hour.
//
//   drawRivers(box)            gauge_levels, live from PEGELONLINE
//   drawSeries(eventId, box)   hazard_timeline, every hour of the event
//
// Both read the service. A number that is not in the warehouse is not here.
"use strict";

(function () {
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const one = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-GB"));
  const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const dayOf = (ts) =>
    ts ? Number(ts.slice(8, 10)) + " " + MONTHS[Number(ts.slice(5, 7)) - 1] : "";
  const stamp = (ts) => (ts ? dayOf(ts) + " " + ts.slice(11, 16) + " UTC" : "—");

  async function read(path) {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) {
      let why = "the service answered " + res.status;
      try {
        const body = await res.json();
        if (body.detail) why = body.detail;
      } catch (e) {
        /* the status line is all we have */
      }
      throw new Error(why);
    }
    return res.json();
  }

  /* Rivers now ----------------------------------------------------------- */

  // Where the level sits on the station's own scale. PEGELONLINE publishes
  // these marks per gauge, so "high" is this river's high, not a global line.
  function place(st) {
    const level = num(st.level_cm);
    const mw = num(st.mw_cm);
    const mhw = num(st.mhw_cm);
    const hhw = num(st.hhw_cm);
    if (level == null || mhw == null) return null;
    // From gauge zero to the highest mark: a level under mean low water is a
    // real reading, and anchoring the scale at MNW would draw it as nothing.
    const hi = Math.max(hhw != null ? hhw : mhw, mhw, level);
    if (!(hi > 0)) return null;
    const at = (v) => Math.max(0, Math.min(100, (v / hi) * 100));
    return { level: at(level), mhw: at(mhw), mw: mw == null ? null : at(mw) };
  }

  function trendHtml(st) {
    const t = num(st.trend_cm_h);
    if (t == null || t === 0) return '<i class="t flat">steady</i>';
    const dir = t > 0 ? "up" : "down";
    const word = t > 0 ? "rising" : "falling";
    return '<i class="t ' + dir + '">' + word + " " + one(Math.abs(t)) + " cm/h</i>";
  }

  function marksHtml(st) {
    const rows = [
      ["MNW", st.mnw_cm, "mean low water"],
      ["MW", st.mw_cm, "mean water"],
      ["MHW", st.mhw_cm, "mean high water"],
      ["HHW", st.hhw_cm, "highest known"],
      ["HSW", st.hsw_cm, "highest navigable"],
    ].filter((r) => num(r[1]) != null);
    if (!rows.length) return "";
    return (
      '<dl class="marks">' +
      rows
        .map(
          (r) =>
            "<div><dt>" + r[0] + "</dt><dd>" + one(num(r[1])) + " cm</dd>" +
            '<dd class="why">' + r[2] + "</dd></div>"
        )
        .join("") +
      "</dl>"
    );
  }

  function gaugeHtml(st, i) {
    const p = place(st);
    const band = String(st.band || "unknown");
    const stale = st.is_stale === true || st.is_stale === "true";
    const level = num(st.level_cm);
    const scale = p
      ? '<span class="g-scale" aria-hidden="true"><span class="g-track">' +
        '<span class="g-fill" style="width:' + p.level.toFixed(1) + '%"></span>' +
        (p.mw == null
          ? ""
          : '<span class="g-at mw" style="left:' + p.mw.toFixed(1) + '%"></span>') +
        '<span class="g-at mhw" style="left:' + p.mhw.toFixed(1) + '%"></span>' +
        "</span></span>"
      : '<span class="g-scale"><span class="g-none">no marks published</span></span>';
    return (
      '<li class="gauge" style="--d:' + i * 55 + 'ms">' +
      '<button class="g-head" aria-expanded="false">' +
      '<span class="g-name">' + esc(st.station) + "<i>" + esc(st.water || "") + "</i></span>" +
      scale +
      '<span class="g-read">' +
      (level == null ? "no reading" : one(level) + " cm") +
      trendHtml(st) +
      "</span>" +
      '<span class="pill ' + (band === "above" ? "stop" : band === "near" ? "wait" : "") + '">' +
      esc(band) +
      "</span></button>" +
      '<div class="g-more" hidden>' +
      marksHtml(st) +
      '<p class="note">Reading ' + esc(stamp(st.ts_utc)) +
      (stale ? ", not refreshed since" : "") +
      ". Quelle: WSV, PEGELONLINE.</p></div></li>"
    );
  }

  async function drawRivers(box) {
    if (!box) return;
    let data;
    try {
      data = await read("/desk/rivers");
    } catch (err) {
      box.innerHTML = '<p class="note warn">No gauges: ' + esc(err.message) + "</p>";
      return;
    }
    const st = data.stations || [];
    if (!st.length) {
      box.innerHTML = '<p class="note">No station is reporting.</p>';
      return;
    }
    const high = st.filter((s) => s.band === "above" || s.band === "near").length;
    const stale = st.filter((s) => s.is_stale === true || s.is_stale === "true").length;
    box.innerHTML =
      '<ol class="gauges">' + st.map(gaugeHtml).join("") + "</ol>" +
      '<p class="note">' + st.length + " stations &middot; " +
      (high ? high + " at or near the high-water mark" : "all below their high-water mark") +
      (stale ? " &middot; " + stale + " not refreshed" : "") +
      " &middot; " + esc(data.view) + "</p>";
    box.querySelectorAll(".g-head").forEach((b) =>
      b.addEventListener("click", () => {
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        b.nextElementSibling.hidden = open;
      })
    );
  }

  /* The event, hour by hour ---------------------------------------------- */

  // One row per hour: the wettest point and the fullest river at that hour.
  // The point that produced each reading is named beside it, so the maximum
  // is attributable rather than a figure with no place behind it.
  function byHour(readings) {
    const map = new Map();
    readings.forEach((r) => {
      const ts = String(r.ts_utc || "").slice(0, 19);
      if (!ts) return;
      let h = map.get(ts);
      if (!h) map.set(ts, (h = { ts, rain: null, flow: null, rainAt: "", flowAt: "" }));
      const rain = num(r.rain_mm);
      const flow = num(r.discharge_m3s);
      if (rain != null && (h.rain == null || rain > h.rain)) {
        h.rain = rain;
        h.rainAt = r.point_id;
      }
      if (flow != null && (h.flow == null || flow > h.flow)) {
        h.flow = flow;
        h.flowAt = r.point_id;
      }
    });
    return [...map.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }

  const W = 960;
  const RAIN_H = 64;
  const GAP = 14;
  const FLOW_H = 108;
  const H = RAIN_H + GAP + FLOW_H;

  function chartSvg(hours) {
    const rainMax = Math.max(1, ...hours.map((h) => h.rain || 0));
    const flowMax = Math.max(1, ...hours.map((h) => h.flow || 0));
    const step = W / Math.max(1, hours.length);
    const bars = hours
      .map((h, i) => {
        if (!h.rain) return "";
        const tall = (h.rain / rainMax) * RAIN_H;
        return (
          '<rect class="r-bar" x="' + (i * step).toFixed(2) +
          '" y="' + (RAIN_H - tall).toFixed(2) +
          '" width="' + Math.max(1, step - 0.6).toFixed(2) +
          '" height="' + tall.toFixed(2) + '"></rect>'
        );
      })
      .join("");
    let d = "";
    hours.forEach((h, i) => {
      if (h.flow == null) return;
      const x = (i * step + step / 2).toFixed(2);
      const y = (RAIN_H + GAP + FLOW_H - (h.flow / flowMax) * FLOW_H).toFixed(2);
      d += (d ? "L" : "M") + x + " " + y;
    });
    return (
      '<svg class="series" viewBox="0 0 ' + W + " " + H +
      '" preserveAspectRatio="none" role="img"' +
      ' aria-label="rain and discharge, hour by hour">' +
      bars +
      '<path class="r-line" d="' + d + '"></path>' +
      '<line class="r-now" x1="0" y1="0" x2="0" y2="' + H + '"></line>' +
      "</svg>" +
      '<div class="s-peak"><b>' + one(rainMax) + " mm/h</b><b>" + one(flowMax) +
      " m³/s</b></div>"
    );
  }

  async function drawSeries(eventId, box) {
    if (!box) return;
    let data;
    try {
      data = await read("/desk/events/" + encodeURIComponent(eventId) + "/series");
    } catch (err) {
      box.innerHTML = '<p class="note warn">No hourly series: ' + esc(err.message) + "</p>";
      return;
    }
    const hours = byHour(data.readings || []);
    if (!hours.length) {
      box.innerHTML = '<p class="note">The warehouse holds no hourly rows for this event.</p>';
      return;
    }
    // Each declared moment lands on the last hour at or before it.
    const moments = (data.moments || []).map((m) => {
      let at = 0;
      hours.forEach((h, i) => {
        if (h.ts.slice(0, 13) <= String(m.ts).slice(0, 13)) at = i;
      });
      return { i: at, label: m.label, ts: m.ts };
    });
    box.innerHTML =
      '<div class="s-wrap">' +
      chartSvg(hours) +
      '<div class="s-moments">' +
      moments
        .map(
          (m) =>
            '<button class="s-m" data-i="' + m.i + '" style="left:' +
            (((m.i + 0.5) / hours.length) * 100).toFixed(2) + '%" title="' +
            esc(m.label) + '"><span></span></button>'
        )
        .join("") +
      "</div></div>" +
      '<div class="s-bar"><button class="ghost" id="sPlay">Play</button>' +
      '<input id="sScrub" type="range" min="0" max="' + (hours.length - 1) +
      '" value="' + (hours.length - 1) + '" aria-label="hour of the event" />' +
      "</div>" +
      '<p class="s-say" id="sSay"></p>' +
      '<p class="note">' + hours.length + " hours &middot; " +
      (data.count || 0) + " rows &middot; " + esc(data.view) + "</p>";

    const svg = box.querySelector(".series");
    const now = box.querySelector(".r-now");
    const scrub = box.querySelector("#sScrub");
    const say = box.querySelector("#sSay");
    const play = box.querySelector("#sPlay");
    let timer = null;

    function show(i) {
      const h = hours[i];
      const x = ((i + 0.5) / hours.length) * W;
      now.setAttribute("x1", x);
      now.setAttribute("x2", x);
      const m = moments.filter((mm) => mm.i <= i).pop();
      say.innerHTML =
        "<b>" + esc(stamp(h.ts)) + "</b>" +
        '<span class="s-fig">rain <b>' + one(h.rain) + "</b> mm/h" +
        (h.rainAt ? " at " + esc(h.rainAt) : "") + "</span>" +
        '<span class="s-fig">discharge <b>' + one(h.flow) + "</b> m³/s" +
        (h.flowAt ? " at " + esc(h.flowAt) : "") + "</span>" +
        (m ? '<span class="s-moment">' + esc(m.label) + "</span>" : "");
      box.querySelectorAll(".s-m").forEach((b) =>
        b.setAttribute("aria-current", String(Number(b.dataset.i) === (m ? m.i : -1)))
      );
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      play.textContent = "Play";
    }

    function goTo(i) {
      stop();
      const at = Math.max(0, Math.min(hours.length - 1, i));
      scrub.value = String(at);
      show(at);
    }

    scrub.addEventListener("input", () => {
      stop();
      show(Number(scrub.value));
    });
    play.addEventListener("click", () => {
      if (timer) return stop();
      if (Number(scrub.value) >= hours.length - 1) scrub.value = "0";
      play.textContent = "Pause";
      timer = setInterval(() => {
        const next = Number(scrub.value) + 1;
        if (next > hours.length - 1) return stop();
        scrub.value = String(next);
        show(next);
      }, 90);
    });
    box.querySelectorAll(".s-m").forEach((b) =>
      b.addEventListener("click", () => goTo(Number(b.dataset.i)))
    );
    if (svg)
      svg.addEventListener("click", (e) => {
        const r = svg.getBoundingClientRect();
        goTo(Math.round(((e.clientX - r.left) / r.width) * (hours.length - 1)));
      });
    show(hours.length - 1);
  }

  window.drawRivers = drawRivers;
  window.drawSeries = drawSeries;
})();
