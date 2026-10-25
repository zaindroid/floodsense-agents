// Agent trace. A separate overlay from the readiness staircase: that one
// asks whether the foundations hold, this one asks whether each agent did
// what it says it did, step by step, and which data path it used.
//
// It is styled as its own surface rather than in the app's paper, because it
// is not part of the app: the app is what a reviewer reads and signs, this is
// the instrument they audit it with.
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
/* Its own surface, on purpose. The app is paper: light, Archivo, hairline
   rules, prose a person signs. This is the instrument behind the paper, so it
   takes a dark ground and a monospace face, and docks to the edge instead of
   sitting in the middle, which keeps the case visible underneath it. */
.vfy-scrim{position:fixed;inset:0;z-index:9999;background:rgba(10,12,15,.4);
  display:flex;justify-content:flex-end}
.vfy-scrim[hidden]{display:none}
.vfy{--vf-g:#15181c;--vf-r:#1c2026;--vf-l:#2c323a;--vf-t:#e7e7e3;--vf-dim:#949ba5;
  --vf-faint:#646c77;--vf-ok:#78a383;--vf-hold:#c69c52;--vf-no:#c4736e;--vf-cool:#7795b0;
  background:var(--vf-g);color:var(--vf-t);width:min(880px,100%);height:100%;overflow:auto;
  border-left:1px solid #000;box-shadow:-24px 0 48px rgba(0,0,0,.28);
  font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  font-variant-numeric:tabular-nums;animation:vfyDock .28s cubic-bezier(.2,.7,.3,1) both}
.vfy *{box-sizing:border-box}
.vfy :focus-visible{outline:1px solid var(--vf-cool);outline-offset:2px}

/* Chrome: what this is, which run, and the run's own counters. */
.vfy-chrome{position:sticky;top:0;z-index:3;background:var(--vf-g);
  border-bottom:1px solid var(--vf-l)}
.vfy-head{display:flex;align-items:baseline;gap:12px;padding:13px 18px 11px}
.vfy-head h2{margin:0;font-size:13px;font-weight:500;color:var(--vf-t)}
.vfy-head h2 span{color:var(--vf-faint);font-weight:400}
.vfy-id{margin-left:auto;font-size:11.5px;color:var(--vf-faint)}
.vfy-x{font:inherit;font-size:12px;background:none;border:1px solid var(--vf-l);
  color:var(--vf-dim);padding:3px 9px;cursor:pointer}
.vfy-x:hover{color:var(--vf-t);border-color:var(--vf-dim)}
.vfy-stat{display:flex;flex-wrap:wrap;margin:0;border-top:1px solid var(--vf-l)}
.vfy-stat div{display:flex;flex-direction:column;padding:8px 16px;
  border-right:1px solid var(--vf-l)}
.vfy-stat div:last-child{border-right:0}
.vfy-stat dt{order:2;font-size:10.5px;color:var(--vf-faint)}
.vfy-stat dd{margin:0;font-size:15px;color:var(--vf-t)}
.vfy-stat dd.hold{color:var(--vf-hold)}
.vfy-meter{height:2px;margin:0;background:var(--vf-l);position:relative}
.vfy-meter i{position:absolute;top:0;bottom:0;left:0;background:var(--vf-ok);
  transform-origin:left;animation:vfyDraw .85s cubic-bezier(.2,.7,.3,1) .1s both}
.vfy-meter i.short{background:var(--vf-hold)}

.vfy-path{margin:16px 18px 0;padding:11px 13px;background:var(--vf-r);
  border-left:2px solid var(--vf-ok);font-size:12.5px;line-height:1.55;color:var(--vf-dim)}
.vfy-path.off{border-left-color:var(--vf-hold)}
.vfy-path b{display:block;color:var(--vf-t);margin-bottom:2px}
.vfy-path dl{display:flex;flex-wrap:wrap;margin:10px 0 0;font-size:11.5px}
.vfy-path dl div{display:flex;gap:6px;padding-right:12px;margin-right:12px;
  border-right:1px solid var(--vf-l)}
.vfy-path dl div:last-child{border-right:0;margin-right:0;padding-right:0}
.vfy-path dt{color:var(--vf-faint)}
.vfy-path dd{margin:0;color:var(--vf-t)}

.vfy-body{display:grid;grid-template-columns:minmax(0,232px) minmax(0,1fr);gap:0 24px;
  padding:16px 18px 28px}
.vfy-pipe{list-style:none;margin:0;padding:0}
.vfy-pipe li{margin:0}
.vfy-flowhead{font-size:11px;color:var(--vf-faint);margin:0 0 9px;line-height:1.5}

.vfy-agent{display:flex;align-items:center;gap:9px;width:100%;text-align:left;font:inherit;
  cursor:pointer;border:0;border-left:2px solid var(--vf-l);background:var(--vf-r);
  color:var(--vf-dim);padding:8px 10px;margin:0 0 1px;
  animation:vfyIn .28s cubic-bezier(.2,.7,.3,1) both;animation-delay:var(--d)}
.vfy-agent:hover{background:#22272e;color:var(--vf-t)}
.vfy-agent[aria-current=true]{background:#262c34;color:var(--vf-t)}
.vfy-agent.verified{border-left-color:var(--vf-ok)}
.vfy-agent.partial{border-left-color:var(--vf-hold)}
.vfy-agent.failed{border-left-color:var(--vf-no)}
.vfy-agent.notreached{border-left-color:#3a4049}
.vfy-ix{font-size:11px;color:var(--vf-faint)}
.vfy-agent[aria-current=true] .vfy-ix{color:var(--vf-dim)}
.vfy-nm{flex:1;font-size:12.5px}
.vfy-ct{font-size:11px;color:var(--vf-faint)}
.vfy-agent.verified .vfy-ct{color:var(--vf-ok)}
.vfy-agent.partial .vfy-ct,.vfy-agent.failed .vfy-ct{color:var(--vf-hold)}

/* What crossed, travelling the edge it crossed. Runs once, with the marks. */
.vfy-hand{display:block;position:relative;width:100%;text-align:left;font:inherit;
  background:none;border:0;border-left:1px solid var(--vf-l);margin-left:12px;
  padding:5px 0 5px 13px;cursor:pointer}
.vfy-hand::after{content:"";position:absolute;left:-2px;width:3px;height:3px;border-radius:50%;
  background:var(--vf-ok);animation:vfyRun .55s linear both;animation-delay:var(--d)}
.vfy-hand.loop::after{background:var(--vf-hold)}
.vfy-carry{font-size:11px;color:var(--vf-faint);line-height:1.45;display:block}
.vfy-hand:hover .vfy-carry{color:var(--vf-dim)}
.vfy-hand[aria-current=true] .vfy-carry{color:var(--vf-t)}
.vfy-hand.loop{border-left:1px dashed var(--vf-hold)}
.vfy-hand.loop .vfy-carry{color:var(--vf-hold)}

.vfy-ttl{margin:0 0 4px;font-size:15px;font-weight:500;color:var(--vf-t)}
.vfy-ttl span{font-size:11px;font-weight:400;color:var(--vf-faint);margin-left:9px}
.vfy-does{font-size:13.5px;line-height:1.6;margin:0 0 5px;max-width:62ch;color:var(--vf-t)}
.vfy-sum{font-size:12px;color:var(--vf-dim);margin:0 0 15px;line-height:1.55}
.vfy h3{font-size:11px;font-weight:500;color:var(--vf-faint);margin:20px 0 7px;
  border-top:1px solid var(--vf-l);padding-top:7px}
.vfy-made{display:flex;flex-wrap:wrap;margin:0}
.vfy-made div{display:flex;flex-direction:column;padding-right:14px;margin-right:14px;
  border-right:1px solid var(--vf-l)}
.vfy-made div:last-child{border-right:0;margin-right:0;padding-right:0}
.vfy-made dt{order:2;font-size:10.5px;color:var(--vf-faint)}
.vfy-made dd{margin:0;font-size:15px;color:var(--vf-t)}
.vfy-chk{display:grid;grid-template-columns:11px 1fr;gap:9px;padding:7px 0;
  border-top:1px solid #23282f;align-items:start}
.vfy-dot{width:7px;height:7px;margin-top:5px;border-radius:50%;border:1px solid var(--vf-faint);
  animation:vfyIn .22s ease both;animation-delay:var(--d)}
.vfy-dot.ok{background:var(--vf-ok);border-color:var(--vf-ok)}
.vfy-dot.no{background:var(--vf-no);border-color:var(--vf-no)}
.vfy-chk b{font-size:12.5px;font-weight:400;display:block;color:var(--vf-t)}
.vfy-chk span{font-size:11.5px;color:var(--vf-dim)}
.vfy-q{border-top:1px solid #23282f;padding:7px 0}
.vfy-q summary{cursor:pointer;font-size:12px;display:flex;gap:10px;align-items:baseline;
  list-style:none;color:var(--vf-dim)}
.vfy-q summary::-webkit-details-marker{display:none}
.vfy-q summary b{font-weight:400;color:var(--vf-t)}
.vfy-q summary i{font-style:normal;color:var(--vf-ok);margin-left:auto;font-size:11px}
.vfy-q summary i.fake{color:var(--vf-hold)}
.vfy-q pre{margin:8px 0 2px;padding:9px 11px;background:#101317;font:inherit;font-size:11.5px;
  white-space:pre-wrap;color:var(--vf-dim);line-height:1.6;border-left:1px solid var(--vf-l)}
.vfy-wait{border-left:2px solid var(--vf-hold);padding:4px 0 4px 11px;margin:0 0 15px;
  font-size:12.5px;line-height:1.55;color:var(--vf-dim);max-width:62ch}
.vfy-msg{padding:24px 18px;font-size:13px;line-height:1.65;color:var(--vf-dim);max-width:66ch}

@keyframes vfyDock{from{transform:translateX(26px);opacity:0}}
@keyframes vfyIn{from{opacity:0;transform:translateY(4px)}}
@keyframes vfyDraw{from{transform:scaleX(0)}}
@keyframes vfyRun{from{top:-3px;opacity:0}25%{opacity:1}to{top:100%;opacity:0}}
@media (prefers-reduced-motion:reduce){
  .vfy,.vfy *,.vfy-hand::after{animation-duration:1ms!important}}
@media (max-width:820px){.vfy{width:100%}.vfy-body{grid-template-columns:1fr;gap:16px}}
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
  panel.setAttribute("aria-label", "Agent trace: every step of the run, checked");
  panel.tabIndex = -1;
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  let data = null;
  let picked = 0;
  let shown = null;
  // The rail lands step by step when the panel opens, and holds still
  // afterwards: a redraw from a click is not news.
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
        '<div class="vfy-chrome"><div class="vfy-head"><h2>agent trace</h2>' +
        '<button class="vfy-x">close</button></div></div>' +
        '<div class="vfy-msg">Nothing to show: ' +
        esc(err.message) +
        ". This panel reports what the service measured, so with no answer it shows " +
        "nothing rather than a guess.</div>";
      panel.querySelector(".vfy-x").addEventListener("click", close);
      return;
    }
    // Something that went wrong first; otherwise the first agent that ran.
    // Never open on a step that has not run: it has nothing to show.
    const broken = data.steps.findIndex(
      (s) => s.status === "failed" || s.status === "partial"
    );
    const ran = data.steps.findIndex((s) => s.ran);
    const asked = focus ? data.steps.findIndex((s) => s.agent === focus) : -1;
    picked = asked !== -1 ? asked : broken !== -1 ? broken : ran !== -1 ? ran : 0;
    shown = null;
    fresh = true;
    draw();
  };

  function draw() {
    const s = data.steps[picked];
    const p = data.data_path;
    panel.innerHTML =
      chromeHtml() +
      pathHtml(p) +
      '<div class="vfy-body"><div><p class="vfy-flowhead">' +
      (data.loops && (data.loops.revise_rounds || data.loops.repair_rounds)
        ? "The chain looped back " +
          (data.loops.revise_rounds + data.loops.repair_rounds) +
          " time(s) before it settled."
        : "Straight through, no agent sent work back.") +
      '</p><ul class="vfy-pipe">' +
      flowHtml() +
      "</ul></div>" +
      (shown && shown.kind ? handoffHtml(shown) : stepHtml(s)) +
      "</div>";
    panel.querySelector(".vfy-x").addEventListener("click", close);
    panel.querySelectorAll(".vfy-agent").forEach((b) =>
      b.addEventListener("click", () => {
        picked = Number(b.dataset.i);
        shown = null;
        draw();
      })
    );
    panel.querySelectorAll(".vfy-hand").forEach((b) =>
      b.addEventListener("click", () => {
        shown = data.handoffs[Number(b.dataset.h)];
        draw();
      })
    );
    fresh = false;
  }

  function chromeHtml() {
    const p = data.data_path || {};
    return (
      '<div class="vfy-chrome"><div class="vfy-head"><h2>agent trace <span>— every step, ' +
      "against the run's own record</span></h2>" +
      '<span class="vfy-id">' +
      esc(data.event_id || "") +
      " · run " +
      esc(String(data.run_id || "").slice(0, 12)) +
      '</span><button class="vfy-x">close</button></div><dl class="vfy-stat">' +
      cellHtml(data.verified + "/" + data.of, "agents verified") +
      cellHtml(data.checks_passed + "/" + data.checks_run, "checks passed") +
      cellHtml(String(p.queries || 0), "queries") +
      cellHtml(fmtN(p.rows || 0), "rows read") +
      cellHtml(esc(p.schema || "—"), "schema") +
      cellHtml(
        p.reached_zetaris ? "zetaris" : "stand-in",
        "data path",
        !p.reached_zetaris
      ) +
      "</dl>" +
      meterHtml() +
      "</div>"
    );
  }

  function cellHtml(value, label, hold) {
    return (
      '<div><dd class="' +
      (hold ? "hold" : "") +
      '">' +
      value +
      "</dd><dt>" +
      label +
      "</dt></div>"
    );
  }

  function meterHtml() {
    const all = data.checks_run || 0;
    const share = all ? Math.round((data.checks_passed / all) * 100) : 0;
    return (
      '<div class="vfy-meter" role="img" aria-label="' +
      data.checks_passed +
      " of " +
      all +
      ' checks passed"><i class="' +
      (share === 100 ? "" : "short") +
      '" style="width:' +
      share +
      '%"></i></div>'
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

  function flowHtml() {
    const hands = data.handoffs || [];
    let beat = 0;
    const at = () => (fresh ? beat++ * 110 : 0);
    return data.steps
      .map((s, i) => {
        const mine = agentHtml(s, i, at());
        const out = hands
          .map((h, hi) => [h, hi])
          .filter(([h]) => h.frm === s.agent)
          .map(([h, hi]) => handRailHtml(h, hi, at()))
          .join("");
        return "<li>" + mine + out + "</li>";
      })
      .join("");
  }

  function handRailHtml(h, hi, delay) {
    const n = data.handoffs.indexOf(h);
    return (
      '<button class="vfy-hand ' +
      (h.kind === "loop" ? "loop" : "") +
      '" style="--d:' +
      delay +
      'ms" data-h="' +
      (hi == null ? n : hi) +
      '" aria-current="' +
      (shown === h) +
      '"><span class="vfy-carry">' +
      (h.kind === "loop" ? "back to " + esc(h.to) + ": " : "to " + esc(h.to) + ": ") +
      esc(
        h.carried.length
          ? h.carried.map((c) => c.what + " " + fmtN(c.n)).join(", ")
          : "nothing recorded"
      ) +
      "</span></button>"
    );
  }

  function fmtN(n) {
    return typeof n === "number" && n >= 1000 ? n.toLocaleString("en-GB") : String(n);
  }

  function handoffHtml(h) {
    return (
      '<div><p class="vfy-does">' +
      (h.kind === "loop"
        ? esc(h.frm) + " sent work back to " + esc(h.to) + "."
        : esc(h.frm) + " handed this to " + esc(h.to) + ".") +
      '</p><p class="vfy-sum">' +
      (h.kind === "loop"
        ? "A back edge in the graph. It fired " + h.fired + " time(s) in this run."
        : "Counted from the run record, not from what either agent said it did.") +
      "</p><h3>What crossed</h3><dl class=\"vfy-made\">" +
      h.carried
        .map(
          (c) =>
            "<div><dd>" +
            esc(fmtN(c.n)) +
            "</dd><dt>" +
            esc(c.what) +
            "</dt></div>"
        )
        .join("") +
      '</dl><p class="vfy-sum" style="margin-top:18px">Pick an agent on the left to see its ' +
      "own checks and the queries it ran.</p></div>"
    );
  }

  function agentHtml(s, i, delay) {
    const cls = s.status === "not reached" ? "notreached" : s.status;
    const n = s.checks.filter((c) => c.ok).length;
    return (
      '<button class="vfy-agent ' +
      cls +
      '" style="--d:' +
      delay +
      'ms" data-i="' +
      i +
      '" aria-current="' +
      (i === picked) +
      '"><span class="vfy-ix">' +
      String(i + 1).padStart(2, "0") +
      '</span><span class="vfy-nm">' +
      esc(s.title || s.agent) +
      '</span><span class="vfy-ct">' +
      (s.ran ? n + "/" + s.checks.length : "—") +
      "</span></button>"
    );
  }

  function stepHtml(s) {
    if (!s) return "<div></div>";
    const made = Object.entries(s.produced || {}).filter(([, v]) => v != null && v !== "");
    return (
      '<div><h4 class="vfy-ttl">' +
      esc(s.title || s.agent) +
      '<span>' +
      esc(s.agent) +
      ' node</span></h4><p class="vfy-does">' +
      esc(s.does) +
      '</p><p class="vfy-sum">' +
      (s.ran
        ? esc(s.summary) +
          (s.lane ? " · " + esc(s.lane) + " lane" : "") +
          (s.model_id ? " · " + esc(s.model_id) : "") +
          (s.latency_ms != null ? " · " + s.latency_ms + " ms" : "")
        : "<b>" + WORD[s.status] + ".</b> " + esc(s.summary)) +
      "</p>" +
      (s.ran
        ? ""
        : '<p class="vfy-wait">Nothing to verify here yet. This agent has not run, so ' +
          "there are no checks to pass or fail. It is reported as <b>not reached</b> " +
          "rather than as passing.</p>") +
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
              (c, ci) =>
                '<div class="vfy-chk"><span class="vfy-dot ' +
                (c.ok ? "ok" : "no") +
                '" style="--d:' +
                ci * 45 +
                'ms"></span><span><b>' +
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
