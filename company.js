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

  /* stacked bars (segments) with a line on a second axis (EBITDA margin) */
  function stackedChart(labels, series, line, h) {
    const W = 660, H = 270, l = 44, r = 48, t = 18, b = 34, cw = W - l - r, ch = H - t - b;
    const totals = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] || 0), 0));
    const max = niceMax(Math.max(...totals) * 1.05);
    const n = Math.round(max / niceStep(max / 4));
    const lmax = line ? niceStep(Math.max(...line.values.filter(v => v != null)) * 1.15 / n) * n : 1;
    const bw = cw / labels.length, y = v => t + ch - v / max * ch, yl = v => t + ch - v / lmax * ch;
    let g = "";
    for (let i = 0; i <= n; i++) {
      const v = max * i / n, yy = y(v);
      g += `<line x1="${l}" x2="${W - r}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${l - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${k(v)}</text>`;
      if (line) g += `<text x="${W - r + 6}" y="${yy + 4}" font-size="11" fill="var(--muted)">${(lmax * i / n * 100).toFixed(1).replace(/\.0$/, "")}%</text>`;
    }
    labels.forEach((lab, i) => {
      let acc = 0;
      series.forEach((s, j) => {
        const v = Math.max(0, s.values[i] || 0), y0 = y(acc), y1 = y(acc + v);
        g += `<rect x="${l + i * bw + bw * 0.18}" y="${y1}" width="${bw * 0.64}" height="${Math.max(0, y0 - y1)}" fill="${SEG_COLORS[j % SEG_COLORS.length]}"><title>${h.esc(s.name)} ${h.esc(lab)}: ${h.fmt(v, 0)}</title></rect>`;
        acc += v;
      });
      g += `<text x="${l + i * bw + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${h.esc(lab.replace(/^FY /, ""))}</text>`;
    });
    if (line) {
      const pts = line.values.map((v, i) => v == null ? null : `${l + i * bw + bw / 2},${yl(v)}`).filter(Boolean);
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
      line.values.forEach((v, i) => { if (v != null) g += `<circle cx="${l + i * bw + bw / 2}" cy="${yl(v)}" r="3.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"><title>${h.esc(line.name)} ${h.esc(labels[i])}: ${(v * 100).toFixed(1)}%</title></circle>`; });
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Net sales by business area and EBITDA margin">${g}</svg>`;
  }

  /* simple bars that can be negative */
  function barChart(labels, values, h) {
    const W = 420, H = 230, l = 40, r = 10, t = 16, b = 34, cw = W - l - r, ch = H - t - b;
    const hi = niceMax(Math.max(0, ...values) * 1.1), lo = Math.min(0, ...values) < 0 ? -niceMax(-Math.min(...values) * 1.1) : 0;
    const y = v => t + (hi - v) / (hi - lo) * ch, bw = cw / labels.length;
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4;
      g += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${k(v)}</text>`;
    }
    values.forEach((v, i) => {
      const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
      g += `<rect x="${l + i * bw + bw * 0.2}" y="${y0}" width="${bw * 0.6}" height="${Math.max(1, y1 - y0)}" rx="2" fill="${v >= 0 ? "var(--blue)" : "var(--down)"}"><title>${h.esc(labels[i])}: ${h.fmt(v, 0)}</title></rect>`;
      g += `<text x="${l + i * bw + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${h.esc(labels[i])}</text>`;
    });
    g += `<line x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Free cash flow">${g}</svg>`;
  }

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

    // ---- visuals from the latest model
    if (data && result) {
      const P = data.periods, fc = P.map(p => p.status.toLowerCase() === "forecast");
      const yi = P.map((p, i) => i).filter(i => fc[i] && P[i].kind === "FY");
      const labels = yi.map(i => P[i].label);
      const series = data.sales.map(sg => ({ name: sg.name, values: yi.map(i => sg.values[i]) }));
      const margin = { name: "EBITDA margin", values: yi.map(i => result.sales[i] ? result.ebitda[i] / result.sales[i] : null) };
      const legend = data.sales.map((sg, j) => `<span><i style="background:${SEG_COLORS[j % SEG_COLORS.length]}"></i>${h.esc(sg.name)}</span>`).join("") + `<span><i class="ln"></i>EBITDA margin (right axis)</span>`;
      html += `<section class="card cp-chart"><h2>Your forecast: net sales by business area</h2><p class="sub">SEK m per year, with your EBITDA margin.</p>${stackedChart(labels, series, margin, h)}<div class="legend">${legend}</div></section>`;

      const qi = P.map((p, i) => i).filter(i => fc[i] && P[i].kind === "Q");
      const qLabel = qi.length > 1 ? `Q${P[qi[0]].q}–Q4` : qi.length ? `Q4` : null;
      const fLabels = (qi.length ? [qLabel] : []).concat(labels.map(x => x.replace(/^FY /, "")));
      const fVals = (qi.length ? [qi.reduce((s, i) => s + result.fcf[i], 0)] : []).concat(yi.map(i => result.fcf[i]));
      const steps = [
        { label: "Cash flows\n2026–" + labels[labels.length - 1].slice(-2), value: result.sumPv },
        { label: "Terminal\nvalue", value: result.pvTv },
        { label: "Enterprise\nvalue", value: result.ev, total: true },
        { label: "Net\ndebt", value: -result.netDebt },
        { label: "Lease\nliabilities", value: -result.leases },
        { label: "Earn-outs\n& options", value: -result.other },
        { label: "Equity\nvalue", value: result.equity, total: true }
      ];
      html += `<div class="cp-grid">
        <section class="card cp-chart"><h2>Free cash flow</h2><p class="sub">SEK m, cash left for lenders and shareholders.</p>${barChart(fLabels, fVals, h)}</section>
        <section class="card cp-chart"><h2>From cash flows to value</h2><p class="sub">Present values, SEK m. ${h.fmt(result.equity, 0)} / ${h.fmt(data.inputs.shares)} m shares = <b>SEK ${h.fmt(result.vps)}</b> per share.</p>${waterfall(steps, h)}</section>
      </div>`;

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
