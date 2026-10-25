// Agent trace. Opened with window.showWorking(runId, agent) from the chain on
// the case screen. Everything shown comes from /runs/{id}/verify; if that
// cannot be read, it says so and draws nothing.
//
// It is a layer over the case rather than a screen of its own, so it keeps the
// app's paper and type and docks to the edge, leaving the case in view. One
// step opens at a time: a reviewer reads one step at a time, and the panel at
// rest is seven lines, not seven screens of prose.
(function () {
  "use strict";

  const svg = (body, size) =>
    '<svg viewBox="0 0 20 20" width="' +
    (size || 18) +
    '" height="' +
    (size || 18) +
    '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    body +
    "</svg>";

  // One mark per agent, drawn from what the agent does.
  const ICON = {
    watchers: '<path d="M3 15a7 7 0 0 1 14 0"/><path d="M6.5 15a3.5 3.5 0 0 1 7 0"/>' +
      '<circle cx="10" cy="15" r=".9"/>',
    investigator: '<circle cx="9" cy="9" r="5"/><path d="M12.8 12.8 17 17"/>',
    skeptic: '<path d="M3.5 7.5h10l-2.5-2.5"/><path d="M16.5 12.5h-10l2.5 2.5"/>',
    exposure: '<circle cx="8" cy="10" r="4.6"/><circle cx="12" cy="10" r="4.6"/>',
    playbook: '<rect x="4" y="3.5" width="12" height="13" rx="1.5"/>' +
      '<path d="M7 7.5h6M7 10.5h6M7 13.5h3.5"/>',
    judge: '<path d="M10 4.5v11"/><path d="M4.5 7.5h11"/><path d="M4.5 7.5 2.5 12h4z"/>' +
      '<path d="M15.5 7.5 13.5 12h4z"/><path d="M7 16h6"/>',
    hitl: '<circle cx="10" cy="7" r="2.6"/><path d="M4.5 16c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6"/>',
  };
  const TICK = '<path d="M4 10.5 8 14.5 16 6"/>';
  const CROSS = '<path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"/>';
  const CHEVRON = '<path d="M6.5 8.5 10 12l3.5-3.5"/>';
  const STORE = '<ellipse cx="10" cy="5.5" rx="6" ry="2.5"/>' +
    '<path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9"/>';
  const ARROW = '<path d="M3.5 10h13l-3.5-3.5M16.5 10 13 13.5"/>';
  const LOOP = '<path d="M16 10a6 6 0 1 1-2-4.5"/><path d="M16.5 3v3.5H13"/>';
  const TRACE = '<path d="M3 15.5h4l3-11 3 7 2-3h2"/>';

  const css = `
.vfy-scrim{position:fixed;inset:0;z-index:9999;background:rgba(27,31,36,.3);
  display:flex;justify-content:flex-end}
.vfy-scrim[hidden]{display:none}
.vfy{background:#fff;color:var(--ink,#1b1f24);width:min(600px,100%);height:100%;overflow:auto;
  border-left:1px solid var(--ink,#1b1f24);
  font:15px/1.5 Archivo,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums;
  animation:vfyDock .3s cubic-bezier(.2,.7,.3,1) both}
.vfy *{box-sizing:border-box}
.vfy :focus-visible{outline:2px solid var(--river,#35607a);outline-offset:-2px}

.vfy-top{display:flex;align-items:center;gap:10px;padding:15px 22px;position:sticky;top:0;
  background:#fff;border-bottom:1px solid var(--ink,#1b1f24);z-index:2}
.vfy-top h2{margin:0;font-size:15px;font-weight:500;display:flex;align-items:center;gap:9px}
.vfy-top h2 svg{color:var(--soft,#5c636c)}
.vfy-run{margin-left:auto;font-size:12px;color:var(--soft,#5c636c)}
.vfy-x{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;
  border:1px solid var(--rule,#dcdcd6);background:none;color:var(--soft,#5c636c);cursor:pointer}
.vfy-x:hover{color:var(--ink,#1b1f24);border-color:var(--soft,#5c636c)}

.vfy-figs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin:0}
.vfy-figs div{display:flex;flex-direction:column;padding:16px 22px;
  border-left:1px solid var(--rule,#dcdcd6)}
.vfy-figs div:first-child{border-left:0}
.vfy-figs dd{margin:0;font-size:24px;font-weight:500;letter-spacing:-.02em;line-height:1.1}
.vfy-figs dt{font-size:12px;color:var(--soft,#5c636c);margin-top:5px}
.vfy-meter{height:2px;background:var(--rule,#dcdcd6);position:relative}
.vfy-meter i{position:absolute;top:0;bottom:0;left:0;background:var(--go,#40674f);
  transform-origin:left;animation:vfyDraw .8s cubic-bezier(.2,.7,.3,1) .12s both}
.vfy-meter i.short{background:var(--hold,#9a6b1f)}
.vfy-src{display:flex;align-items:center;gap:9px;margin:0;padding:13px 22px;font-size:12.5px;
  color:var(--soft,#5c636c);border-bottom:1px solid var(--rule,#dcdcd6)}
.vfy-src svg{flex:none;color:var(--hold,#9a6b1f)}
.vfy-src.live svg{color:var(--go,#40674f)}

.vfy-steps{list-style:none;margin:0;padding:0}
.vfy-step{border-bottom:1px solid var(--rule,#dcdcd6)}
.vfy-row{display:grid;grid-template-columns:21px 20px 1fr auto 16px;align-items:center;gap:11px;
  width:100%;padding:13px 22px;font:inherit;text-align:left;background:none;border:0;
  cursor:pointer;animation:vfyIn .3s cubic-bezier(.2,.7,.3,1) both;animation-delay:var(--d)}
.vfy-row:hover,.vfy-row[aria-expanded=true]{background:var(--wash,#f2f2ee)}
.vfy-ix{font-size:11px;color:#a4a49e}
.vfy-ic{display:flex;color:var(--soft,#5c636c)}
.vfy-step.verified .vfy-ic{color:var(--go,#40674f)}
.vfy-step.partial .vfy-ic,.vfy-step.awaiting .vfy-ic{color:var(--hold,#9a6b1f)}
.vfy-step.failed .vfy-ic{color:var(--stop,#8c3b3b)}
.vfy-step.notreached .vfy-ic{color:#b6b6b0}
.vfy-nm{font-size:14px}
.vfy-ct{font-size:12px;color:var(--soft,#5c636c)}
.vfy-step.verified .vfy-ct{color:var(--go,#40674f)}
.vfy-step.failed .vfy-ct{color:var(--stop,#8c3b3b)}
.vfy-step.notreached .vfy-ct{color:#b6b6b0}
.vfy-cv{display:flex;color:#b6b6b0;transition:transform .18s ease}
.vfy-row[aria-expanded=true] .vfy-cv{transform:rotate(180deg)}

.vfy-more{padding:3px 22px 20px 75px}
.vfy-more[hidden]{display:none}
.vfy-does{margin:0 0 15px;font-size:13.5px;line-height:1.5;max-width:46ch}
.vfy-made{display:flex;flex-wrap:wrap;margin:0 0 16px}
.vfy-made div{display:flex;flex-direction:column;padding-right:18px;margin-right:18px;
  border-right:1px solid var(--rule,#dcdcd6)}
.vfy-made div:last-child{border-right:0;margin-right:0;padding-right:0}
.vfy-made dd{margin:0;font-size:17px;font-weight:500}
.vfy-made dt{font-size:11.5px;color:var(--soft,#5c636c);margin-top:3px}
.vfy-lbl{margin:0 0 7px;font-size:11px;color:var(--soft,#5c636c)}
.vfy-items{list-style:none;margin:0 0 16px;padding:0}
.vfy-items li{display:grid;grid-template-columns:28px 1fr;gap:9px;padding:7px 0;
  border-top:1px solid var(--rule,#dcdcd6);align-items:start}
.vfy-items li:first-child{border-top:0;padding-top:0}
.vfy-id{font-size:11px;color:var(--soft,#5c636c);padding-top:2px}
.vfy-items b{display:block;font-size:13px;font-weight:400;line-height:1.45;max-width:52ch}
.vfy-items em{display:block;font-style:normal;font-size:11.5px;color:var(--soft,#5c636c);
  margin-top:2px}
.vfy-cites{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.vfy-cites i{font-style:normal;font-size:10.5px;color:var(--soft,#5c636c);
  border:1px solid var(--rule,#dcdcd6);padding:1px 5px}
.vfy-chks{list-style:none;margin:0 0 15px;padding:0}
.vfy-chks li{display:grid;grid-template-columns:16px 1fr;gap:9px;padding:6px 0;align-items:start}
.vfy-tick{display:flex;margin-top:2px;color:var(--go,#40674f)}
.vfy-tick.no{color:var(--stop,#8c3b3b)}
.vfy-chks b{display:block;font-size:13px;font-weight:400}
.vfy-chks em{font-style:normal;font-size:11.5px;color:var(--soft,#5c636c)}
.vfy-hand{display:flex;align-items:center;gap:9px;margin:0 0 15px;font-size:12.5px;
  color:var(--soft,#5c636c)}
.vfy-hand svg{flex:none;color:#b6b6b0}
.vfy-qs>summary{cursor:pointer;font-size:12.5px;color:var(--soft,#5c636c);list-style:none;
  display:flex;align-items:center;gap:8px}
.vfy-qs>summary::-webkit-details-marker{display:none}
.vfy-qs>summary svg{color:#b6b6b0}
.vfy-q{border-top:1px solid var(--rule,#dcdcd6);padding:7px 0;margin-top:7px}
.vfy-q summary{cursor:pointer;display:flex;gap:10px;align-items:baseline;font-size:12.5px;
  list-style:none}
.vfy-q summary::-webkit-details-marker{display:none}
.vfy-q summary span{font-size:11.5px;color:var(--soft,#5c636c)}
.vfy-q summary i{font-style:normal;margin-left:auto;font-size:11.5px;color:var(--hold,#9a6b1f)}
.vfy-q pre{margin:8px 0 0;padding:9px 11px;background:var(--wash,#f2f2ee);white-space:pre-wrap;
  font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--soft,#5c636c)}
.vfy-none{margin:0;font-size:13px;line-height:1.5;color:var(--soft,#5c636c);max-width:46ch}
.vfy-msg{padding:26px 22px;font-size:14px;line-height:1.6;color:var(--soft,#5c636c);max-width:52ch}

@keyframes vfyDock{from{transform:translateX(22px);opacity:0}}
@keyframes vfyIn{from{opacity:0;transform:translateY(4px)}}
@keyframes vfyDraw{from{transform:scaleX(0)}}
@media (prefers-reduced-motion:reduce){
  .vfy,.vfy *{animation-duration:1ms!important;transition-duration:1ms!important}}
@media (max-width:620px){.vfy{width:100%}.vfy-more{padding-left:22px}}
`;

  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  const fmtN = (n) =>
    typeof n === "number" && n >= 1000 ? n.toLocaleString("en-GB") : String(n);

  // What an agent does is written as a fragment for the chain's tooltips. Here
  // it is a line a person reads on its own, so it opens like one.
  const sentence = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");

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
  panel.setAttribute("aria-label", "Agent trace: every step of the run, checked");
  panel.tabIndex = -1;
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  let data = null;
  let open = 0;
  // The rows land one after another when the panel opens, and hold still
  // afterwards: opening a step is not news.
  let fresh = false;

  function close() {
    scrim.hidden = true;
  }

  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !scrim.hidden) close();
  });

  // focus is an agent name: the chain on the case screen opens its own step.
  window.showWorking = async function (runId, focus) {
    scrim.hidden = false;
    panel.focus();
    panel.innerHTML = '<div class="vfy-msg">Reading the run record…</div>';
    try {
      const res = await fetch("/runs/" + encodeURIComponent(runId) + "/verify", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("the service answered " + res.status);
      data = await res.json();
    } catch (err) {
      panel.innerHTML =
        '<div class="vfy-top"><h2>' +
        svg(TRACE) +
        'Agent trace</h2><button class="vfy-x" aria-label="Close">' +
        svg(CROSS, 16) +
        '</button></div><div class="vfy-msg">Nothing to show: ' +
        esc(err.message) +
        ". This panel reports what the service measured, so with no answer it shows " +
        "nothing rather than a guess.</div>";
      panel.querySelector(".vfy-x").addEventListener("click", close);
      return;
    }
    // Something that went wrong first; otherwise the first agent that ran.
    const broken = data.steps.findIndex(
      (s) => s.status === "failed" || s.status === "partial"
    );
    const ran = data.steps.findIndex((s) => s.ran);
    const asked = focus ? data.steps.findIndex((s) => s.agent === focus) : -1;
    open = asked !== -1 ? asked : broken !== -1 ? broken : ran !== -1 ? ran : 0;
    fresh = true;
    draw();
  };

  function draw() {
    panel.innerHTML = topHtml() + figsHtml() + '<ol class="vfy-steps">' + stepsHtml() + "</ol>";
    panel.querySelector(".vfy-x").addEventListener("click", close);
    panel.querySelectorAll(".vfy-row").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        open = open === i ? -1 : i;
        draw();
      })
    );
    fresh = false;
  }

  function topHtml() {
    return (
      '<div class="vfy-top"><h2>' +
      svg(TRACE) +
      'Agent trace</h2><span class="vfy-run">' +
      esc(data.event_id || "") +
      " · " +
      esc(String(data.run_id || "").slice(0, 12)) +
      '</span><button class="vfy-x" aria-label="Close">' +
      svg(CROSS, 16) +
      "</button></div>"
    );
  }

  function figsHtml() {
    const p = data.data_path || {};
    const all = data.checks_run || 0;
    const share = all ? Math.round((data.checks_passed / all) * 100) : 0;
    return (
      '<dl class="vfy-figs"><div><dd>' +
      data.verified +
      " of " +
      data.of +
      "</dd><dt>agents verified</dt></div><div><dd>" +
      data.checks_passed +
      " of " +
      all +
      '</dd><dt>checks passed</dt></div></dl><div class="vfy-meter" role="img" aria-label="' +
      data.checks_passed +
      " of " +
      all +
      ' checks passed"><i class="' +
      (share === 100 ? "" : "short") +
      '" style="width:' +
      share +
      '%"></i></div><p class="vfy-src' +
      (p.reached_zetaris ? " live" : "") +
      '">' +
      svg(STORE, 16) +
      "<span>" +
      esc(sentence(p.verdict || "no query ran")) +
      " · " +
      (p.queries || 0) +
      " queries over " +
      fmtN(p.rows || 0) +
      " rows</span></p>"
    );
  }

  function stepsHtml() {
    return data.steps.map((s, i) => stepHtml(s, i)).join("");
  }

  function stepHtml(s, i) {
    const cls = s.status === "not reached" ? "notreached" : s.status;
    const kind = cls === "notreached" && s.agent === "hitl" ? "awaiting" : cls;
    const passed = s.checks.filter((c) => c.ok).length;
    return (
      '<li class="vfy-step ' +
      kind +
      '"><button class="vfy-row" data-i="' +
      i +
      '" aria-expanded="' +
      (i === open) +
      '" style="--d:' +
      (fresh ? i * 55 : 0) +
      'ms"><span class="vfy-ix">' +
      String(i + 1).padStart(2, "0") +
      '</span><span class="vfy-ic">' +
      svg(ICON[s.agent] || '<circle cx="10" cy="10" r="6"/>') +
      '</span><span class="vfy-nm">' +
      esc(s.title || s.agent) +
      '</span><span class="vfy-ct">' +
      (s.ran ? passed + "/" + s.checks.length : kind === "awaiting" ? "waiting" : "—") +
      '</span><span class="vfy-cv">' +
      svg(CHEVRON, 16) +
      '</span></button><div class="vfy-more"' +
      (i === open ? "" : " hidden") +
      ">" +
      bodyHtml(s) +
      "</div></li>"
    );
  }

  function bodyHtml(s) {
    if (!s.ran) {
      return (
        '<p class="vfy-none">' +
        esc(sentence(s.does)) +
        ". " +
        (s.agent === "hitl"
          ? "Waiting on a person, so there is nothing to check yet."
          : "This agent was not reached, so it is reported as not run rather than as passing.") +
        "</p>"
      );
    }
    return (
      '<p class="vfy-does">' +
      esc(sentence(s.does)) +
      "</p>" +
      madeHtml(s) +
      itemsHtml(s) +
      checksHtml(s) +
      handHtml(s) +
      queriesHtml(s)
    );
  }

  function madeHtml(s) {
    const made = Object.entries(s.produced || {})
      .filter(([, v]) => v != null && v !== "")
      .slice(0, 4);
    if (!made.length) return "";
    return (
      '<dl class="vfy-made">' +
      made
        .map(
          ([k, v]) =>
            "<div><dd>" +
            esc(fmtN(Array.isArray(v) ? v.length : v)) +
            "</dd><dt>" +
            esc(k.replace(/_/g, " ")) +
            "</dt></div>"
        )
        .join("") +
      "</dl>"
    );
  }

  // What the agent actually wrote, above the checks that test it. A check
  // saying "every claim carries a citation" is worth little if the claims
  // and their citations are nowhere to be seen.
  function itemsHtml(s) {
    if (!s.items || !s.items.length) return "";
    return (
      '<p class="vfy-lbl">' +
      esc(s.items_label || "what it wrote") +
      '</p><ul class="vfy-items">' +
      s.items
        .map(
          (it) =>
            '<li><span class="vfy-id">' +
            esc(it.id || "") +
            "</span><span><b>" +
            esc(it.text || "") +
            "</b>" +
            (it.cites && it.cites.length
              ? '<span class="vfy-cites">' +
                it.cites.map((c) => '<i>' + esc(c) + "</i>").join("") +
                "</span>"
              : "") +
            (it.note ? "<em>" + esc(it.note) + "</em>" : "") +
            "</span></li>"
        )
        .join("") +
      "</ul>"
    );
  }

  function checksHtml(s) {
    if (!s.checks.length) return "";
    return (
      '<ul class="vfy-chks">' +
      s.checks
        .map(
          (c) =>
            '<li><span class="vfy-tick ' +
            (c.ok ? "" : "no") +
            '">' +
            svg(c.ok ? TICK : CROSS, 14) +
            "</span><span><b>" +
            esc(c.name) +
            "</b><em>" +
            esc(c.detail) +
            "</em></span></li>"
        )
        .join("") +
      "</ul>"
    );
  }

  function handHtml(s) {
    const title = (id) => {
      const to = data.steps.find((x) => x.agent === id);
      return to ? to.title || id : id;
    };
    return (data.handoffs || [])
      .filter((h) => h.frm === s.agent)
      .map(
        (h) =>
          '<p class="vfy-hand">' +
          svg(h.kind === "loop" ? LOOP : ARROW, 16) +
          "<span>" +
          (h.kind === "loop"
            ? "Sent back to " + esc(title(h.to)) + ", " + h.fired + " time(s)"
            : "Handed to " +
              esc(title(h.to)) +
              (h.carried.length
                ? " — " + esc(h.carried.map((c) => fmtN(c.n) + " " + c.what).join(", "))
                : "")) +
          "</span></p>"
      )
      .join("");
  }

  function queriesHtml(s) {
    if (!s.queries.length) return "";
    return (
      '<details class="vfy-qs"><summary>' +
      svg(CHEVRON, 14) +
      s.queries.length +
      (s.queries.length === 1 ? " query it ran" : " queries it ran") +
      "</summary>" +
      s.queries.map(queryHtml).join("") +
      "</details>"
    );
  }

  function queryHtml(q) {
    if (!q.resolved) {
      return '<div class="vfy-q"><b>' + esc(q.query_id) + "</b> not in the record</div>";
    }
    return (
      '<details class="vfy-q"><summary><b>' +
      esc((q.views && q.views[0]) || q.view) +
      "</b><span>" +
      q.rows +
      " rows</span>" +
      (q.error ? "<i>" + esc(q.error) + "</i>" : "") +
      "</summary><pre>" +
      esc(q.sql) +
      "</pre></details>"
    );
  }
})();
