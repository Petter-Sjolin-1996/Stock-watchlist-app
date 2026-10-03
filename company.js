/* Mr. Market – company page (rendering only; app.js handles data and actions) */
(function () {
  "use strict";
  const SEG_COLORS = ["#1B5FAA", "#5B8FD1", "#9CC0EA", "#7A4FB5", "#B79BDB", "#2E7D6B"];

  function niceStep(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  // axis maximum that is a whole number of nice steps (4 or fewer gridlines)
  function niceMax(v) { const st = niceStep(v / 4); return Math.max(st, Math.ceil(v / st) * st); }
  const k = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "k" : Math.round(v).toString();

  /* ================= shared chart style ================= */
  const NAVY = "#13307A", LIGHT = "#8FB6E8", RED = "#D9827C", ACT_BG = "#F3F4F6";
  const W = 780, H = 340;
  const label = (x, y, txt, o = {}) =>
    `<text x="${x}" y="${y}" text-anchor="${o.anchor || "middle"}" font-size="${o.size || 12}" font-weight="${o.weight || 400}" fill="${o.fill || "var(--ink)"}"${o.ls ? ` letter-spacing="${o.ls}"` : ""}>${txt}</text>`;

  /* waterfall from cash flows to equity value (same look as the key chart) */
  function waterfall(steps, h, VW = W) {
    const W = VW, l = 10, r = 10, t = 34, b = 46, cw = W - l - r, ch = H - t - b;
    let run = 0, hi = 0;
    const bars = steps.map(s => {
      if (s.total) { run = s.value; hi = Math.max(hi, run); return { ...s, from: 0, to: s.value }; }
      const bar = { ...s, from: run, to: run + s.value }; run += s.value; hi = Math.max(hi, bar.from, bar.to); return bar;
    });
    const y = v => t + ch - v / (hi * 1.05) * ch, bw = cw / bars.length;
    let g = `<line x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>`;
    bars.forEach((s, i) => {
      const top = y(Math.max(s.from, s.to)), bot = y(Math.min(s.from, s.to)), xc = l + bw * (i + 0.5), w = bw * 0.56;
      const color = s.total ? NAVY : s.value >= 0 ? LIGHT : RED;
      g += `<rect x="${xc - w / 2}" y="${top}" width="${w}" height="${Math.max(1, bot - top)}" fill="${color}"/>`;
      g += label(xc, top - 7, h.fmt(s.value, 0));
      s.label.split("\n").forEach((part, j) => { g += label(xc, H - b + 20 + j * 15, h.esc(part), { fill: "var(--muted)" }); });
    });
    return `<div class="kc-scroll"><svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="From cash flows to equity value">${g}</svg></div>`;
  }

  /* ================= key chart: actual history + your forecast ================= */
  const METRICS = {
    sales: { name: "Revenue", a: "net sales", q: "net sales", arrows: true },
    ebitda: { name: "EBITDA", a: "adjusted ebitda", q: "adjusted ebitda", bubble: "margin" },
    ebit: { name: "EBIT", a: "ebit", q: "ebit", bubble: "margin", oneoff: true },
    ni: { name: "Net income", a: "net income", q: "net income", bubble: "eps", oneoff: true },
    fcf: { name: "Free cash flow", a: "free cash flow, mr. market definition", q: "free cash flow, reported", arrows: true },
    roic: { name: "ROIC", pct: true }
  };
  const NOTES = {
    sales: ["Net sales"],
    ebitda: ["Actual years: adjusted EBITDA, excluding one-offs", "Forecast: EBITDA from your model", "Pills: EBITDA margin"],
    ebit: ["Actual years as reported, including one-offs", "Pills: EBIT margin"],
    ni: ["Forecast: EBIT minus financial costs and tax from your model", "Pills: earnings per share in SEK, forecast on today's share count"],
    fcf: ["Actual years on the same definition as your forecast", "Reported quarters: operating cash flow minus capex"],
    roic: ["ROIC = EBITA after tax / operating capital, including goodwill",
           "Operating capital = working capital + tangible assets incl. right-of-use + intangible assets, at year end",
           "Forecast capital rolled forward with capex, depreciation, amortisation and working capital",
           "New leases assumed equal to lease depreciation; acquisitions after the last report not included"]
  };
  const v0 = (arr, i) => (arr && arr[i] != null ? arr[i] : 0);
  const taxRate = (tax, pbt) => (pbt > 0 ? Math.min(0.4, Math.max(0, tax / pbt)) : 0);

  function seriesFor(key, ctx) {
    const { data, result, actuals } = ctx;
    if (key === "roic") return roicSeries(ctx);
    const M = METRICS[key], A = actuals && actuals.annual, Q = actuals && actuals.quarterly;
    const P = data ? data.periods : [], L = data ? data.lines : {};
    const qIdx = P.map((p, i) => i).filter(i => P[i].kind === "Q");
    const curYear = qIdx.length ? P[qIdx[0]].label.slice(3) : null;
    const fcVal = (k, i) => k === "ni" ? (result.ebit[i] == null ? null : result.ebit[i] - v0(L.fin, i) - v0(L.tax, i)) : result[k][i];
    const bars = [];
    if (A) {
      const vals = A.get(M.a), sales = A.get("net sales"), eps = A.get("eps, diluted"), iac = A.get("items affecting comparability");
      A.periods.forEach((y, i) => {
        if (+y < 2021 || (curYear && +y >= +curYear) || vals[i] == null) return;
        bars.push({ label: y, actual: vals[i], forecast: null, sales: sales[i], eps: eps[i], oneoff: (iac[i] || 0) > 0 });
      });
    }
    if (data && result) {
      if (qIdx.length) {
        let act = 0, actSales = 0, actEps = 0, haveAct = true, fc = 0, fcSales = 0, fcNi = 0, anyFc = false, oneoff = false;
        const hasRep = qIdx.some(i => P[i].status.toLowerCase() === "reported");
        qIdx.forEach(i => {
          if (P[i].status.toLowerCase() === "reported") {
            const lab = P[i].label, x = Q ? Q.value(M.q, lab) : null;
            if (x == null) haveAct = false;
            else { act += x; actSales += Q.value("net sales", lab) || 0; actEps += Q.value("eps, diluted", lab) || 0; }
            if ((Q && Q.value("items affecting comparability", lab) || 0) > 0) oneoff = true;
          } else { anyFc = true; fc += fcVal(key, i) || 0; fcSales += result.sales[i] || 0; fcNi += fcVal("ni", i) || 0; }
        });
        const okA = hasRep && haveAct;
        bars.push({ label: curYear, actual: okA ? act : null, forecast: anyFc ? fc : null, split: okA && anyFc,
                    sales: (okA ? actSales : 0) + fcSales, eps: (okA ? actEps : 0) + fcNi / data.inputs.shares, oneoff });
      }
      P.forEach((p, i) => {
        if (p.kind !== "FY" || p.status.toLowerCase() !== "forecast") return;
        bars.push({ label: p.label.replace(/^FY /, ""), actual: null, forecast: fcVal(key, i), sales: result.sales[i], eps: fcVal("ni", i) / data.inputs.shares });
      });
    }
    return bars;
  }

  /* ROIC, operating definition: EBITA after tax / operating capital (working capital + tangible + intangible assets).
     History from the actuals file; forecast capital rolled forward from the last year-end. */
  function roicSeries(ctx) {
    const { data, result, actuals } = ctx, A = actuals && actuals.annual, Q = actuals && actuals.quarterly;
    const bars = [];
    if (!A) return bars;
    const roic = A.get("roic"), cap = A.get("operating capital"), lp = A.get("lease payments");
    const P = data ? data.periods : [], L = data ? data.lines : {};
    const qIdx = P.map((p, i) => i).filter(i => P[i].kind === "Q");
    const curYear = qIdx.length ? P[qIdx[0]].label.slice(3) : null;
    let base = null, baseYear = null, leaseDep = 0;
    A.periods.forEach((y, i) => {
      if (+y < 2021 || (curYear && +y >= +curYear)) return;
      if (roic[i] != null) bars.push({ label: y, actual: roic[i], forecast: null });
      if (cap[i] != null) { base = cap[i]; baseYear = y; }
      if (lp[i] != null) leaseDep = lp[i];
    });
    if (!(data && result) || base == null) return bars;
    const nopatFc = i => (result.ebit[i] + v0(L.amort, i)) * (1 - Math.min(0.4, Math.max(0, result.taxRate[i] || 0)));
    let ic = base, nopat = 0, hasAct = false, anyFc = false, nwcPrev = A.value("working capital", baseYear);
    qIdx.forEach(i => {
      const lab = P[i].label;
      if (P[i].status.toLowerCase() === "reported" && Q) {
        const ebita = Q.value("ebita (reported)", lab), tax = Q.value("income tax", lab), pbt = Q.value("profit before tax", lab);
        const capex = Q.value("capex", lab), dep = Q.value("depreciation", lab), am = Q.value("amortisation", lab), nwc = Q.value("working capital", lab);
        if (ebita != null) { nopat += ebita * (1 - taxRate(tax || 0, pbt || 0)); hasAct = true; }
        ic += (capex || 0) - (dep || 0) + leaseDep / 4 - (am || 0) + (nwc != null && nwcPrev != null ? nwc - nwcPrev : 0);
        if (nwc != null) nwcPrev = nwc;
      } else {
        anyFc = true; nopat += nopatFc(i);
        ic += v0(L.capex, i) - v0(L.dep, i) + leaseDep / 4 - v0(L.amort, i) + v0(L.nwc, i);
      }
    });
    if (qIdx.length) bars.push({ label: curYear, actual: null, forecast: nopat / ic, split: false, mixed: hasAct && anyFc });
    P.forEach((p, i) => {
      if (p.kind !== "FY" || p.status.toLowerCase() !== "forecast") return;
      ic += v0(L.capex, i) - v0(L.dep, i) + leaseDep - v0(L.amort, i) + v0(L.nwc, i);
      bars.push({ label: p.label.replace(/^FY /, ""), actual: null, forecast: nopatFc(i) / ic });
    });
    return bars;
  }

  function cagr(a, b, n) { return a > 0 && b > 0 && n > 0 ? Math.pow(b / a, 1 / n) - 1 : null; }

  function keyChart(bars, key, h) {
    const M = METRICS[key], pctMode = !!M.pct;
    const l = 14, r = 14, t = M.arrows ? 92 : M.bubble ? 74 : 50, b = 34, cw = W - l - r, ch = H - t - b;
    const tot = bars.map(x => (x.actual || 0) + (x.forecast || 0));
    const hi = Math.max(0, ...tot) * 1.08 || 1, lo = Math.min(0, ...tot) * 1.05;
    const negRoom = lo < 0 ? 24 : 0, bottom = H - b - 6 - negRoom;
    const y = v => t + (hi - v) / (hi - lo) * (bottom - t), bw = cw / bars.length, xc = i => l + bw * (i + 0.5);
    const fmtV = v => pctMode ? (v * 100).toFixed(1) + "%" : h.fmt(v, 0);
    const firstFc = bars.findIndex(x => x.forecast != null);
    let g = "";
    // light grey background behind the actual years
    if (firstFc > 0) {
      g += `<rect x="${l}" y="0" width="${bw * firstFc}" height="${H - b + 4}" fill="${ACT_BG}" rx="6"/>`;
      g += label(l + 12, 18, "ACTUAL", { anchor: "start", size: 11, weight: 600, fill: "var(--muted)", ls: ".06em" });
      g += label(l + bw * firstFc + 12, 18, "YOUR FORECAST", { anchor: "start", size: 11, weight: 600, fill: NAVY, ls: ".06em" });
    } else if (firstFc === 0) {
      g += label(l + 12, 18, "YOUR FORECAST", { anchor: "start", size: 11, weight: 600, fill: NAVY, ls: ".06em" });
    }
    g += `<line x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}" stroke="#C9CED6"/>`;
    bars.forEach((x, i) => {
      const a = x.actual || 0, f = x.forecast || 0, total = a + f, w = bw * 0.58, x0 = xc(i) - w / 2;
      if (x.split && a >= 0 && f >= 0) {
        g += `<rect x="${x0}" y="${y(a)}" width="${w}" height="${Math.max(0, y(0) - y(a))}" fill="${NAVY}"><title>${x.label} reported: ${fmtV(a)}</title></rect>`;
        g += `<rect x="${x0}" y="${y(total)}" width="${w}" height="${Math.max(0, y(a) - y(total))}" fill="${LIGHT}"><title>${x.label} your forecast: ${fmtV(f)}</title></rect>`;
      } else {
        const top = y(Math.max(0, total)), bot = y(Math.min(0, total));
        g += `<rect x="${x0}" y="${top}" width="${w}" height="${Math.max(1, bot - top)}" fill="${x.actual != null && x.forecast == null ? NAVY : LIGHT}"><title>${x.label}: ${fmtV(total)}</title></rect>`;
      }
      g += label(xc(i), total >= 0 ? y(total) - 7 : y(total) + 16, fmtV(total) + (M.oneoff && x.oneoff ? "*" : ""));
      if (M.bubble) {
        const val = M.bubble === "margin" ? (x.sales ? total / x.sales : null) : x.eps;
        if (val != null && isFinite(val)) {
          const txt = M.bubble === "margin" ? (val * 100).toFixed(1) + "%" : val.toFixed(2), bwid = txt.length * 7 + 16, by = t - 30;
          const isAct = x.actual != null && x.forecast == null;
          g += `<rect x="${xc(i) - bwid / 2}" y="${by - 13}" width="${bwid}" height="20" rx="10" fill="${isAct ? NAVY : LIGHT}"/>` +
               label(xc(i), by + 2, txt, { size: 11, weight: 500, fill: isAct ? "#fff" : NAVY });
        }
      }
      g += label(xc(i), H - b + 20, x.label, { fill: "var(--muted)" });
    });
    // CAGR arrows: thin, separated, line broken around the label
    const notes = [];
    if (M.arrows) {
      const lastA = firstFc > 0 ? firstFc - 1 : bars.length - 1, lastF = bars.length - 1;
      const seg = (i0, i1, color, gapStart, gapEnd) => {
        if (i1 <= i0) return;
        const n = +bars[i1].label - +bars[i0].label, c = cagr(tot[i0], tot[i1], n);
        const txt = c != null ? `CAGR ${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%` : "CAGR n/a";
        if (c == null) notes.push(`CAGR n/a ${bars[i0].label}–${bars[i1].label}: a growth rate cannot be calculated from a negative or zero value`);
        const ay = t - 46, x1 = xc(i0) + gapStart, x2 = xc(i1) - gapEnd, xm = (x1 + x2) / 2, tw = txt.length * 7 + 20;
        g += `<line x1="${x1}" x2="${xm - tw / 2 - 6}" y1="${ay}" y2="${ay}" stroke="${color}" stroke-width="1"/>` +
             `<line x1="${xm + tw / 2 + 6}" x2="${x2}" y1="${ay}" y2="${ay}" stroke="${color}" stroke-width="1"/>` +
             `<path d="M${x2 - 6},${ay - 3.5} L${x2},${ay} L${x2 - 6},${ay + 3.5}" fill="none" stroke="${color}" stroke-width="1"/>` +
             `<rect x="${xm - tw / 2}" y="${ay - 11}" width="${tw}" height="22" rx="11" fill="var(--surface)" stroke="${color}" stroke-width="1"/>` +
             label(xm, ay + 4, txt, { size: 11.5, weight: 500, fill: color });
      };
      seg(0, lastA, "var(--ink)", 0, 10);
      if (firstFc > 0) seg(lastA, lastF, NAVY, 10, 0);
    }
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${h.esc(M.name)}, actual and forecast">${g}</svg>`, notes };
  }

  function buildKeyChart(ctx) {
    const { data, result, actuals, h } = ctx, key = ctx.metric || "sales", M = METRICS[key];
    if (!actuals && !(data && result)) return "";
    const bars = seriesFor(key, ctx).filter(x => x.actual != null || x.forecast != null);
    const tabs = Object.entries(METRICS).map(([k2, m]) => `<button data-action="metric" data-metric="${k2}" aria-pressed="${k2 === key}">${m.name}</button>`).join("");
    const split = bars.find(x => x.split);
    const legend = `<span><i style="background:${NAVY}"></i>Actual</span><span><i style="background:${LIGHT}"></i>Your forecast</span>` +
      (split ? `<span><i class="split"></i>${split.label}: reported + your forecast</span>` : "");
    let body, notes = [];
    if (bars.length) { const kc = keyChart(bars, key, h); body = `<div class="kc-scroll">${kc.svg}</div>`; notes = kc.notes; }
    else body = `<p class="dim kc-empty">${key === "roic" ? "ROIC needs historical balance sheet data for this company" : "No data to show yet"}</p>`;
    const foot = [...NOTES[key], ...(M.oneoff && bars.some(x => x.oneoff) ? ["* Includes one-offs (restructuring)"] : []), ...notes,
                  ...(actuals ? [] : ["No historical data yet for this company"])];
    return `<section class="card cp-chart kc">
      <div class="kc-title"><h2>Actual vs forecast</h2><span class="unit">${M.pct ? "%" : "SEK m"}</span></div>
      <div class="kc-bar"><div class="seg kc-tabs" role="group" aria-label="Choose metric">${tabs}</div><div class="legend kc-legend">${legend}</div></div>
      ${body}
      <ul class="kc-notes">${foot.map(n => `<li>${h.esc(n)}</li>`).join("")}</ul>
    </section>`;
  }

  /* ================= valuation: waterfall + value per share panel with a WACC slider ================= */
  const withWacc = (data, wacc) => Object.assign({}, data, { inputs: Object.assign({}, data.inputs, { wacc }) });
  function waccRange(data) {
    const g = String(data.inputs.method || "").toLowerCase() === "terminal growth" ? (data.inputs.growth || 0) : -1;
    return { min: Math.max(4, Math.ceil((g + 0.005) * 1000) / 10), max: 16 };
  }
  function valuationParts(ctx, wacc) {
    const { data, h, s } = ctx;
    const res = MMModels.computeValuation(withWacc(data, wacc));
    const fy = data.periods.filter(p => p.kind === "FY"), lastY = fy.length ? fy[fy.length - 1].label.slice(-2) : "";
    const firstY = data.periods.length ? data.periods[0].label.slice(-4) : "";
    const steps = [
      { label: `Cash flows\n${firstY}–${lastY}`, value: res.sumPv },
      { label: "Terminal\nvalue", value: res.pvTv },
      { label: "Enterprise\nvalue", value: res.ev, total: true },
      { label: "Net\ndebt", value: -res.netDebt },
      { label: "Lease\nliabilities", value: -res.leases },
      { label: "Earn-outs\n& options", value: -res.other },
      { label: "Equity\nvalue", value: res.equity, total: true }
    ];
    const price = s.price, up0 = price ? res.vps / price - 1 : null, up = up0 != null && Math.abs(up0) < 0.0005 ? 0 : up0;
    const calc = `
      <div class="vp-row"><span>Equity value</span><b>${h.fmt(res.equity, 0)}</b></div>
      <div class="vp-row"><span>÷ Shares outstanding, m</span><b>${h.fmt(data.inputs.shares)}</b></div>
      <div class="vp-row vp-total"><span>Value per share</span><b>SEK ${h.fmt(res.vps)}</b></div>
      <div class="vp-row"><span>Share price${s.priceDate ? `<small>as of ${h.fmtDate(s.priceDate)}</small>` : ""}</span><b>${price != null ? "SEK " + h.fmt(price) : "–"}</b></div>
      <div class="vp-row vp-up"><span>${up == null || up >= 0 ? "Upside" : "Downside"}</span><b class="${up == null || up === 0 ? "" : up > 0 ? "pos" : "neg"}">${up == null ? "–" : h.pct(up)}</b></div>`;
    return { chart: waterfall(steps, h, 560), calc, note: `Present values at a WACC of ${(wacc * 100).toFixed(1)}%`, res };
  }
  function valuationCard(ctx) {
    const { data } = ctx, base = data.inputs.wacc, wacc = ctx.wacc != null ? ctx.wacc : base, rg = waccRange(data);
    const parts = valuationParts(ctx, wacc);
    return `<section class="card cp-chart kc" id="valuation-card"><div class="kc-title"><h2>From cash flows to value</h2><span class="unit">SEK m</span></div>
      <div class="vc-grid">
        <div class="vc-chart"><div id="wf-chart">${parts.chart}</div><ul class="kc-notes"><li id="wf-note">${parts.note}</li></ul></div>
        <aside class="vc-panel">
          <div id="wf-calc">${parts.calc}</div>
          <div class="vp-wacc">
            <div class="vp-row"><span>WACC</span><b id="wacc-val">${(wacc * 100).toFixed(1)}%</b></div>
            <input type="range" id="wacc-slider" min="${rg.min}" max="${rg.max}" step="0.1" value="${(wacc * 100).toFixed(1)}" aria-label="WACC">
            <div class="vp-scale"><span>${rg.min}%</span><span>${rg.max}%</span></div>
            <div class="vp-reset"><span class="dim small">Your model: ${(base * 100).toFixed(1)}%</span>
              <span><button class="link-btn" data-action="wacc-implied" ${ctx.s.price ? "" : "disabled"}>Implied return</button><button class="link-btn" data-action="wacc-reset" ${Math.abs(wacc - base) < 1e-9 ? "disabled" : ""}>Reset</button></span></div>
            <p class="dim small vp-hint" id="wacc-hint">${(() => { const imp = ctx.wacc != null && ctx.s.price ? impliedWacc(ctx) : null;
              return imp && imp.wacc && Math.abs(imp.wacc - wacc) < 1e-6 ? `Implied return at today's price: ${(wacc * 100).toFixed(1)}% a year` : "What-if only. Your model is not changed"; })()}</p>
          </div>
        </aside>
      </div></section>`;
  }
  // market-implied WACC: the WACC at which your value per share equals today's share price (bisection)
  function impliedWacc(ctx) {
    const { data, s } = ctx, price = s.price, rg = waccRange(data);
    if (!price) return { error: "No share price available" };
    const vps = w => MMModels.computeValuation(withWacc(data, w)).vps;
    let lo = rg.min / 100, hi = rg.max / 100;
    if (vps(lo) < price) return { error: `Your forecast cannot reach today's price even at a WACC of ${rg.min}%` };
    if (vps(hi) > price) return { error: `Today's price implies a WACC above ${rg.max}%` };
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (vps(mid) > price) lo = mid; else hi = mid; }
    return { wacc: (lo + hi) / 2 };
  }

  // fast update while dragging the slider: only the chart and the numbers are redrawn
  function updateValuation(root, ctx, wacc) {
    const card = root.querySelector("#valuation-card");
    if (!card || !ctx.data) return;
    const parts = valuationParts(ctx, wacc), base = ctx.data.inputs.wacc;
    card.querySelector("#wf-chart").innerHTML = parts.chart;
    card.querySelector("#wf-calc").innerHTML = parts.calc;
    card.querySelector("#wf-note").textContent = parts.note;
    card.querySelector("#wacc-val").textContent = (wacc * 100).toFixed(1) + "%";
    const sl = card.querySelector("#wacc-slider"); if (Math.abs(+sl.value / 100 - wacc) > 1e-9) sl.value = (wacc * 100).toFixed(1);
    card.querySelector('[data-action="wacc-reset"]').disabled = Math.abs(wacc - base) < 1e-9;
    const imp = ctx.s.price ? impliedWacc(ctx) : null;
    card.querySelector("#wacc-hint").textContent = imp && imp.wacc && Math.abs(imp.wacc - wacc) < 1e-6
      ? `Implied return at today's price: ${(wacc * 100).toFixed(1)}% a year` : "What-if only. Your model is not changed";
  }

  // every section is rendered on its own: if one fails, it shows an error instead of hiding the whole page
  function safe(title, h, fn) {
    try { return fn() || ""; }
    catch (e) {
      console.error(title, e);
      return `<section class="card cp-chart"><div class="warn"><b>${h.esc(title)} could not be shown.</b> ${h.esc(e && e.message || String(e))}</div>
        <div class="actions" style="justify-content:flex-start"><button class="pill" data-action="retry-load">Try again</button></div></section>`;
    }
  }
  const errorBox = (h, title, msg) => `<div class="warn"><b>${h.esc(title)}</b> ${h.esc(msg)}</div>
    <div class="cp-actions" style="margin-top:10px"><button class="pill" data-action="retry-load">Try again</button></div>`;

  function render(el, ctx) {
    const { s, h, latest, data, result, versions, hasTemplate, connected } = ctx;
    const st = ctx.status || {};
    const loadingModels = connected && st.models === "loading", modelsFailed = connected && st.models === "error";
    const nf = (v, d) => v == null || !isFinite(v) ? "–" : h.fmt(v, d);
    const day = v => v ? h.fmtDate(String(v).slice(0, 10)) : "–";
    const up = latest && s.price ? latest.valuePerShare / s.price - 1 : null;
    const nextRep = s.report ? `next report ${h.fmtDate(s.report)}${h.daysTo(s.report) >= 0 ? ` (in ${h.daysTo(s.report)} days)` : ""}` : "";
    let html = `<a href="#/" class="back">‹ Watchlist</a>
    <div class="cp-head">
      <div class="cp-title">${h.flag(s.country)}<div><h1>${h.esc(s.name)}</h1><small>${h.esc(s.ticker)}${nextRep ? " · " + nextRep : ""}</small></div></div>
    </div>
    <div class="cp-stats">
      <div class="stat"><small>Your value</small><b>${latest ? nf(latest.valuePerShare) : "–"}</b><span class="dim">${latest ? "SEK per share" : loadingModels ? "loading…" : modelsFailed ? "could not load" : "no model yet"}</span></div>
      <div class="stat"><small>Share price</small><b>${s.price != null ? h.fmt(s.price) : "–"}</b><span class="${s.day >= 0 ? "pos" : "neg"}">${s.day != null ? h.pct(s.day, 2) + " today" : ""}</span></div>
      <div class="stat ${up == null ? "" : up >= 0 ? "stat-up" : "stat-down"}"><small>Upside</small><b>${up == null ? "–" : h.pct(up)}</b><span class="dim">${up == null ? "" : up >= 0 ? "your value is above the price" : "your value is below the price"}</span></div>
      <div class="stat"><small>Model</small><b class="stat-text">${latest ? "Based on " + h.esc(latest.basis || "–") : loadingModels ? "Loading…" : modelsFailed ? "Not loaded" : "No model yet"}</b><span class="dim">${latest ? "uploaded " + day(latest.uploadedAt) : ""}</span></div>
    </div>`;

    // ---- model card
    const histBtn = ctx.hasActuals ? `<button class="pill" data-action="download-actuals"><svg><use href="#i-down"/></svg>Download historical financials</button>` : "";
    const tplBtn = hasTemplate
      ? `<button class="pill" data-action="download-template"><svg><use href="#i-down"/></svg>Download transfer sheet</button>`
      : `<span class="dim small">No transfer sheet developed yet for this company</span>`;
    html += `<section class="card cp-model"><div class="cp-model-head"><h2>Your model</h2></div>`;
    if (modelsFailed) {
      html += errorBox(h, "Your models could not be loaded from GitHub.", st.modelsErr || "");
    } else if (loadingModels && !latest) {
      html += `<p class="dim">Loading your models…</p>`;
    } else if (latest) {
      html += `<p class="cp-file"><svg class="xl"><use href="#i-xl"/></svg><span><b>${h.esc(latest.fileName || "Model")}</b><br><span class="dim small">Uploaded ${day(latest.uploadedAt)} · based on ${h.esc(latest.basis || "–")} · template ${h.esc(latest.templateVersion || "–")}</span></span></p>
      <div class="cp-actions"><button class="pill primary" data-action="upload"><svg><use href="#i-up"/></svg>Upload new version</button>
      <button class="pill" data-action="download-model"><svg><use href="#i-down"/></svg>Download my model</button>${tplBtn}${histBtn}</div>`;
    } else {
      html += `<ol class="steps">
        <li><b>Download the transfer sheet</b> for ${h.esc(s.name)}. ${hasTemplate ? "" : "<span class='dim'>(not available yet)</span>"}</li>
        <li><b>Copy it into your DCF</b> in Excel, link the orange cells and save.</li>
        <li><b>Upload your model</b>. Mr. Market checks it and shows your value per share.</li></ol>
      <div class="cp-actions"><button class="pill primary" data-action="upload"><svg><use href="#i-up"/></svg>Upload model</button>${tplBtn}${histBtn}</div>`;
    }
    if (!connected) html += `<p class="note">Connect GitHub under Settings to store models and transfer sheets.</p>`;
    html += `</section>`;

    // ---- key chart: history + your forecast (switchable)
    if (st.actualsErr) html += `<section class="card cp-chart">${errorBox(h, "Historical financials could not be loaded.", st.actualsErr)}</section>`;
    html += safe("The chart", h, () => buildKeyChart(ctx));

    // ---- visuals from the latest model
    if (data && result) {
      const P = data.periods, fc = P.map(p => p.status.toLowerCase() === "forecast");
      const yi = P.map((p, i) => i).filter(i => fc[i] && P[i].kind === "FY");
      html += safe("The valuation", h, () => valuationCard(ctx));
      html += safe("Key assumptions", h, () => {
      let html = "";

      // key assumptions table
      const cols = P.map((p, i) => i).filter(i => fc[i]);
      const cell = (v, f) => `<td>${v == null || !isFinite(v) ? "<span class='dim'>–</span>" : f(v)}</td>`;
      const pctf = v => (v * 100).toFixed(1) + "%";
      const rows = [];
      rows.push(["Net sales, SEK m", cols.map(i => cell(result.sales[i], v => h.fmt(v, 0))), "strong"]);
      rows.push(["Sales growth", cols.map(i => { const prev = yi.indexOf(i) > 0 ? yi[yi.indexOf(i) - 1] : null; return cell(prev != null ? result.sales[i] / result.sales[prev] - 1 : null, pctf); })]);
      data.ebitda.forEach(sg => {
        const sv = data.sales.find(x => x.name === sg.name);
        rows.push([`EBITDA margin ${h.esc(sg.name)}`, cols.map(i => cell(sv && sv.values[i] ? sg.values[i] / sv.values[i] : null, pctf))]);
      });
      rows.push(["EBITDA margin, group", cols.map(i => cell(result.sales[i] ? result.ebitda[i] / result.sales[i] : null, pctf)), "strong"]);
      rows.push(["EBIT margin", cols.map(i => cell(result.sales[i] ? result.ebit[i] / result.sales[i] : null, pctf))]);
      rows.push(["Capex % of sales", cols.map(i => cell(result.sales[i] ? result.capex[i] / result.sales[i] : null, pctf))]);
      rows.push(["Tax rate", cols.map(i => cell(result.taxRate[i], pctf))]);
      rows.push(["Free cash flow, SEK m", cols.map(i => cell(result.fcf[i], v => h.fmt(v, 0))), "strong"]);
      const inp = data.inputs, tv = String(inp.method || "").toLowerCase() === "terminal growth" ? `terminal growth ${pctf(inp.growth)}` : `exit multiple ${h.fmt(inp.multiple, 1)}x EV/EBITDA`;
      html += `<section class="card cp-chart"><h2>Key assumptions</h2><p class="sub">From your model. WACC ${pctf(inp.wacc)}, ${tv}.</p>
        <div class="tbl-scroll"><table class="assump"><thead><tr><th>SEK m / %</th>${cols.map(i => `<th>${h.esc(P[i].label)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([lab, cells, cls]) => `<tr class="${cls || ""}"><th>${lab}</th>${cells.join("")}</tr>`).join("")}</tbody></table></div></section>`;
      return html;
      });
    } else if (latest && connected) {
      html += st.modelDataErr
        ? `<section class="card cp-chart">${errorBox(h, "Your model could not be loaded.", st.modelDataErr)}</section>`
        : `<section class="card cp-chart"><p class="dim">Loading your model…</p></section>`;
    }

    // ---- version history
    html += safe("Version history", h, () => { let html = ""; if (versions.length) {
      html += `<section class="card cp-chart"><h2>Version history</h2><p class="sub">Every upload is kept, so you can follow how your view has changed.</p>
      <div class="tbl-scroll"><table class="versions"><thead><tr><th>Uploaded</th><th>Based on</th><th>Value per share</th><th>Change</th><th>File</th><th></th></tr></thead><tbody>
      ${versions.map((v, i) => {
        const prev = versions[i + 1], ch = prev && prev.valuePerShare ? v.valuePerShare / prev.valuePerShare - 1 : null;
        return `<tr><td>${day(v.uploadedAt)}</td><td>${h.esc(v.basis || "–")}</td><td>${nf(v.valuePerShare)}</td>
        <td>${ch == null ? "<span class='dim'>first</span>" : `<span class="${ch >= 0 ? "pos" : "neg"}">${h.pct(ch)}</span>`}</td>
        <td class="file">${h.esc(v.fileName)}</td><td><button class="link-btn" data-action="download-version" data-path="${h.esc(v.xlsx)}" data-name="${h.esc(v.fileName)}">Download</button></td></tr>`;
      }).join("")}</tbody></table></div></section>`;
    } return html; });
    el.innerHTML = `<div class="cp">${html}</div>`;
  }

  window.MMCompany = { VERSION: "0.19", render, updateValuation, impliedWacc };
})();
