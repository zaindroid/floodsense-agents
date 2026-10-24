// Readiness overlay. One script tag on any page:
//   <script src="/mock/readiness.js"></script>
// Adds a trigger, and on open fetches /readiness and draws the eight
// foundations as a staircase with the agents that stand on each one.
// It never invents a result: if the endpoint cannot be reached it says so.
(function () {
  "use strict";

  const ENDPOINT = "/readiness";
  const STATUS_WORD = { pass: "holds", partial: "partly", fail: "does not hold", unknown: "no run" };

  const css = `
.rdy-open{position:fixed;right:20px;bottom:20px;z-index:9998;font:500 14px Archivo,
  "Helvetica Neue",Arial,sans-serif;padding:10px 16px;border-radius:3px;border:1px solid #1b1f24;
  background:#1b1f24;color:#fafaf8;cursor:pointer}
.rdy-open:hover{background:#000}
.rdy-open b{font-weight:600}
.rdy-scrim{position:fixed;inset:0;z-index:9999;background:rgba(20,22,26,.55);
  display:flex;align-items:center;justify-content:center;padding:24px}
.rdy[hidden],.rdy-scrim[hidden]{display:none}
.rdy{background:#fafaf8;color:#1b1f24;font:15px/1.5 Archivo,"Helvetica Neue",Arial,sans-serif;
  font-variant-numeric:tabular-nums;width:min(1140px,100%);max-height:100%;overflow:auto;
  border-radius:4px}
.rdy *{box-sizing:border-box}
.rdy-head{display:flex;align-items:baseline;gap:18px;padding:18px 24px 14px;
  border-bottom:1px solid #1b1f24;position:sticky;top:0;background:#fafaf8;z-index:2}
.rdy-title{font-size:16px;font-weight:600;margin:0}
.rdy-title span{font-weight:400;color:#5c636c}
.rdy-score{margin-left:auto;font-size:14px;color:#5c636c}
.rdy-score b{font-size:19px;font-weight:600;color:#1b1f24}
.rdy-close{font:inherit;font-size:14px;background:none;border:0;border-bottom:1px solid #dcdcd6;
  color:#5c636c;padding:0;cursor:pointer}
.rdy-close:hover{color:#1b1f24;border-bottom-color:#1b1f24}
.rdy-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:0 36px;
  padding:20px 24px}
.rdy-body>*{min-width:0}
.rdy-top{font-size:12px;color:#5c636c;margin:0 0 10px;padding-left:var(--tread,0)}
.rdy-stairs{list-style:none;margin:0;padding:0}
.rdy-step{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;
  cursor:pointer;border:1px solid #dcdcd6;border-left-width:3px;background:#f2f2ee;
  padding:9px 12px;margin-bottom:3px}
.rdy-step:hover{background:#e9e9e3}
.rdy-step[aria-current=true]{background:#fff;border-color:#1b1f24;border-left-width:3px}
.rdy-step.pass{border-left-color:#40674f}
.rdy-step.partial{border-left-color:#9a6b1f}
.rdy-step.fail{border-left-color:#8c3b3b}
.rdy-step.unknown{border-left-color:#b6b6b0}
.rdy-step.lit{outline:2px solid #35607a;outline-offset:1px}
.rdy-n{font-size:12.5px;color:#5c636c;font-weight:600;flex:none;width:1.5rem}
.rdy-name{font-size:14.5px;flex:1}
.rdy-state{font-size:11.5px;color:#5c636c;flex:none}
.rdy-step.pass .rdy-state{color:#40674f}
.rdy-step.partial .rdy-state{color:#9a6b1f}
.rdy-step.fail .rdy-state{color:#8c3b3b}
.rdy-base{font-size:12px;color:#5c636c;margin-top:10px;border-top:1px solid #1b1f24;padding-top:8px}
.rdy-asks{font-size:17px;line-height:1.4;margin:0 0 14px;max-width:46ch}
.rdy-detail h3{font-size:12px;font-weight:600;color:#5c636c;margin:18px 0 6px}
.rdy-check{display:grid;grid-template-columns:14px 1fr;gap:9px;padding:8px 0;
  border-top:1px solid #dcdcd6;align-items:start}
.rdy-mark{width:9px;height:9px;margin-top:5px;border-radius:50%;border:1px solid #5c636c}
.rdy-mark.ok{background:#40674f;border-color:#40674f}
.rdy-mark.no{background:#8c3b3b;border-color:#8c3b3b}
.rdy-check-name{font-size:14px}
.rdy-check-detail{font-size:12.5px;color:#5c636c;margin-top:2px}
.rdy-gap{font-size:13px;line-height:1.5;border-left:2px solid #9a6b1f;padding:2px 0 2px 10px;
  margin-top:6px}
.rdy-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.rdy-chip{font-size:12px;padding:1px 8px;border:1px solid #dcdcd6;border-radius:999px;color:#5c636c}
.rdy-agents{padding:4px 24px 22px}
.rdy-agents h3{font-size:12px;font-weight:600;color:#5c636c;margin:0 0 6px;
  border-top:1px solid #1b1f24;padding-top:12px}
.rdy-table{width:100%;border-collapse:collapse;font-size:13.5px}
.rdy-table th{font-weight:400;font-size:11.5px;color:#5c636c;text-align:left;padding:6px 10px 4px 0}
.rdy-table td{padding:7px 10px 7px 0;border-top:1px solid #dcdcd6;vertical-align:top}
.rdy-table tbody tr{cursor:pointer}
.rdy-table tbody tr:hover{background:#f2f2ee}
.rdy-table tbody tr[aria-current=true]{background:#fff;box-shadow:inset 2px 0 0 #35607a}
.rdy-agent{font-weight:500}
.rdy-does{color:#5c636c;font-size:12.5px}
.rdy-rungs{white-space:nowrap;color:#5c636c;font-size:12.5px}
.rdy-idle{color:#9a6b1f}
.rdy-msg{padding:28px 24px;font-size:15px;line-height:1.6;color:#5c636c;max-width:62ch}
.rdy-msg code{font-size:13px;background:#f2f2ee;padding:1px 5px}
@media (max-width:900px){.rdy-body{grid-template-columns:1fr;gap:20px}}
`;

  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  let data = null;
  let picked = 0;
  let litAgent = null;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  const style = el("style");
  style.textContent = css;
  document.head.appendChild(style);

  const trigger = el("button", "rdy-open", "Readiness");
  const scrim = el("div", "rdy-scrim");
  scrim.hidden = true;
  const panel = el("div", "rdy");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Readiness: the eight foundations under the agents");
  panel.tabIndex = -1;
  scrim.appendChild(panel);

  document.addEventListener("DOMContentLoaded", () => {
    document.body.appendChild(trigger);
    document.body.appendChild(scrim);
  });

  function close() {
    scrim.hidden = true;
    trigger.focus();
  }

  trigger.addEventListener("click", open);
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !scrim.hidden) close();
  });

  async function open() {
    scrim.hidden = false;
    panel.focus();
    if (!data) {
      panel.innerHTML = '<div class="rdy-msg">Checking the foundations…</div>';
      try {
        const res = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error("the service answered " + res.status);
        data = await res.json();
      } catch (err) {
        panel.innerHTML =
          '<div class="rdy-head"><h2 class="rdy-title">Readiness</h2>' +
          '<button class="rdy-close">Close</button></div>' +
          '<div class="rdy-msg">No report, because <code>' +
          esc(ENDPOINT) +
          "</code> could not be reached: " +
          esc(err.message) +
          ". This page is showing you nothing rather than a guess. Open it from the running " +
          "service and the eight checks will run against the newest run.</div>";
        panel.querySelector(".rdy-close").addEventListener("click", close);
        return;
      }
      picked = Math.max(
        0,
        data.rungs.findIndex((r) => r.status !== "pass")
      );
    }
    draw();
  }

  function draw() {
    const r = data.rungs[picked];
    panel.innerHTML =
      '<div class="rdy-head"><h2 class="rdy-title">Readiness <span>— what the agents stand on' +
      "</span></h2>" +
      '<span class="rdy-score"><b>' +
      data.passed +
      " of " +
      data.of +
      "</b> foundations hold" +
      (data.run_id ? ", from run " + esc(data.run_id) : ", with no run yet") +
      "</span>" +
      '<button class="rdy-close">Close</button></div>' +
      '<div class="rdy-body"><div><p class="rdy-top">AI agents sit on top of these.</p>' +
      '<ul class="rdy-stairs">' +
      data.rungs
        .map((g, i) => stepHtml(g, i, data.rungs.length))
        .reverse()
        .join("") +
      '</ul><p class="rdy-base">Every company climbs the same stairs. ' +
      esc(data.schema) +
      (data.live_data ? ", live data" : ", seed data") +
      "</p></div>" +
      '<div class="rdy-detail">' +
      detailHtml(r) +
      "</div></div>" +
      '<div class="rdy-agents"><h3>Agents, and the foundations each one leans on</h3>' +
      agentsHtml() +
      "</div>";

    panel.querySelector(".rdy-close").addEventListener("click", close);
    panel.querySelectorAll(".rdy-step").forEach((b) =>
      b.addEventListener("click", () => {
        picked = Number(b.dataset.i);
        litAgent = null;
        draw();
      })
    );
    panel.querySelectorAll("tbody tr").forEach((row) =>
      row.addEventListener("click", () => {
        litAgent = litAgent === row.dataset.agent ? null : row.dataset.agent;
        draw();
      })
    );
  }

  function stepHtml(g, i, n) {
    const lit = litAgent && g.agents.indexOf(litAgent) !== -1;
    // Each tread sits a little further right, so the list reads as stairs.
    const indent = Math.round((i / (n - 1)) * 86);
    return (
      '<li><button class="rdy-step ' +
      g.status +
      (lit ? " lit" : "") +
      '" data-i="' +
      i +
      '" aria-current="' +
      (i === picked) +
      '" style="margin-left:' +
      indent +
      'px;width:calc(100% - ' +
      indent +
      'px)">' +
      '<span class="rdy-n">' +
      String(g.n).padStart(2, "0") +
      '</span><span class="rdy-name">' +
      esc(g.name) +
      '</span><span class="rdy-state">' +
      (STATUS_WORD[g.status] || g.status) +
      "</span></button></li>"
    );
  }

  function detailHtml(g) {
    if (!g) return "";
    const bad = g.checks.filter((c) => !c.ok).length;
    return (
      '<p class="rdy-asks">' +
      esc(g.asks) +
      "</p>" +
      "<h3>" +
      (g.checks.length - bad) +
      " of " +
      g.checks.length +
      " checks pass</h3>" +
      g.checks
        .map(
          (c) =>
            '<div class="rdy-check"><span class="rdy-mark ' +
            (c.ok ? "ok" : "no") +
            '"></span><span><span class="rdy-check-name">' +
            esc(c.name) +
            '</span><span class="rdy-check-detail">' +
            esc(c.detail) +
            "</span></span></div>"
        )
        .join("") +
      (g.gaps.length
        ? "<h3>" +
          g.gaps.length +
          " to fix</h3>" +
          g.gaps.map((x) => '<p class="rdy-gap">' + esc(x) + "</p>").join("")
        : "") +
      '<h3>Agents on this foundation</h3><div class="rdy-chips">' +
      g.agents.map((a) => '<span class="rdy-chip">' + esc(a) + "</span>").join("") +
      "</div>"
    );
  }

  function agentsHtml() {
    return (
      '<table class="rdy-table"><thead><tr><th>Agent</th><th>Lane</th><th>In the last run</th>' +
      "<th>Verified by</th></tr></thead><tbody>" +
      data.agents
        .map(
          (a) =>
            '<tr data-agent="' +
            esc(a.agent) +
            '" aria-current="' +
            (litAgent === a.agent) +
            '"><td><span class="rdy-agent">' +
            esc(a.agent) +
            '</span><div class="rdy-does">' +
            esc(a.does) +
            "</div></td><td>" +
            esc(a.lane || "—") +
            "</td><td>" +
            (a.ran
              ? esc(a.summary) +
                (a.evidence ? ' <span class="rdy-does">(' + a.evidence + " queries)</span>" : "")
              : '<span class="rdy-idle">not reached in this run</span>') +
            '</td><td class="rdy-rungs">' +
            a.rungs.map((n) => String(n).padStart(2, "0")).join("  ") +
            "</td></tr>"
        )
        .join("") +
      "</tbody></table>"
    );
  }
})();
