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

  /* waterfall from cash flows to equity value */
  function waterfall(steps, h) {
    const W = 420, H = 230, l = 10, r = 10, t = 22, b = 44, cw = W - l - r, ch = H - t - b;
    let run = 0, hi = 0;
    const bars = steps.map(s => {
      if (s.total) { const bar = { ...s, from: 0, to: s.value }; run = s.value; hi = Math.max(hi, run); return bar; }
      const bar = { ...s, from: run, to: run + s.value }; run += s.value; hi = Math.max(hi, bar.from, bar.to); return bar;
    });
    const max = niceMax(hi * 1.05), y = v => t + ch - v / max * ch, bw = cw / bars.length;
    let g = "";
    bars.forEach((s, i) => {
      const top = y(Math.max(s.from, s.to)), bot = y(Math.min(s.from, s.to));
      const color = s.total ? "var(--ink)" : s.value >= 0 ? "var(--blue)" : "var(--down)";
      g += `<rect x="${l + i * bw + bw * 0.15}" y="${top}" width="${bw * 0.7}" height="${Math.max(1, bot - top)}" rx="2" fill="${color}" opacity="${s.total ? 0.9 : 0.85}"/>`;
      g += `<text x="${l + i * bw + bw / 2}" y="${top - 5}" text-anchor="middle" font-size="11" fill="var(--ink)">${k(s.value)}</text>`;
      s.label.split("\n").forEach((part, j) => { g += `<text x="${l + i * bw + bw / 2}" y="${H - 26 + j * 13}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${h.esc(part)}</text>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="From cash flows to equity value">${g}</svg>`;
  }

  /* ================= key chart: actual history + your forecast ================= */
  const METRICS = {
    sales: { name: "Revenue", a: "net sales", q: "net sales", arrows: true },
    ebitda: { name: "EBITDA", a: "adjusted ebitda", q: "adjusted ebitda", bubble: "margin" },
    ebit: { name: "EBIT", a: "ebit", q: "ebit", bubble: "margin", oneoff: true },
    ni: { name: "Net income", a: "net income", q: "net income", bubble: "eps", oneoff: true },
    fcf: { name: "Free cash flow", a: "free cash flow, mr. market definition", q: "free cash flow, reported", arrows: true }
  };
  const NAVY = "#13307A", LIGHT = "#8FB6E8";

  function seriesFor(key, ctx) {
    const { data, result, actuals } = ctx, M = METRICS[key];
    const A = actuals && actuals.annual, Q = actuals && actuals.quarterly;
    const P = data ? data.periods : [];
    const qIdx = P.map((p, i) => i).filter(i => P[i].kind === "Q");
    const curYear = qIdx.length ? P[qIdx[0]].label.slice(3) : null;
    const L = data ? data.lines : {};
    const v = (arr, i) => (arr && arr[i] != null ? arr[i] : 0);
    const fcVal = (k, i) => {
      if (!result || result[k === "sales" ? "sales" : k] === undefined && k !== "ni") return null;
      if (k === "ni") return result.ebit[i] == null ? null : result.ebit[i] - v(L.fin, i) - v(L.tax, i);
      return result[k][i];
    };
    const bars = [];
    if (A) {
      const vals = A.get(M.a), sales = A.get("net sales"), eps = A.get("eps, diluted"), iac = A.get("items affecting comparability");
      A.periods.forEach((y, i) => {
        if (+y < 2021 || (curYear && +y >= +curYear) || vals[i] == null) return;
        bars.push({ label: y, actual: vals[i], forecast: null, sales: sales[i], eps: eps[i], oneoff: (iac[i] || 0) > 0 });
      });
    }
    if (data && result) {
      // current year: reported quarters (actuals file) + your forecast quarters (model)
      if (qIdx.length) {
        let act = 0, actSales = 0, actEps = 0, haveAct = true, fc = 0, fcSales = 0, fcNi = 0, anyFc = false, oneoff = false;
        qIdx.forEach(i => {
          if (P[i].status.toLowerCase() === "reported") {
            const lab = P[i].label;
            const x = Q ? Q.value(M.q, lab) : null, sl = Q ? Q.value("net sales", lab) : null, ep = Q ? Q.value("eps, diluted", lab) : null;
            const ia = Q ? Q.value("items affecting comparability", lab) : null;
            if (x == null) haveAct = false; else { act += x; actSales += sl || 0; actEps += ep || 0; }
            if ((ia || 0) > 0) oneoff = true;
          } else {
            anyFc = true; fc += fcVal(key, i) || 0; fcSales += result.sales[i] || 0; fcNi += fcVal("ni", i) || 0;
          }
        });
        const hasRep = qIdx.some(i => P[i].status.toLowerCase() === "reported");
        bars.push({ label: curYear, actual: hasRep && haveAct ? act : null, forecast: anyFc ? fc : null, split: hasRep && anyFc,
                    sales: (hasRep && haveAct ? actSales : 0) + fcSales, eps: (hasRep && haveAct ? actEps : 0) + fcNi / data.inputs.shares,
                    oneoff, partialMissing: hasRep && !haveAct });
      }
      P.forEach((p, i) => {
        if (p.kind !== "FY" || p.status.toLowerCase() !== "forecast") return;
        bars.push({ label: p.label.replace(/^FY /, ""), actual: null, forecast: fcVal(key, i), sales: result.sales[i],
                    eps: fcVal("ni", i) / data.inputs.shares });
      });
    }
    return bars;
  }

  function cagr(a, b, n) { return a > 0 && b > 0 && n > 0 ? Math.pow(b / a, 1 / n) - 1 : null; }

  function keyChart(bars, key, h) {
    const M = METRICS[key];
    const W = 780, H = 370, l = 46, r = 14, t = M.arrows ? 88 : 64, b = 42, cw = W - l - r, ch = H - t - b;
    const tot = bars.map(x => (x.actual || 0) + (x.forecast || 0));
    let hi = Math.max(0, ...tot), lo = Math.min(0, ...tot);
    const st = niceStep(Math.max(hi - lo, 1) / 4);
    hi = Math.ceil(hi / st) * st || st; lo = Math.floor(lo / st) * st;
    const y = v => t + (hi - v) / (hi - lo) * ch, bw = cw / bars.length, xc = i => l + bw * (i + 0.5);
    let g = `<defs><marker id="mm-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;
    for (let v = lo; v <= hi + 1e-9; v += st) {
      g += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="1.4"' : ""}/>` +
           `<text x="${l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${k(v)}</text>`;
    }
    // actual | forecast divider
    const firstFc = bars.findIndex(x => x.forecast != null);
    if (firstFc > 0) {
      const xd = l + bw * firstFc;
      g += `<line x1="${xd}" x2="${xd}" y1="${t - (M.arrows ? 70 : 46)}" y2="${H - b + 6}" stroke="var(--muted)" stroke-dasharray="3 4" opacity=".6"/>` +
           `<text x="${xd - 10}" y="${t - (M.arrows ? 74 : 50)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--muted)" letter-spacing=".06em">ACTUAL</text>` +
           `<text x="${xd + 10}" y="${t - (M.arrows ? 74 : 50)}" font-size="11" font-weight="600" fill="${NAVY}" letter-spacing=".06em">YOUR FORECAST</text>`;
    }
    bars.forEach((x, i) => {
      const a = x.actual || 0, f = x.forecast || 0, total = a + f, w = bw * 0.6, x0 = xc(i) - w / 2;
      if (x.split && a >= 0 && f >= 0) {
        g += `<rect x="${x0}" y="${y(a)}" width="${w}" height="${Math.max(0, y(0) - y(a))}" fill="${NAVY}"><title>${x.label} reported: ${h.fmt(a, 0)}</title></rect>`;
        g += `<rect x="${x0}" y="${y(total)}" width="${w}" height="${Math.max(0, y(a) - y(total))}" fill="${LIGHT}"><title>${x.label} your forecast: ${h.fmt(f, 0)}</title></rect>`;
      } else {
        const top = y(Math.max(0, total)), bot = y(Math.min(0, total));
        g += `<rect x="${x0}" y="${top}" width="${w}" height="${Math.max(1, bot - top)}" fill="${x.actual != null && x.forecast == null ? NAVY : LIGHT}"><title>${x.label}: ${h.fmt(total, 0)}</title></rect>`;
      }
      const ly = total >= 0 ? y(total) - 7 : y(total) + 15;
      g += `<text x="${xc(i)}" y="${ly}" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink)">${h.fmt(total, 0)}${M.oneoff && x.oneoff ? "*" : ""}</text>`;
      if (M.bubble) {
        const val = M.bubble === "margin" ? (x.sales ? total / x.sales : null) : x.eps;
        if (val != null && isFinite(val)) {
          const txt = M.bubble === "margin" ? (val * 100).toFixed(1) + "%" : val.toFixed(2);
          const by = Math.min(total >= 0 ? y(total) - 32 : y(0) - 26, t - 6), bwid = txt.length * 6.6 + 14;
          g += `<rect x="${xc(i) - bwid / 2}" y="${by - 13}" width="${bwid}" height="19" rx="9.5" fill="${x.forecast != null ? "#EDF4FC" : "#E6EAF2"}"/>` +
               `<text x="${xc(i)}" y="${by + 1}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${NAVY}">${txt}</text>`;
        }
      }
      g += `<text x="${xc(i)}" y="${H - b + 20}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${x.label}</text>`;
    });
    // CAGR arrows (revenue and free cash flow)
    const notes = [];
    if (M.arrows) {
      const lastA = firstFc > 0 ? firstFc - 1 : bars.length - 1, lastF = bars.length - 1;
      const seg = (i0, i1, color) => {
        if (i1 <= i0) return;
        const n = +bars[i1].label - +bars[i0].label, a = tot[i0], z = tot[i1], c = cagr(a, z, n);
        const txt = c != null ? `CAGR ${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%` : `Average ${h.fmt(tot.slice(i0, i1 + 1).reduce((s, q) => s + q, 0) / (i1 - i0 + 1), 0)} a year`;
        if (c == null) notes.push(`${bars[i0].label}–${bars[i1].label}: growth rate not meaningful (negative value), average shown`);
        const ay = t - 34, x1 = xc(i0), x2 = xc(i1), xm = (x1 + x2) / 2, tw = txt.length * 7.4 + 22;
        g += `<line x1="${x1}" x2="${x2}" y1="${ay}" y2="${ay}" stroke="${color}" stroke-width="1.6" marker-end="url(#mm-arr)"/>` +
             `<line x1="${x1}" x2="${x1}" y1="${ay - 5}" y2="${ay + 5}" stroke="${color}" stroke-width="1.6"/>` +
             `<rect x="${xm - tw / 2}" y="${ay - 11}" width="${tw}" height="22" rx="11" fill="var(--surface)" stroke="${color}"/>` +
             `<text x="${xm}" y="${ay + 4}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${color}">${txt}</text>`;
      };
      seg(0, lastA, "var(--ink)");
      if (firstFc > 0) seg(lastA, lastF, NAVY);
    }
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${h.esc(M.name)}, actual and forecast">${g}</svg>`, notes };
  }

  function buildKeyChart(ctx) {
    const { data, result, actuals, h } = ctx, key = ctx.metric || "sales", M = METRICS[key];
    if (!actuals && !(data && result)) return "";
    const bars = seriesFor(key, ctx).filter(x => x.actual != null || x.forecast != null);
    if (!bars.length) return "";
    const { svg, notes } = keyChart(bars, key, h);
    // action title (one message per chart)
    const firstFc = bars.findIndex(x => x.forecast != null), lastA = firstFc > 0 ? firstFc - 1 : (firstFc < 0 ? bars.length - 1 : -1);
    const tot = x => (x.actual || 0) + (x.forecast || 0), last = bars[bars.length - 1];
    let title = M.name;
    const pctS = c => (c >= 0 ? "+" : "") + (c * 100).toFixed(1) + "%";
    if (M.arrows && lastA > 0) {
      const ch = cagr(tot(bars[0]), tot(bars[lastA]), +bars[lastA].label - +bars[0].label);
      const cf = firstFc > 0 ? cagr(tot(bars[lastA]), tot(last), +last.label - +bars[lastA].label) : null;
      const avg = bars.slice(0, lastA + 1).reduce((s2, x) => s2 + tot(x), 0) / (lastA + 1);
      title = `${M.name}${ch != null ? ` grew ${pctS(ch)} a year ${bars[0].label}–${bars[lastA].label.slice(-2)}` : ` averaged SEK ${h.fmt(avg, 0)}m a year ${bars[0].label}–${bars[lastA].label.slice(-2)}`}${cf != null ? `; your forecast: ${pctS(cf)} a year to ${last.label}` : ""}`;
    } else if (M.bubble === "margin" && lastA >= 0) {
      const m = x => x.sales ? (tot(x) / x.sales * 100).toFixed(1) + "%" : "–";
      title = `${M.name} margin: ${m(bars[lastA])} in ${bars[lastA].label}${firstFc > 0 ? `, ${m(last)} in ${last.label} in your forecast` : ""}`;
    } else if (M.bubble === "eps" && lastA >= 0) {
      const e = x => x.eps != null ? x.eps.toFixed(2) : "–";
      title = `Earnings per share: SEK ${e(bars[lastA])} in ${bars[lastA].label}${firstFc > 0 ? `, SEK ${e(last)} in ${last.label} in your forecast` : ""}`;
    }
    const split = bars.find(x => x.split);
    const legend = `<span><i style="background:${NAVY}"></i>Actual</span><span><i style="background:${LIGHT}"></i>Your forecast</span>` +
      (split ? `<span><i class="split"></i>${split.label}: reported quarters + your forecast</span>` : "") +
      (M.oneoff && bars.some(x => x.oneoff) ? `<span>* Includes one-offs (restructuring)</span>` : "") +
      (M.bubble === "margin" ? `<span><i class="pill"></i>${M.name} margin</span>` : M.bubble === "eps" ? `<span><i class="pill"></i>EPS, SEK</span>` : "");
    const defs = {
      sales: "Net sales, SEK m.",
      ebitda: "SEK m. Actual years: adjusted EBITDA (excl. one-offs). Forecast: EBITDA from your model.",
      ebit: "SEK m. Actual years as reported, including one-offs.",
      ni: "SEK m. Forecast net income = EBIT − financial costs − tax from your model; EPS on today's share count.",
      fcf: "SEK m. Actual years on Mr. Market's definition (same as your forecast); reported quarters: operating cash flow − capex."
    };
    const tabs = Object.entries(METRICS).map(([k2, m]) => `<button data-action="metric" data-metric="${k2}" aria-pressed="${k2 === key}">${m.name}</button>`).join("");
    const dl = ctx.hasActuals ? `<button class="link-btn" data-action="download-actuals"><svg class="ic"><use href="#i-down"/></svg>Download historical data (Excel)</button>` : "";
    return `<section class="card cp-chart kc">
      <div class="kc-head"><div><h2>${h.esc(title)}</h2><p class="sub">${defs[key]}${actuals ? "" : " No historical data yet for this company."}</p></div>
      <div class="seg kc-tabs" role="group" aria-label="Choose metric">${tabs}</div></div>
      <div class="kc-scroll">${svg}</div>
      <div class="legend">${legend}</div>
      ${notes.length ? `<p class="note small">${notes.map(h.esc).join(". ")}.</p>` : ""}
      ${dl ? `<div class="kc-foot">${dl}</div>` : ""}
    </section>`;
  }

  function render(el, ctx) {
    const { s, h, latest, data, result, versions, hasTemplate, connected } = ctx;
    const up = latest && s.price ? latest.valuePerShare / s.price - 1 : null;
    const nextRep = s.report ? `next report ${h.fmtDate(s.report)}${h.daysTo(s.report) >= 0 ? ` (in ${h.daysTo(s.report)} days)` : ""}` : "";
    let html = `<a href="#/" class="back">‹ Watchlist</a>
    <div class="cp-head">
      <div class="cp-title">${h.flag(s.country)}<div><h1>${h.esc(s.name)}</h1><small>${h.esc(s.ticker)}${nextRep ? " · " + nextRep : ""}</small></div></div>
    </div>
    <div class="cp-stats">
      <div class="stat"><small>Your value</small><b>${latest ? h.fmt(latest.valuePerShare) : "–"}</b><span class="dim">${latest ? "SEK per share" : "no model yet"}</span></div>
      <div class="stat"><small>Share price</small><b>${s.price != null ? h.fmt(s.price) : "–"}</b><span class="${s.day >= 0 ? "pos" : "neg"}">${s.day != null ? h.pct(s.day, 2) + " today" : ""}</span></div>
      <div class="stat ${up == null ? "" : up >= 0 ? "stat-up" : "stat-down"}"><small>Upside</small><b>${up == null ? "–" : h.pct(up)}</b><span class="dim">${up == null ? "" : up >= 0 ? "your value is above the price" : "your value is below the price"}</span></div>
      <div class="stat"><small>Model</small><b class="stat-text">${latest ? "Based on " + h.esc(latest.basis) : "No model yet"}</b><span class="dim">${latest ? "uploaded " + h.fmtDate(latest.uploadedAt.slice(0, 10)) : ""}</span></div>
    </div>`;

    // ---- model card
    const tplBtn = hasTemplate
      ? `<button class="pill" data-action="download-template"><svg><use href="#i-down"/></svg>Download transfer sheet</button>`
      : `<span class="dim small">No transfer sheet developed yet for this company.</span>`;
    html += `<section class="card cp-model"><div class="cp-model-head"><h2>Your model</h2></div>`;
    if (latest) {
      html += `<p class="cp-file"><svg class="xl"><use href="#i-xl"/></svg><span><b>${h.esc(latest.fileName)}</b><br><span class="dim small">Uploaded ${h.fmtDate(latest.uploadedAt.slice(0, 10))} · based on ${h.esc(latest.basis)} · template ${h.esc(latest.templateVersion || "–")}</span></span></p>
      <div class="cp-actions"><button class="pill primary" data-action="upload"><svg><use href="#i-up"/></svg>Upload new version</button>
      <button class="pill" data-action="download-model"><svg><use href="#i-down"/></svg>Download my model</button>${tplBtn}</div>`;
    } else {
      html += `<ol class="steps">
        <li><b>Download the transfer sheet</b> for ${h.esc(s.name)}. ${hasTemplate ? "" : "<span class='dim'>(not available yet)</span>"}</li>
        <li><b>Copy it into your DCF</b> in Excel, link the orange cells and save.</li>
        <li><b>Upload your model</b>. Mr. Market checks it and shows your value per share.</li></ol>
      <div class="cp-actions"><button class="pill primary" data-action="upload"><svg><use href="#i-up"/></svg>Upload model</button>${tplBtn}</div>`;
    }
    if (!connected) html += `<p class="note">Connect GitHub under Settings to store models and transfer sheets.</p>`;
    html += `</section>`;

    // ---- key chart: history + your forecast (switchable)
    const kc = buildKeyChart(ctx);
    if (kc) html += kc;

    // ---- visuals from the latest model
    if (data && result) {
      const P = data.periods, fc = P.map(p => p.status.toLowerCase() === "forecast");
      const yi = P.map((p, i) => i).filter(i => fc[i] && P[i].kind === "FY");
      const labels = yi.map(i => P[i].label);
      const steps = [
        { label: "Cash flows\n2026–" + labels[labels.length - 1].slice(-2), value: result.sumPv },
        { label: "Terminal\nvalue", value: result.pvTv },
        { label: "Enterprise\nvalue", value: result.ev, total: true },
        { label: "Net\ndebt", value: -result.netDebt },
        { label: "Lease\nliabilities", value: -result.leases },
        { label: "Earn-outs\n& options", value: -result.other },
        { label: "Equity\nvalue", value: result.equity, total: true }
      ];
      html += `<section class="card cp-chart"><h2>From cash flows to value</h2><p class="sub">Present values, SEK m. ${h.fmt(result.equity, 0)} / ${h.fmt(data.inputs.shares)} m shares = <b>SEK ${h.fmt(result.vps)}</b> per share.</p>${waterfall(steps, h)}</section>`;

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
    } else if (latest && connected) {
      html += `<section class="card cp-chart"><p class="dim">Loading your model…</p></section>`;
    }

    // ---- version history
    if (versions.length) {
      html += `<section class="card cp-chart"><h2>Version history</h2><p class="sub">Every upload is kept, so you can follow how your view has changed.</p>
      <div class="tbl-scroll"><table class="versions"><thead><tr><th>Uploaded</th><th>Based on</th><th>Value per share</th><th>Change</th><th>File</th><th></th></tr></thead><tbody>
      ${versions.map((v, i) => {
        const prev = versions[i + 1], ch = prev ? v.valuePerShare / prev.valuePerShare - 1 : null;
        return `<tr><td>${h.fmtDate(v.uploadedAt.slice(0, 10))}</td><td>${h.esc(v.basis)}</td><td>${h.fmt(v.valuePerShare)}</td>
        <td>${ch == null ? "<span class='dim'>first</span>" : `<span class="${ch >= 0 ? "pos" : "neg"}">${h.pct(ch)}</span>`}</td>
        <td class="file">${h.esc(v.fileName)}</td><td><button class="link-btn" data-action="download-version" data-path="${h.esc(v.xlsx)}" data-name="${h.esc(v.fileName)}">Download</button></td></tr>`;
      }).join("")}</tbody></table></div></section>`;
    }
    el.innerHTML = `<div class="cp">${html}</div>`;
  }

  window.MMCompany = { render };
})();
