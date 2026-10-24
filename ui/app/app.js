// The duty desk. Three screens, one page.
//   #/                      events waiting on someone
//   #/case/EMSR773          the decision, with the working folded away
//   #/case/EMSR773/record   what was decided, printable
//
// Everything on screen comes from the service. Nothing is invented here, and
// no message is sent from this file: the app renders them for a person to send.
"use strict";

const REVIEWER = "zain";
const fmt = new Intl.NumberFormat("en-GB");
const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
const eur = (n) => (n ? "€" + fmt.format(Math.round(n)) : "€0");
const screen = document.getElementById("screen");
const crumbs = document.getElementById("crumbs");

let cache = {};

async function api(path, options) {
  const res = await fetch(path, {
    headers: { accept: "application/json", ...(options && options.headers) },
    ...options,
  });
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

function fail(err, what) {
  screen.innerHTML =
    '<p class="error"><b>' +
    esc(what) +
    "</b><br />" +
    esc(err.message) +
    "<br /><br />Nothing is shown above because nothing could be read. " +
    "Reload once the service is answering.</p>";
}

/* Desk ------------------------------------------------------------------ */

function casePill(ev) {
  if (!ev.run_id) return ['<span class="pill">no case yet</span>', "Open a case"];
  if (ev.approval === "awaiting")
    return ['<span class="pill wait">needs your decision</span>', "Decide"];
  if (ev.approval === "approved" || ev.approval === "edited")
    return ['<span class="pill done">approved</span>', "Open"];
  if (ev.approval === "rejected") return ['<span class="pill stop">held</span>', "Open"];
  return ['<span class="pill">' + esc(ev.status || "open") + "</span>", "Open"];
}

async function desk() {
  crumbs.innerHTML = "";
  screen.innerHTML = '<p class="loading">Loading the desk…</p>';
  let data;
  try {
    data = await api("/desk/events");
  } catch (err) {
    return fail(err, "The desk could not be loaded.");
  }
  const waiting = data.events.filter((e) => e.approval === "awaiting").length;
  screen.innerHTML =
    '<h1 class="lede">' +
    (waiting
      ? waiting + (waiting === 1 ? " event needs" : " events need") + " a decision"
      : "Nothing is waiting on you") +
    '</h1><p class="sub">Copernicus activations covering this portfolio.</p>' +
    '<div class="cases">' +
    data.events
      .map((ev) => {
        const [pill] = casePill(ev);
        return (
          '<button class="case" data-id="' +
          esc(ev.event_id) +
          '"><span class="case-name">' +
          esc(ev.name) +
          '</span><span class="case-where">' +
          esc(ev.region) +
          " · " +
          esc(ev.river) +
          " · " +
          esc(ev.event_id) +
          '</span><span class="case-figs">' +
          (ev.run_id ? "case open" : "not opened") +
          "<span>" +
          (ev.label && !ev.label.live
            ? esc(ev.label.kind) + " " + esc(ev.label.at || "")
            : ev.updated_at
              ? esc(ev.updated_at.slice(0, 16).replace("T", " "))
              : "—") +
          "</span></span>" +
          pill +
          "</button>"
        );
      })
      .join("") +
    "</div>";
  screen.className = "seq";
  screen.querySelectorAll(".case").forEach((b) =>
    b.addEventListener("click", () => {
      location.hash = "#/case/" + b.dataset.id;
    })
  );
}

/* Case -------------------------------------------------------------------- */

async function openCase(eventId) {
  crumbs.innerHTML = '<a href="#/">Desk</a><i>/</i><span>' + esc(eventId) + "</span>";
  screen.innerHTML = '<p class="loading">Opening the case… the agents run on first open.</p>';
  let data;
  try {
    data = await api("/desk/events/" + encodeURIComponent(eventId));
  } catch (err) {
    return fail(err, "That case could not be opened.");
  }
  cache[eventId] = data;
  drawCase(eventId);
}

function drawCase(eventId) {
  const { run, figures, released } = cache[eventId];
  const ap = run.approval || {};
  const decided = ap.status && ap.status !== "awaiting";

  // The agents declined. Show why, and nothing else: there is no answer to
  // dress up, and that is the point.
  if (run.status === "out_of_scope") {
    screen.innerHTML =
      '<div class="declined"><h1>No answer from this case.</h1><p>' +
      esc((run.scope && run.scope.reason) || run.summary || "") +
      "</p></div>" +
      '<p class="note">Nothing was read and no model was called, so this cost ' +
      "one decision and no data.</p>" +
      askHtml(eventId);
    screen.className = "seq";
    wireAsk(eventId);
    return;
  }

  screen.innerHTML =
    holes(run) +
    stale(run) +
    '<h1 class="verdict">' +
    (figures.policies
      ? figures.policies +
        " of your sites " +
        (figures.policies === 1 ? "is" : "are") +
        " inside the flooded area."
      : "No insured site falls inside the flooded area.") +
    "</h1>" +
    '<dl class="figs"><div><dd data-to="' +
    (figures.sum_insured_eur || 0) +
    '" data-fmt="eur">' +
    eur(figures.sum_insured_eur) +
    "</dd><dt>sum insured at risk</dt></div>" +
    '<div><dd data-to="' +
    figures.policies +
    '">' +
    figures.policies +
    "</dd><dt>policies</dt></div>" +
    '<div><dd data-to="' +
    figures.actions +
    '">' +
    figures.actions +
    "</dd><dt>actions drafted</dt></div>" +
    '<div><dd data-to="' +
    (figures.judge_overall == null ? "" : figures.judge_overall) +
    '" data-fmt="two">' +
    (figures.judge_overall == null ? "—" : figures.judge_overall.toFixed(2)) +
    "</dd><dt>checked, over " +
    (run.claims || []).length +
    " claims</dt></div></dl>" +
    '<section class="area"><h2 class="sec">The chain that produced this</h2>' +
    '<div id="flow"><p class="note">Checking every step\u2026</p></div></section>' +
    '<section class="area"><h2 class="sec">What to do</h2><ol class="acts">' +
    (run.playbook || [])
      .map(
        (a) =>
          '<li><span class="when">within ' +
          a.horizon_h +
          ' h</span><p>' +
          esc(a.text) +
          '</p><span class="tag ' +
          (a.released ? "out" : decided && a.outbound ? "held" : "") +
          '">' +
          (a.released ? "released" : decided ? "held" : "awaiting you") +
          "</span></li>"
      )
      .join("") +
    "</ol>" +
    (decided ? signedHtml(ap, figures) : decideHtml()) +
    "</section>" +
    (released ? artifactsHtml(run) : "") +
    workingHtml(run) +
    '<section class="area"><h2 class="sec">What was knowable, and when</h2>' +
    '<div id="timeline"><p class="note">Replaying the event\u2026</p></div></section>' +
    askHtml(eventId);
  screen.className = "seq";

  if (!decided) wireDecide(eventId);
  if (released) wireArtifacts(eventId, run);
  wireAsk(eventId);
  countUp();
  drawFlow(run.run_id);
  drawTimeline(eventId);
}

/* The chain --------------------------------------------------------------- */

// Drawn from what the service verified, not from the graph's shape: a step
// that never ran says so instead of showing a tick. The marks land in order,
// so the chain reads the way the run went.
const nodeClass = (s) =>
  s.status === "verified"
    ? "verified"
    : s.status === "partial"
      ? "partial"
      : s.status === "failed"
        ? "failed"
        : s.agent === "hitl"
          ? "awaiting"
          : "waiting";

async function drawFlow(runId) {
  const box = document.getElementById("flow");
  if (!box) return;
  let v;
  try {
    v = await api("/runs/" + encodeURIComponent(runId) + "/verify");
  } catch (err) {
    box.innerHTML =
      '<p class="note warn">The steps could not be checked: ' + esc(err.message) + "</p>";
    return;
  }
  const path = v.data_path || {};
  box.innerHTML =
    '<div class="flow-row">' +
    v.steps
      .map((s, i) => {
        const kind = nodeClass(s);
        return (
          '<button class="node ' +
          kind +
          '" data-a="' +
          esc(s.agent) +
          '" style="--d:' +
          i * 130 +
          'ms" title="' +
          esc(s.does) +
          '"><span class="node-dot"></span><span class="node-n">' +
          String(i + 1).padStart(2, "0") +
          '</span><span class="node-t">' +
          esc(s.title || s.agent) +
          '</span><span class="node-c">' +
          (s.ran
            ? s.checks.filter((c) => c.ok).length + " of " + s.checks.length + " checks"
            : kind === "awaiting"
              ? "waiting on you"
              : "not reached") +
          "</span></button>"
        );
      })
      .join("") +
    '</div><p class="flow-say"><span><b>' +
    v.verified +
    " of " +
    v.of +
    "</b> agents verified &nbsp; <b>" +
    v.checks_passed +
    " of " +
    v.checks_run +
    "</b> checks passed &nbsp; <b>" +
    (path.queries || 0) +
    "</b> queries over " +
    fmt.format(path.rows || 0) +
    " rows</span>" +
    '<button class="ghost" id="stepwise">Open every check</button></p>';
  box.querySelectorAll(".node").forEach((b) =>
    b.addEventListener("click", () => window.showWorking(runId, b.dataset.a))
  );
  box.querySelector("#stepwise").addEventListener("click", () => window.showWorking(runId));
}

/* Numbers settle on their value rather than appearing from nowhere --------- */

function countUp() {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  screen.querySelectorAll("dd[data-to]").forEach((el) => {
    const to = Number(el.dataset.to);
    if (!isFinite(to) || to <= 0) return;
    const shape = el.dataset.fmt;
    const t0 = performance.now() + 120;
    const tick = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 620));
      const at = to * (1 - Math.pow(1 - k, 3));
      el.textContent =
        shape === "eur" ? eur(at) : shape === "two" ? at.toFixed(2) : fmt.format(Math.round(at));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function decideHtml() {
  return (
    '<div class="decide"><button class="go" id="approve">Approve and release</button>' +
    '<button class="ghost" id="edit">Request an edit</button>' +
    '<button class="ghost" id="reject">Hold and reject</button></div>' +
    '<form id="editForm" hidden><textarea id="editText" ' +
    'placeholder="What should change before this goes out?"></textarea>' +
    '<div class="decide" style="margin:0"><button class="go" type="submit">Send the edit</button>' +
    '<button class="ghost" type="button" id="editCancel">Cancel</button></div></form>'
  );
}

function signedHtml(ap, figures) {
  const word =
    ap.status === "approved"
      ? "Approved"
      : ap.status === "edited"
        ? "Edited and approved"
        : "Held";
  return (
    '<p class="signed"><b>' +
    word +
    " by " +
    esc(ap.reviewer || "an unnamed reviewer") +
    (ap.decided_at_utc ? " at " + esc(ap.decided_at_utc.slice(11, 16)) + " UTC" : "") +
    ".</b><span>" +
    (figures.released
      ? figures.released + " of " + figures.actions + " actions released."
      : "Nothing was released.") +
    (ap.reviewer_note ? " " + esc(ap.reviewer_note) : "") +
    "</span></p>"
  );
}

function wireDecide(eventId) {
  const send = async (action, body) => {
    screen.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await api("/runs/" + cache[eventId].run.run_id + "/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reviewer: REVIEWER, ...body }),
      });
    } catch (err) {
      return fail(err, "The decision was not recorded.");
    }
    await openCase(eventId);
  };
  document.getElementById("approve").addEventListener("click", () => send("approve"));
  document.getElementById("reject").addEventListener("click", () =>
    send("reject", { reviewer_note: "Held at the desk." })
  );
  document.getElementById("edit").addEventListener("click", () => {
    document.getElementById("editForm").hidden = false;
    document.getElementById("editText").focus();
  });
  document.getElementById("editCancel").addEventListener("click", () => {
    document.getElementById("editForm").hidden = true;
  });
  document.getElementById("editForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = document.getElementById("editText").value.trim();
    send("edit", { edits: text || null, reviewer_note: text || null });
  });
}

/* What was knowable, and when ----------------------------------------------- */

// The same question, asked again at each declared moment of the event. The
// chain fills in, and the exposure claim appears only once the footprint was
// published, because before that nobody had it.
async function drawTimeline(eventId) {
  const box = document.getElementById("timeline");
  if (!box) return;
  let data;
  try {
    data = await api("/desk/events/" + encodeURIComponent(eventId) + "/timeline");
  } catch (err) {
    box.innerHTML = '<p class="note warn">No replay: ' + esc(err.message) + "</p>";
    return;
  }
  box.innerHTML =
    '<div class="timeline">' +
    data.moments
      .map((m, i) => {
        if (m.error) {
          return '<button class="tm" disabled><b>' + esc(hhmm(m.replay_ts)) + "</b><i>" +
            esc(m.error) + "</i></button>";
        }
        const money = m.policies
          ? '<em class="has">' + m.policies + " sites, " + eur(m.sum_insured_eur) + "</em>"
          : '<em class="none">no exposure yet</em>';
        return (
          '<button class="tm" style="--d:' +
          i * 70 +
          'ms" data-i="' +
          i +
          '" aria-current="' +
          (i === data.moments.length - 1) +
          '"><b>' +
          esc(hhmm(m.replay_ts)) +
          "</b><i>" +
          esc(m.label) +
          "</i><em>" +
          m.links_supported +
          " of " +
          m.links +
          " links, " +
          m.anomalies +
          " anomalies</em>" +
          money +
          "</button>"
        );
      })
      .join("") +
    '</div><p class="note" id="tmNote"></p>';
  box.querySelectorAll(".tm[data-i]").forEach((b) =>
    b.addEventListener("click", () => {
      const m = data.moments[Number(b.dataset.i)];
      box.querySelectorAll(".tm").forEach((x) => x.setAttribute("aria-current", x === b));
      document.getElementById("tmNote").textContent =
        "At " + hhmm(m.replay_ts) + " UTC: " + (m.summary || "nothing could be stated yet.");
    })
  );
}

const hhmm = (ts) =>
  ts ? ts.slice(8, 10) + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(ts.slice(5, 7)) - 1] + " " + ts.slice(11, 16) : "—";

/* Ask something else --------------------------------------------------------- */

// The desk is event-first on purpose, so this is deliberately a secondary
// action: it is here to show what happens when the answer is no.
function askHtml(eventId) {
  return (
    '<details class="ask"><summary>Ask something else about this event</summary>' +
    '<form id="askForm"><input id="askText" ' +
    'placeholder="Which of our sites are at risk, and why?" />' +
    '<button class="ghost" type="submit">Ask</button></form>' +
    '<div id="askOut"></div></details>'
  );
}

function wireAsk(eventId) {
  const form = document.getElementById("askForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = document.getElementById("askText").value.trim();
    const out = document.getElementById("askOut");
    if (!q) return;
    out.innerHTML = '<p class="note">Asking\u2026</p>';
    let run;
    try {
      run = await api("/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, event_id: eventId }),
      });
    } catch (err) {
      out.innerHTML = '<p class="note warn">' + esc(err.message) + "</p>";
      return;
    }
    if (run.status === "out_of_scope") {
      out.innerHTML =
        '<div class="declined" style="margin-top:14px"><h1>No.</h1><p>' +
        esc((run.scope && run.scope.reason) || run.summary) +
        "</p></div>";
      return;
    }
    out.innerHTML =
      '<p class="note">Answered. ' +
      esc(run.summary || "") +
      '</p>';
  });
}

/* What an approval produces ------------------------------------------------ */

function artifactsHtml(run) {
  return (
    '<h2 class="sec">What this produced</h2><div class="outs">' +
    '<div class="out"><b>Messages to policyholders</b>' +
    "<small>The approved wording, one per exposed site, largest first. " +
    "Nothing is sent from here.</small>" +
    '<button id="showMsgs">Show them</button></div>' +
    '<div class="out"><b>Exposed policy list</b>' +
    "<small>CSV for the claims system, carrying who approved it and when.</small>" +
    '<a class="btn" href="/runs/' +
    esc(run.run_id) +
    '/exposure.csv">Download CSV</a></div>' +
    '<div class="out"><b>Decision record</b>' +
    "<small>The answer, its sources, the scores and the signature. Printable.</small>" +
    '<a class="btn" href="#/case/' +
    esc(run.event_id) +
    '/record">Open record</a></div>' +
    '<div class="out"><b>Send to your systems</b>' +
    '<small id="dispatchWhy">Checking whether an endpoint is set…</small>' +
    '<button id="dispatch" disabled>Post the decision</button></div>' +
    '</div><div id="msgs"></div><div id="dispatchOut"></div>'
  );
}

function wireArtifacts(eventId, run) {
  document.getElementById("showMsgs").addEventListener("click", async (e) => {
    const box = document.getElementById("msgs");
    if (box.innerHTML) {
      box.innerHTML = "";
      e.target.textContent = "Show them";
      return;
    }
    let data;
    try {
      data = await api("/runs/" + run.run_id + "/outbound");
    } catch (err) {
      box.innerHTML = '<p class="note warn">' + esc(err.message) + "</p>";
      return;
    }
    e.target.textContent = "Hide them";
    box.innerHTML =
      '<p class="note">' +
      data.messages.length +
      " messages. Copy each one into whatever actually sends it.</p>" +
      data.messages
        .map(
          (m) =>
            '<div class="msg"><h4>' +
            esc(m.policy_id) +
            " · " +
            esc(m.segment) +
            " · " +
            eur(m.sum_insured_eur) +
            "</h4><pre>" +
            esc(m.subject) +
            "\n\n" +
            esc(m.body) +
            "</pre></div>"
        )
        .join("");
  });

  const btn = document.getElementById("dispatch");
  const why = document.getElementById("dispatchWhy");
  api("/desk/dispatch-target")
    .then((t) => {
      if (t.configured) {
        why.textContent = "Posts the decision to " + t.target + ". Asks before it does.";
        btn.disabled = false;
      } else {
        why.textContent =
          "No endpoint is set, so this is off. Set DECISION_WEBHOOK to switch it on.";
      }
    })
    .catch(() => {
      why.textContent = "Could not tell whether an endpoint is set, so this stays off.";
    });

  btn.addEventListener("click", async () => {
    const t = await api("/desk/dispatch-target").catch(() => ({}));
    if (!confirm("Post this decision to " + t.target + "?")) return;
    btn.disabled = true;
    const out = document.getElementById("dispatchOut");
    try {
      const res = await api("/runs/" + run.run_id + "/dispatch", { method: "POST" });
      out.innerHTML =
        '<p class="note' +
        (res.sent ? "" : " warn") +
        '">' +
        (res.sent
          ? "Posted, and the endpoint answered " + res.status + "."
          : "Not posted: " + esc(res.reason)) +
        "</p>";
    } catch (err) {
      out.innerHTML = '<p class="note warn">Not posted: ' + esc(err.message) + "</p>";
    }
  });
}

/* The working, folded away -------------------------------------------------- */

function workingHtml(run) {
  const j = run.judge_summary || {};
  return (
    '<details class="work"><summary>Show the working</summary><div class="work-body">' +
    '<h2 class="sec">How the chain was checked</h2><ol class="chain">' +
    (run.hypotheses || [])
      .map(
        (h) =>
          "<li><b>" +
          esc(h.id) +
          "</b><p>" +
          esc(h.statement) +
          "</p><em>" +
          esc(h.status) +
          (h.rounds ? ", " + h.rounds + " counter-checks" : "") +
          "</em></li>"
      )
      .join("") +
    '</ol><h2 class="sec" style="margin-top:22px">Checked</h2><table class="ledger"><tbody>' +
    [
      ["Overall", j.overall == null ? "—" : j.overall.toFixed(2)],
      ["Claims scored", j.n_claims == null ? "—" : j.n_claims],
      ["Unsupported", j.hallucination_rate == null ? "—" : pct(j.hallucination_rate)],
      ["Citation coverage", j.citation_coverage == null ? "—" : pct(j.citation_coverage)],
      ["Numbers matched", j.numeric_accuracy == null ? "—" : pct(j.numeric_accuracy)],
    ]
      .map((r) => "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>")
      .join("") +
    '</tbody></table><h2 class="sec" style="margin-top:22px">Every claim, with its source</h2>' +
    '<ul class="claims">' +
    (run.claims || [])
      .map(
        (c) =>
          "<li><b>" +
          esc(c.claim_id) +
          "</b>" +
          esc(c.text) +
          "<span>" +
          (c.citations || [])
            .map((ct) => esc(ct.title || ct.publisher || "source"))
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(", ") +
          "</span></li>"
      )
      .join("") +
    "</ul></div></details>"
  );
}

const pct = (x) => Math.round(x * 100) + "%";

// GAMEPLAN: cached or replayed output is never presented as live. The service
// decides the wording; this only renders it.
const stale = (body) =>
  body && body.label && body.label.live === false
    ? '<p class="stale">' + esc(body.label.text) + "</p>"
    : "";

// A query that failed means the answer above it is standing on a hole. The
// reviewer decides knowing that, or not at all.
const holes = (run) => {
  const f = (run && run.failures) || [];
  if (!f.length) return "";
  const views = [...new Set(f.map((x) => x.view || "a view"))].join(", ");
  return (
    '<p class="broken"><b>' +
    f.length +
    (f.length === 1 ? " query failed" : " queries failed") +
    " (" +
    esc(views) +
    "). </b>Anything below is missing whatever those queries would have returned. " +
    esc(f[0].error || "") +
    "</p>"
  );
};

/* Record --------------------------------------------------------------------- */

async function record(eventId) {
  crumbs.innerHTML =
    '<a href="#/">Desk</a><i>/</i><a href="#/case/' +
    esc(eventId) +
    '">' +
    esc(eventId) +
    "</a><i>/</i><span>Record</span>";
  screen.innerHTML = '<p class="loading">Loading the record…</p>';
  let runId = cache[eventId] && cache[eventId].run.run_id;
  try {
    if (!runId) {
      const c = await api("/desk/events/" + encodeURIComponent(eventId));
      cache[eventId] = c;
      runId = c.run.run_id;
    }
    const r = await api("/runs/" + runId + "/record");
    drawRecord(r);
  } catch (err) {
    fail(err, "The record could not be loaded.");
  }
}

function drawRecord(r) {
  screen.className = "";
  const ap = r.approval || {};
  const j = r.judge_summary || {};
  screen.innerHTML =
    '<div class="record">' +
    stale(r) +
    '<h1>Decision record</h1><p class="meta">' +
    esc((r.event && r.event.name) || r.event_id) +
    " · run " +
    esc(r.run_id) +
    " · drawn " +
    esc(r.generated_at) +
    "</p>" +
    '<button class="ghost noprint" style="margin-top:16px" onclick="window.print()">Print</button>' +
    "<h2>Decision</h2><p>" +
    esc(ap.status || "not reached") +
    " by " +
    esc(ap.reviewer || "an unnamed reviewer") +
    (ap.decided_at_utc ? " at " + esc(ap.decided_at_utc) : "") +
    "." +
    (ap.reviewer_note ? " " + esc(ap.reviewer_note) : "") +
    "</p>" +
    "<h2>Exposure</h2><p>" +
    r.figures.policies +
    " policies, " +
    eur(r.figures.sum_insured_eur) +
    " sum insured, inside the mapped footprint.</p>" +
    "<h2>Answer</h2><p>" +
    esc(r.summary || "") +
    "</p>" +
    "<h2>Actions</h2><ul>" +
    (r.playbook || [])
      .map(
        (a) =>
          "<li>" +
          esc(a.action_id) +
          ", within " +
          a.horizon_h +
          " h, " +
          (a.released ? "released" : "held") +
          ". " +
          esc(a.text) +
          "</li>"
      )
      .join("") +
    "</ul><h2>Claims and sources</h2><ul>" +
    (r.claims || [])
      .map((c) => "<li>" + esc(c.claim_id) + ". " + esc(c.text) + "</li>")
      .join("") +
    "</ul><h2>Sources and licences</h2><ul>" +
    (r.sources || [])
      .map(
        (s) =>
          "<li>" +
          esc(s.publisher || "unknown publisher") +
          " — " +
          esc(s.licence || "no licence recorded") +
          (s.source_url ? " — " + esc(s.source_url) : "") +
          "</li>"
      )
      .join("") +
    "</ul><h2>Checks</h2><p>Overall " +
    (j.overall == null ? "—" : j.overall.toFixed(2)) +
    " over " +
    (j.n_claims || 0) +
    " claims. Citation coverage " +
    (j.citation_coverage == null ? "—" : pct(j.citation_coverage)) +
    ", numbers matched " +
    (j.numeric_accuracy == null ? "—" : pct(j.numeric_accuracy)) +
    ".</p><h2>Definitions in force</h2><ul>" +
    (r.definitions || [])
      .map((d) => "<li>" + esc(d.term) + ": " + esc(d.wording) + "</li>")
      .join("") +
    "</ul></div>";
}

/* Routing ---------------------------------------------------------------------- */

function route() {
  const parts = (location.hash || "#/").slice(2).split("/").filter(Boolean);
  if (parts[0] === "case" && parts[1]) {
    if (parts[2] === "record") return record(parts[1]);
    return openCase(parts[1]);
  }
  return desk();
}

window.addEventListener("hashchange", route);
route();
