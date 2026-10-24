// Agent working. A separate overlay from the readiness staircase: that one
// asks whether the foundations hold, this one asks whether each agent did
// what it says it did, step by step, and which data path it used.
//
// Opened with window.showWorking(runId). Everything shown comes from
// /runs/{id}/verify; if that cannot be read, it says so and draws nothing.
(function () {
  "use strict";

  const WORD = {
    verified: "verified",
    partial: "partly verified",
    failed: "not verified",
    "not reached": "not reached",
    unknown: "no checks",
  };

  const css = `
.vfy-scrim{position:fixed;inset:0;z-index:9999;background:rgba(20,22,26,.55);
  display:flex;align-items:center;justify-content:center;padding:24px}
.vfy-scrim[hidden]{display:none}
.vfy{background:var(--paper,#fafaf8);color:var(--ink,#1b1f24);width:min(1080px,100%);
  max-height:100%;overflow:auto;border-radius:4px;
  font:15px/1.5 Archivo,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.vfy *{box-sizing:border-box}
.vfy-head{display:flex;align-items:baseline;gap:16px;padding:18px 24px 14px;
  border-bottom:1px solid var(--ink,#1b1f24);position:sticky;top:0;background:var(--paper,#fafaf8);z-index:2}
.vfy-head h2{margin:0;font-size:16px;font-weight:600}
.vfy-head h2 span{font-weight:400;color:var(--soft,#5c636c)}
.vfy-score{margin-left:auto;font-size:13.5px;color:var(--soft,#5c636c)}
.vfy-score b{font-size:18px;color:var(--ink,#1b1f24)}
.vfy-x{font:inherit;font-size:14px;background:none;border:0;border-bottom:1px solid var(--rule,#dcdcd6);
  color:var(--soft,#5c636c);padding:0;cursor:pointer}
.vfy-x:hover{color:var(--ink,#1b1f24);border-bottom-color:var(--ink,#1b1f24)}
.vfy-path{margin:18px 24px 0;padding:12px 14px;border-left:3px solid var(--go,#40674f);
  background:var(--wash,#f2f2ee);font-size:14px;line-height:1.5}
.vfy-path.off{border-left-color:var(--hold,#9a6b1f)}
.vfy-path b{display:block;font-size:14.5px;margin-bottom:3px}
.vfy-path dl{display:flex;flex-wrap:wrap;gap:14px;margin:9px 0 0;font-size:12.5px;
  color:var(--soft,#5c636c)}
.vfy-path dl div{display:flex;gap:5px}
.vfy-path dd{margin:0;color:var(--ink,#1b1f24)}
.vfy-body{display:grid;grid-template-columns:minmax(0,240px) minmax(0,1fr);gap:0 28px;padding:18px 24px 24px}
.vfy-pipe{list-style:none;margin:0;padding:0}
.vfy-pipe li{margin-bottom:2px}
.vfy-agent{display:flex;align-items:center;gap:9px;width:100%;text-align:left;font:inherit;
  cursor:pointer;border:1px solid var(--rule,#dcdcd6);border-left-width:3px;
  background:var(--wash,#f2f2ee);padding:9px 11px}
.vfy-agent:hover{background:#e9e9e3}
.vfy-agent[aria-current=true]{background:#fff;border-color:var(--ink,#1b1f24);border-left-width:3px}
.vfy-agent.verified{border-left-color:var(--go,#40674f)}
.vfy-agent.partial{border-left-color:var(--hold,#9a6b1f)}
.vfy-agent.failed{border-left-color:var(--stop,#8c3b3b)}
.vfy-agent\\.not{border-left-color:#b6b6b0}
.vfy-agent.notreached{border-left-color:#b6b6b0}
.vfy-nm{flex:1;font-size:14px}
.vfy-ct{font-size:11.5px;color:var(--soft,#5c636c)}
.vfy-agent.verified .vfy-ct{color:var(--go,#40674f)}
.vfy-agent.partial .vfy-ct,.vfy-agent.failed .vfy-ct{color:var(--hold,#9a6b1f)}
.vfy-does{font-size:16.5px;line-height:1.4;margin:0 0 4px;max-width:52ch}
.vfy-sum{font-size:13px;color:var(--soft,#5c636c);margin:0 0 14px}
.vfy h3{font-size:12px;font-weight:600;color:var(--soft,#5c636c);margin:18px 0 6px}
.vfy-made{display:flex;flex-wrap:wrap;gap:18px;margin:0}
.vfy-made div{display:flex;flex-direction:column}
.vfy-made dt{order:2;font-size:11.5px;color:var(--soft,#5c636c)}
.vfy-made dd{margin:0;font-size:18px;font-weight:500}
.vfy-chk{display:grid;grid-template-columns:13px 1fr;gap:9px;padding:8px 0;
  border-top:1px solid var(--rule,#dcdcd6);align-items:start}
.vfy-dot{width:9px;height:9px;margin-top:5px;border-radius:50%;border:1px solid var(--soft,#5c636c)}
.vfy-dot.ok{background:var(--go,#40674f);border-color:var(--go,#40674f)}
.vfy-dot.no{background:var(--stop,#8c3b3b);border-color:var(--stop,#8c3b3b)}
.vfy-chk b{font-size:14px;font-weight:400;display:block}
.vfy-chk span{font-size:12.5px;color:var(--soft,#5c636c)}
.vfy-q{border-top:1px solid var(--rule,#dcdcd6);padding:8px 0}
.vfy-q summary{cursor:pointer;font-size:13px;display:flex;gap:10px;align-items:baseline;
  list-style:none}
.vfy-q summary::-webkit-details-marker{display:none}
.vfy-q summary b{font-weight:500}
.vfy-q summary i{font-style:normal;color:var(--soft,#5c636c);margin-left:auto;font-size:12px}
.vfy-q summary i.fake{color:var(--hold,#9a6b1f)}
.vfy-q pre{margin:8px 0 2px;padding:8px 10px;background:var(--wash,#f2f2ee);font:inherit;
  font-size:12.5px;white-space:pre-wrap;color:var(--soft,#5c636c);line-height:1.5}
.vfy-msg{padding:28px 24px;font-size:15px;line-height:1.6;color:var(--soft,#5c636c);max-width:60ch}
@media (max-width:820px){.vfy-body{grid-template-columns:1fr;gap:18px}}
`;

  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const scrim = document.createElement("div");
  scrim.className = "vfy-scrim";
  scrim.hidden = true;
  const panel = document.createElement("div");
  panel.className = "vfy";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Agent working, step by step");
  panel.tabIndex = -1;
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  let data = null;
  let picked = 0;

  function close() {
    scrim.hidden = true;
  }

  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !scrim.hidden) close();
  });

  window.showWorking = async function (runId) {
    scrim.hidden = false;
    panel.focus();
    panel.innerHTML = '<div class="vfy-msg">Checking every step…</div>';
    try {
      const res = await fetch("/runs/" + encodeURIComponent(runId) + "/verify", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("the service answered " + res.status);
      data = await res.json();
    } catch (err) {
      panel.innerHTML =
        '<div class="vfy-head"><h2>Agent working</h2>' +
        '<button class="vfy-x">Close</button></div><div class="vfy-msg">Nothing to show: ' +
        esc(err.message) +
        ". This panel reports what the service measured, so with no answer it shows " +
        "nothing rather than a guess.</div>";
      panel.querySelector(".vfy-x").addEventListener("click", close);
      return;
    }
    const bad = data.steps.findIndex((s) => s.status !== "verified");
    picked = bad === -1 ? 0 : bad;
    draw();
  };

  function draw() {
    const s = data.steps[picked];
    const p = data.data_path;
    panel.innerHTML =
      '<div class="vfy-head"><h2>Agent working <span>— every step, against the run\'s own ' +
      'record</span></h2><span class="vfy-score"><b>' +
      data.verified +
      " of " +
      data.of +
      "</b> agents verified, " +
      data.checks_passed +
      " of " +
      data.checks_run +
      ' checks</span><button class="vfy-x">Close</button></div>' +
      pathHtml(p) +
      '<div class="vfy-body"><ul class="vfy-pipe">' +
      data.steps.map(agentHtml).join("") +
      "</ul>" +
      stepHtml(s) +
      "</div>";
    panel.querySelector(".vfy-x").addEventListener("click", close);
    panel.querySelectorAll(".vfy-agent").forEach((b) =>
      b.addEventListener("click", () => {
        picked = Number(b.dataset.i);
        draw();
      })
    );
  }

  function pathHtml(p) {
    const ok = p.reached_zetaris;
    return (
      '<div class="vfy-path' +
      (ok ? "" : " off") +
      '"><b>' +
      esc(p.verdict) +
      "</b>" +
      (ok
        ? "The agents read the contract views over Zetaris."
        : "The SQL and the four contract views are the same either way, so this is a " +
          "credentials switch, not a rewrite. It is not Zetaris today.") +
      '<dl><div><dt>mode</dt><dd>' +
      esc(p.configured_mode) +
      "</dd></div><div><dt>REST url set</dt><dd>" +
      (p.rest_url_set ? "yes" : "no") +
      "</dd></div><div><dt>schema</dt><dd>" +
      esc(p.schema) +
      "</dd></div><div><dt>queries</dt><dd>" +
      p.queries +
      "</dd></div><div><dt>rows</dt><dd>" +
      p.rows +
      "</dd></div><div><dt>errors</dt><dd>" +
      p.errors +
      "</dd></div></dl></div>"
    );
  }

  function agentHtml(s, i) {
    const cls = s.status === "not reached" ? "notreached" : s.status;
    const n = s.checks.filter((c) => c.ok).length;
    return (
      '<li><button class="vfy-agent ' +
      cls +
      '" data-i="' +
      i +
      '" aria-current="' +
      (i === picked) +
      '"><span class="vfy-nm">' +
      esc(s.agent) +
      '</span><span class="vfy-ct">' +
      (s.ran ? n + "/" + s.checks.length : "—") +
      "</span></button></li>"
    );
  }

  function stepHtml(s) {
    if (!s) return "<div></div>";
    const made = Object.entries(s.produced || {}).filter(([, v]) => v != null && v !== "");
    return (
      '<div><p class="vfy-does">' +
      esc(s.does) +
      '</p><p class="vfy-sum">' +
      (s.ran
        ? esc(s.summary) +
          (s.lane ? " · " + esc(s.lane) + " lane" : "") +
          (s.model_id ? " · " + esc(s.model_id) : "") +
          (s.latency_ms != null ? " · " + s.latency_ms + " ms" : "")
        : "<b>" + WORD[s.status] + ".</b> " + esc(s.summary)) +
      "</p>" +
      (made.length
        ? "<h3>What it produced</h3><dl class=\"vfy-made\">" +
          made
            .map(
              ([k, v]) =>
                "<div><dd>" +
                esc(Array.isArray(v) ? v.length || "none" : v) +
                "</dd><dt>" +
                esc(k.replace(/_/g, " ")) +
                "</dt></div>"
            )
            .join("") +
          "</dl>"
        : "") +
      (s.checks.length
        ? "<h3>" +
          s.checks.filter((c) => c.ok).length +
          " of " +
          s.checks.length +
          " checks pass</h3>" +
          s.checks
            .map(
              (c) =>
                '<div class="vfy-chk"><span class="vfy-dot ' +
                (c.ok ? "ok" : "no") +
                '"></span><span><b>' +
                esc(c.name) +
                "</b><span>" +
                esc(c.detail) +
                "</span></span></div>"
            )
            .join("")
        : "") +
      (s.queries.length
        ? "<h3>" + s.queries.length + " queries it ran</h3>" + s.queries.map(queryHtml).join("")
        : "") +
      "</div>"
    );
  }

  function queryHtml(q) {
    if (!q.resolved) {
      return (
        '<div class="vfy-q"><summary><b>' +
        esc(q.query_id) +
        "</b> not in the record</summary></div>"
      );
    }
    const fake = q.source !== "zetaris";
    return (
      '<details class="vfy-q"><summary><b>' +
      esc((q.views && q.views[0]) || q.view) +
      "</b><span>" +
      q.rows +
      " rows</span>" +
      (q.error ? '<span style="color:var(--stop,#8c3b3b)">' + esc(q.error) + "</span>" : "") +
      '<i class="' +
      (fake ? "fake" : "") +
      '">' +
      esc(q.source) +
      "</i></summary><pre>" +
      esc(q.sql) +
      "</pre></details>"
    );
  }
})();
