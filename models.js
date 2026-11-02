/* Mr. Market – reading transfer sheets.
   Reads an .xlsx file directly in the browser (no external libraries), finds the
   "Transfer sheet" tab, reads every line by its label and recalculates the valuation. */
(function () {
  "use strict";

  /* ---------- 1. unzip (xlsx files are zip archives) ---------- */
  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This is not an Excel (.xlsx) file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const offset = dv.getUint32(p + 42, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, size, offset };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const start = f.offset + 30 + dv.getUint16(f.offset + 26, true) + dv.getUint16(f.offset + 28, true);
        const data = u8.subarray(start, start + f.size);
        return dec.decode(f.method === 8 ? await inflateRaw(data) : data);
      }
    };
  }

  /* ---------- 2. workbook and cells ---------- */
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
  const first = (node, name) => tags(node, name)[0] || null;
  const colNum = letters => letters.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colLetters = n => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  async function readWorkbook(buf) {
    const zip = await readZip(buf);
    const wbText = await zip.text("xl/workbook.xml");
    if (!wbText) throw new Error("This file has no Excel workbook inside.");
    const wb = xml(wbText);
    const rels = xml((await zip.text("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
    const target = {};
    tags(rels, "Relationship").forEach(r => { target[r.getAttribute("Id")] = r.getAttribute("Target"); });
    const sheets = tags(wb, "sheet").map(s => ({
      name: s.getAttribute("name"),
      rid: s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
    }));
    const shared = [];
    const sst = await zip.text("xl/sharedStrings.xml");
    if (sst) tags(xml(sst), "si").forEach(si => shared.push(tags(si, "t").map(t => t.textContent).join("")));
    return {
      sheetNames: sheets.map(s => s.name),
      async sheet(name) {
        const s = sheets.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
        if (!s) return null;
        let path = target[s.rid] || "";
        path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
        const doc = xml(await zip.text(path));
        const cells = {};
        let maxRow = 0;
        tags(doc, "c").forEach(c => {
          const ref = c.getAttribute("r"), t = c.getAttribute("t"), v = first(c, "v"), f = first(c, "f");
          let val;
          const empty = !v || v.textContent === "";
          if (t !== "inlineStr" && empty) val = undefined;
          else if (t === "s") val = v ? shared[+v.textContent] : undefined;
          else if (t === "inlineStr") val = tags(c, "t").map(x => x.textContent).join("");
          else if (t === "str") val = v ? v.textContent : undefined;
          else if (t === "b") val = v ? v.textContent === "1" : undefined;
          else if (t === "e") val = { error: v ? v.textContent : "#ERR" };
          else val = v ? Number(v.textContent) : undefined;
          const m = /^([A-Z]+)(\d+)$/.exec(ref);
          if (m) maxRow = Math.max(maxRow, +m[2]);
          cells[ref] = { v: val, formula: !!f };
        });
        return {
          maxRow,
          cell: (col, row) => cells[(typeof col === "number" ? colLetters(col) : col) + row] || { v: undefined, formula: false },
        };
      }
    };
  }

  /* ---------- 3. transfer sheet → model ---------- */
  const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);
  const SECTIONS = {
    "net sales": "sales", "ebitda": "ebitda", "ebitda to net profit": "pnl", "cash flow items": "cash",
    "calculated cells (do not link)": "calc", "valuation inputs (link or type)": "inputs", "valuation": "valuation"
  };

  async function parseTransferSheet(buf, expectedTicker) {
    const errors = [], warnings = [];
    const wb = await readWorkbook(buf);
    const ws = await wb.sheet("Transfer sheet");
    if (!ws) {
      return { errors: [`No sheet called "Transfer sheet" was found. Sheets in this file: ${wb.sheetNames.join(", ")}.`], warnings };
    }
    const B = r => norm(ws.cell("B", r).v);
    const D = r => ws.cell("D", r).v;

    // settings and header rows
    let headerRow = 0, statusRow = 0, fiscalYear = null, latestQuarter = null, checkCell = null, version = null, tickerCell = null;
    const titleCell = ws.cell("A", 1).v;
    for (let r = 1; r <= ws.maxRow; r++) {
      const lab = B(r);
      if (lab === "line item" && !headerRow) headerRow = r;
      else if (lab === "status" && headerRow && !statusRow) statusRow = r;
      else if (lab === "fiscal year") fiscalYear = num(D(r));
      else if (lab === "latest reported quarter") latestQuarter = D(r);
      else if ((lab === "company ticker" || lab === "ticker") && !headerRow) tickerCell = D(r);
      else if (lab.startsWith("check: any numbers in reported quarters")) checkCell = num(D(r));
      if (r <= 2) {
        for (let c = 1; c <= 20; c++) {
          const v = ws.cell(c, r).v;
          const m = typeof v === "string" && /template version\s*([\d.]+)/i.exec(v);
          if (m) version = m[1];
        }
      }
    }
    if (!headerRow || !statusRow) return { errors: ["Could not find the 'Line item' and 'Status' rows in the transfer sheet."], warnings };

    const firstHead = ws.cell(4, headerRow);
    if (firstHead.formula && firstHead.v === undefined)
      return { errors: ["The values in this file were not saved. Open it in Excel (or Numbers), save it, and upload again."], warnings };
    const periods = [];
    for (let c = 4; c < 40; c++) {
      const label = ws.cell(c, headerRow).v;
      if (label == null || norm(label) === "note" || norm(label) === "") break;
      const status = String(ws.cell(c, statusRow).v || "");
      const L = String(label).trim();
      periods.push({ col: c, label: L, status, kind: /^Q[1-4]/i.test(L) ? "Q" : "FY", q: /^Q([1-4])/i.test(L) ? +L[1] : null });
    }
    if (!periods.length) return { errors: ["The period columns (Q1 … FY) could not be read."], warnings };
    const isFc = p => norm(p.status) === "forecast";

    // read lines by section and label
    const sales = [], ebitda = [], lines = {}, inputs = {}, sheetVals = {};
    let missingValues = 0;
    const rowValues = r => periods.map(p => {
      const cell = ws.cell(p.col, r);
      if (cell.formula && cell.v === undefined && isFc(p)) missingValues++;
      return num(cell.v);
    });
    let section = null;
    for (let r = statusRow + 1; r <= ws.maxRow; r++) {
      const raw = ws.cell("B", r).v, lab = norm(raw);
      if (!lab) continue;
      if (SECTIONS[lab] !== undefined) { section = SECTIONS[lab]; continue; }
      if (section === "sales") {
        if (lab === "total net sales") lines.totalSales = rowValues(r);
        else if (lab.startsWith("eliminations")) lines.elim = rowValues(r);
        else sales.push({ name: String(raw).trim(), values: rowValues(r) });
      } else if (section === "ebitda") {
        if (lab === "total ebitda") lines.totalEbitda = rowValues(r);
        else if (lab.startsWith("central")) lines.central = rowValues(r);
        else ebitda.push({ name: String(raw).trim(), values: rowValues(r) });
      } else if (section === "pnl") {
        if (lab.startsWith("depreciation")) lines.dep = rowValues(r);
        else if (lab.startsWith("amortisation") || lab.startsWith("amortization")) lines.amort = rowValues(r);
        else if (lab.startsWith("net financial")) lines.fin = rowValues(r);
        else if (lab === "income tax") lines.tax = rowValues(r);
      } else if (section === "cash") {
        if (lab === "capex") lines.capex = rowValues(r);
        else if (lab.startsWith("increase in working capital")) lines.nwc = rowValues(r);
      } else if (section === "inputs") {
        const v = D(r);
        if (lab === "wacc") inputs.wacc = num(v);
        else if (lab === "terminal value method") inputs.method = v;
        else if (lab === "terminal growth") inputs.growth = num(v);
        else if (lab.startsWith("exit ev/ebitda")) inputs.multiple = num(v);
        else if (lab.startsWith("net debt")) inputs.netDebt = num(v);
        else if (lab.startsWith("lease liabilities")) inputs.leases = num(v);
        else if (lab.startsWith("earn-outs")) inputs.other = num(v);
        else if (lab.startsWith("shares outstanding")) inputs.shares = num(v);
        else if (lab.startsWith("share price")) inputs.price = num(v);
      } else if (section === "valuation") {
        if (lab === "value per share") sheetVals.vps = num(D(r));
        else if (lab === "enterprise value") sheetVals.ev = num(D(r));
      }
    }

    const tm = typeof titleCell === "string" && /\(([^)]+)\)\s*$/.exec(titleCell);
    const ticker = tickerCell != null && String(tickerCell).trim() ? String(tickerCell).trim() : tm ? tm[1].trim() : null;
    const company = typeof titleCell === "string" ? titleCell.replace(/^.*\u00b7\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim() : null;
    // template 1.2: "Latest reported quarter" holds the full quarter (e.g. "Q3 2026"); older templates use a quarter + fiscal year
    const full = /^Q([1-4])\s+(\d{4})$/.exec(String(latestQuarter || "").trim());
    let basis;
    if (full) { basis = `Q${full[1]} ${full[2]}`; latestQuarter = `Q${full[1]}`; fiscalYear = +full[2]; }
    else {
      const firstQ = periods.find(p => p.kind === "Q" && norm(p.status) !== "actual");
      basis = latestQuarter && fiscalYear ? `${latestQuarter} ${firstQ ? firstQ.label.slice(3) : fiscalYear}` : null;
    }
    const model = {
      schema: 1, ticker, company, templateVersion: version, fiscalYear, latestQuarter, basis,
      periods: periods.map(({ label, status, kind, q }) => ({ label, status, kind, q })),
      segments: sales.map(s => s.name), sales, ebitda, lines, inputs, sheet: sheetVals
    };

    // ---------- checks ----------
    if (missingValues) errors.push("Some values were not saved in the file. Open it in Excel (or Numbers), save it, and upload again.");
    if (!sales.length) errors.push("No business areas were found under NET SALES.");
    const need = [["dep", "Depreciation"], ["amort", "Amortisation of intangibles"], ["tax", "Income tax"], ["capex", "Capex"], ["nwc", "Increase in working capital"]];
    const emptyCells = [];
    periods.forEach((p, i) => {
      if (!isFc(p)) return;
      sales.forEach(s => { if (s.values[i] == null) emptyCells.push(`${s.name} sales, ${p.label}`); });
      ebitda.forEach(s => { if (s.values[i] == null) emptyCells.push(`${s.name} EBITDA, ${p.label}`); });
      need.forEach(([k, n]) => { if (!lines[k] || lines[k][i] == null) emptyCells.push(`${n}, ${p.label}`); });
    });
    if (emptyCells.length) errors.push(`${emptyCells.length} forecast cell${emptyCells.length > 1 ? "s are" : " is"} empty, e.g. ${emptyCells.slice(0, 3).join("; ")}.`);
    if (inputs.wacc == null) errors.push("WACC is missing.");
    else if (inputs.wacc < 0.01 || inputs.wacc > 0.3) errors.push(`WACC of ${(inputs.wacc * 100).toFixed(1)}% looks wrong. Enter it as a percentage, e.g. 9%.`);
    const growthMethod = norm(inputs.method) === "terminal growth";
    if (!inputs.method) errors.push("The terminal value method is not chosen.");
    else if (growthMethod && inputs.growth == null) errors.push("Terminal growth is missing.");
    else if (growthMethod && inputs.wacc != null && inputs.growth >= inputs.wacc) errors.push("Terminal growth must be lower than the WACC.");
    else if (!growthMethod && inputs.multiple == null) errors.push("The exit EV/EBITDA multiple is missing.");
    if (!inputs.shares) errors.push("Shares outstanding is missing.");

    if (!version) warnings.push("No template version found. This may be an older transfer sheet.");
    if (expectedTicker && ticker && ticker.toUpperCase() !== expectedTicker.toUpperCase())
      warnings.push(`The sheet is for ${ticker}, but you are uploading it to ${expectedTicker}.`);
    if (checkCell) warnings.push(`${checkCell} reported-quarter cell${checkCell > 1 ? "s contain" : " contains"} numbers. Mr. Market ignores them.`);

    let result = null;
    if (!errors.length) {
      result = computeValuation(model);
      // totals in the sheet should match what Mr. Market calculates
      const off = (arr, calc) => arr && periods.some((p, i) => isFc(p) && arr[i] != null && Math.abs(arr[i] - calc[i]) > 1);
      if (off(lines.totalSales, result.sales)) warnings.push("Total net sales in the sheet differ from the sum of the business areas.");
      if (off(lines.totalEbitda, result.ebitda)) warnings.push("Total EBITDA in the sheet differs from the sum of the business areas.");
      if (sheetVals.vps != null && Math.abs(result.vps - sheetVals.vps) > Math.max(0.01, Math.abs(sheetVals.vps) * 0.005))
        warnings.push(`The sheet's own value per share (${sheetVals.vps.toFixed(2)}) differs from Mr. Market's (${result.vps.toFixed(2)}). Check that the valuation formulas are unchanged.`);
    }
    return { errors, warnings, model, result };
  }

  /* ---------- 4. valuation (same method as the transfer sheet) ---------- */
  function computeValuation(model) {
    const P = model.periods, L = model.lines, I = model.inputs;
    const v = (arr, i) => (arr && arr[i] != null ? arr[i] : 0);
    const rep = P.filter(p => p.kind === "Q" && norm(p.status) === "reported").length;
    const out = { sales: [], ebitda: [], ebit: [], fcf: [], t: [], df: [], pv: [], taxRate: [], capex: [], forecast: [] };
    let year = 0;
    P.forEach((p, i) => {
      const fc = norm(p.status) === "forecast";
      out.forecast.push(fc);
      const sales = model.sales.reduce((s, x) => s + v(x.values, i), 0) - v(L.elim, i);
      const ebitda = model.ebitda.reduce((s, x) => s + v(x.values, i), 0) - v(L.central, i);
      const ebit = ebitda - v(L.dep, i) - v(L.amort, i);
      const pbt = ebit - v(L.fin, i);
      const rate = pbt <= 0 ? 0 : v(L.tax, i) / pbt;
      const fcf = ebit * (1 - rate) + v(L.dep, i) + v(L.amort, i) - v(L.capex, i) - v(L.nwc, i);
      const t = p.kind === "Q" ? (p.q - rep - 0.5) / 4 : (4 - rep) / 4 + (year++) + 0.5;
      const df = 1 / Math.pow(1 + I.wacc, t);
      out.sales.push(fc ? sales : null); out.ebitda.push(fc ? ebitda : null); out.ebit.push(fc ? ebit : null);
      out.taxRate.push(fc ? rate : null); out.capex.push(fc ? v(L.capex, i) : null);
      out.fcf.push(fc ? fcf : null); out.t.push(fc ? t : null); out.df.push(fc ? df : null); out.pv.push(fc ? fcf * df : null);
    });
    const last = P.length - 1;
    out.sumPv = out.pv.reduce((s, x) => s + (x || 0), 0);
    const growth = norm(I.method) === "terminal growth";
    out.tv = growth ? out.fcf[last] * (1 + I.growth) / (I.wacc - I.growth) : out.ebitda[last] * I.multiple;
    out.tvYears = growth ? out.t[last] : out.t[last] + 0.5;
    out.pvTv = out.tv / Math.pow(1 + I.wacc, out.tvYears);
    out.ev = out.sumPv + out.pvTv;
    out.netDebt = I.netDebt || 0; out.leases = I.leases || 0; out.other = I.other || 0;
    out.equity = out.ev - out.netDebt - out.leases - out.other;
    out.vps = out.equity / I.shares;
    return out;
  }

  /* ---------- 5. historical data file (actuals/<TICKER>_actuals.xlsx) ---------- */
  // Returns {annual:{periods:[...], get(label)}, quarterly:{...}} with lines found by their label in column B.
  async function readActuals(buf) {
    const wb = await readWorkbook(buf);
    const out = {};
    for (const name of ["Annual", "Quarterly", "Segments"]) {
      const ws = await wb.sheet(name);
      if (!ws) continue;
      let hdr = 0;
      for (let r = 1; r <= Math.min(ws.maxRow, 10); r++) if (norm(ws.cell("B", r).v) === "line item") { hdr = r; break; }
      if (!hdr) continue;
      const periods = [];
      for (let c = 4; c < 60; c++) {
        const v = ws.cell(c, hdr).v;
        if (v == null || v === "" || /source|note/i.test(String(v))) break;
        periods.push(String(v).trim());
      }
      const rows = {};
      let section = "";
      for (let r = hdr + 1; r <= ws.maxRow; r++) {
        const raw = ws.cell("B", r).v, lab = norm(raw);
        if (!lab) continue;
        // section headers: upper-case text without a unit (e.g. "NET SALES BY BUSINESS AREA")
        if (ws.cell("C", r).v == null && String(raw) === String(raw).toUpperCase()) { section = lab; continue; }
        const key = name === "Segments" ? section + "|" + lab : lab;
        if (rows[key]) continue;
        rows[key] = periods.map((_, i) => num(ws.cell(4 + i, r).v));
      }
      out[name.toLowerCase()] = {
        periods,
        get(label) {
          const n = norm(label), keys = Object.keys(rows);
          const k = keys.find(x => x === n) || keys.find(x => x.startsWith(n));
          return k ? rows[k] : periods.map(() => null);
        },
        value(label, period) { const i = periods.indexOf(period); return i < 0 ? null : this.get(label)[i]; },
        // Segments: value("net sales by business area", "Fiber Solutions", "Q3 2026")
        seg(section, label, period) {
          const i = periods.indexOf(period); if (i < 0) return null;
          const sec = norm(section), lab = norm(label);
          const k = Object.keys(rows).find(x => x.startsWith(sec) && x.endsWith("|" + lab));
          return k ? rows[k][i] : null;
        }
      };
    }
    return out;
  }

  /* ---------- history (the 4 reported quarters in template 1.2) ---------- */
  function quartersBack(Q, n) {
    let q = +Q[1], y = +Q.slice(3); const out = [];
    for (let k = 0; k < n; k++) { out.unshift(`Q${q} ${y}`); if (q > 1) q--; else { q = 4; y--; } }
    return out;
  }
  // official figures for one quarter, in transfer-sheet terms
  function historyRow(A, Q) {
    const qv = k => (A && A.quarterly ? A.quarterly.value(k, Q) : null), S = A && A.segments;
    const sg = (sec, name) => (S ? S.seg(sec, name, Q) : null);
    return {
      sales: name => sg("net sales by business area", name), ebitda: name => sg("adjusted ebitda by business area", name),
      elim: sg("net sales by business area", "eliminations"), central: sg("adjusted ebitda by business area", "central costs & eliminations"),
      dep: qv("depreciation"), amort: qv("amortisation"), fin: qv("net financial costs"), tax: qv("income tax"),
      capex: qv("capex"), nwc: qv("increase in working capital (cash flow)"), hasData: qv("net sales") != null
    };
  }
  // set the history columns of a model (JSON) to the 4 quarters ending with Q
  function refreshHistory(m, A, Q) {
    const idx = m.periods.map((p, i) => i).filter(i => norm(m.periods[i].status) === "actual");
    if (!idx.length) return m;
    const labels = quartersBack(Q, idx.length);
    idx.forEach((i, k) => {
      const h = historyRow(A, labels[k]);
      m.periods[i].label = labels[k]; m.periods[i].q = +labels[k][1];
      m.sales.forEach(sg => { sg.values[i] = h.sales(sg.name); });
      m.ebitda.forEach(sg => { sg.values[i] = h.ebitda(sg.name); });
      ["elim", "central", "dep", "amort", "fin", "tax", "capex", "nwc"].forEach(k2 => { if (m.lines[k2]) m.lines[k2][i] = h[k2]; });
    });
    return m;
  }
  // option 1 check: does the history in the user's sheet match the reported figures?
  function compareHistory(model, A) {
    const out = { diffs: [], empty: 0, stale: false };
    const idx = model.periods.map((p, i) => i).filter(i => norm(model.periods[i].status) === "actual");
    if (!idx.length || !A) return out;
    out.stale = model.basis && model.periods[idx[idx.length - 1]].label !== model.basis;
    if (out.stale) return out;
    const f = x => Math.round(x).toLocaleString("en-US");
    idx.forEach(i => {
      const Q = model.periods[i].label, h = historyRow(A, Q);
      const check = (what, u, o) => {
        if (u == null) { if (o != null) out.empty++; return; }
        if (o != null && Math.abs(u - o) > Math.max(1, Math.abs(o) * 0.01)) out.diffs.push(`${Q} ${what}: ${f(u)} in your sheet, ${f(o)} reported`);
      };
      model.sales.forEach(sg => check(`${sg.name} sales`, sg.values[i], h.sales(sg.name)));
      model.ebitda.forEach(sg => check(`${sg.name} EBITDA`, sg.values[i], h.ebitda(sg.name)));
      [["dep", "depreciation"], ["amort", "amortisation"], ["fin", "net financial costs"], ["tax", "income tax"], ["capex", "capex"], ["nwc", "working capital"]]
        .forEach(([k, n]) => model.lines[k] && check(n, model.lines[k][i], h[k]));
    });
    return out;
  }

  /* ---------- 6. roll a model forward with a reported quarter ----------
     Only facts change: the quarter becomes reported (actual figures), the balance sheet moves to the quarter end
     and the valuation date with it. All forecasts and valuation assumptions stay exactly as the user set them. */
  function rollForward(model, A, Q) {
    const i = model.periods.findIndex(p => p.label === Q && norm(p.status) === "forecast");
    if (i < 0) return { error: `The model has no forecast for ${Q}` };
    if (+Q[1] === 4) return { error: "At year-end the model needs next year's quarterly forecasts, so please update it yourself", yearEnd: true };
    if (!A || !A.quarterly) return { error: "No historical data" };
    const qv = k => A.quarterly.value(k, Q), S = A.segments;
    const bs = { netDebt: qv("net debt"), leases: qv("lease liabilities"), other: qv("earn-outs"), shares: qv("shares outstanding") };
    if (Object.values(bs).some(v => v == null)) return { error: `Balance sheet for ${Q} is missing in the historical data` };
    if (qv("net sales") == null) return { error: `Net sales for ${Q} are missing` };
    const clone = x => JSON.parse(JSON.stringify(x));
    // value bridge, one change at a time
    const base = computeValuation(model), sh0 = model.inputs.shares;
    const mA = clone(model); mA.periods[i].status = "Reported";
    const v1 = computeValuation(mA).vps;
    const cashRemoved = -(base.pv[i] || 0) / sh0, time = v1 - base.vps - cashRemoved;
    const mB = clone(mA); mB.inputs.netDebt = bs.netDebt;
    const v2 = computeValuation(mB).vps;
    const m = clone(mA); Object.assign(m.inputs, bs);
    // actual figures in the reported column (for reference; the valuation only uses forecast periods)
    m.sales.forEach(sg => { sg.values[i] = S ? S.seg("net sales by business area", sg.name, Q) : null; });
    m.ebitda.forEach(sg => { sg.values[i] = S ? S.seg("adjusted ebitda by business area", sg.name, Q) : null; });
    const set = (k, v) => { if (m.lines[k]) m.lines[k][i] = v == null ? null : v; };
    set("elim", S ? S.seg("net sales by business area", "eliminations", Q) : null);
    set("central", S ? S.seg("adjusted ebitda by business area", "central costs & eliminations", Q) : null);
    set("dep", qv("depreciation")); set("amort", qv("amortisation")); set("fin", qv("net financial costs"));
    set("tax", qv("income tax")); set("capex", qv("capex")); set("nwc", qv("increase in working capital (cash flow)"));
    m.latestQuarter = "Q" + m.periods[i].q; m.basis = Q;
    refreshHistory(m, A, Q);
    const fin = computeValuation(m);
    m.valueBridge = { quarter: Q, base: base.vps, time, cash: cashRemoved + (v2 - v1), other: fin.vps - v2, final: fin.vps };
    return { model: m, result: fin };
  }


  /* ---------- 7. writing: change a few cells in an .xlsx, keep everything else as it is ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflateRaw(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function zipEntries(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not a zip file");
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = [];
    for (let k = 0; k < n; k++) {
      const e = { flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true), time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true),
        crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true) };
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      e.nameBytes = u8.slice(p + 46, p + 46 + nl); e.name = dec.decode(e.nameBytes);
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      e.data = u8.slice(start, start + e.csize);
      out.push(e); p += 46 + nl + xl + cl;
    }
    return out;
  }
  async function entryText(e) { return new TextDecoder().decode(e.method === 8 ? await inflateRaw(e.data) : e.data); }
  async function setEntryText(e, text) {
    const raw = new TextEncoder().encode(text);
    e.crc = crc32(raw); e.size = raw.length; e.data = await deflateRaw(raw); e.csize = e.data.length; e.method = 8;
  }
  function writeZip(entries) {
    const parts = [], central = []; let off = 0;
    entries.forEach(e => {
      const flags = e.flags & ~0x0008, h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, flags, true); h.setUint16(8, e.method, true);
      h.setUint16(10, e.time, true); h.setUint16(12, e.date, true); h.setUint32(14, e.crc, true); h.setUint32(18, e.csize, true);
      h.setUint32(22, e.size, true); h.setUint16(26, e.nameBytes.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), e.nameBytes, e.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, flags, true); c.setUint16(10, e.method, true);
      c.setUint16(12, e.time, true); c.setUint16(14, e.date, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.csize, true); c.setUint32(24, e.size, true);
      c.setUint16(28, e.nameBytes.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), e.nameBytes);
      off += 30 + e.nameBytes.length + e.data.length;
    });
    const cdSize = central.reduce((s2, x) => s2 + x.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
  }
  const escXml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const refParts = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return { col: colNum(m[1]), row: +m[2] }; };
  function inRange(ref, range) {
    const [a, b] = range.split(":"); const r = refParts(ref), A1 = refParts(a), B1 = refParts(b || a);
    return r.col >= A1.col && r.col <= B1.col && r.row >= A1.row && r.row <= B1.row;
  }
  // edits: { "D22": {s: "Q3 2026"} | {v: 123} | {v: null} }
  function editSheetXml(xmlText, edits) {
    const pm = /<(\w+:)?sheetData[\s>/]/.exec(xmlText); if (!pm) throw new Error("Unexpected sheet format");
    const P = pm[1] || "", refs = Object.keys(edits);
    const cellRe = ref => new RegExp(`<${P}c r="${ref}"(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</${P}c>)`);
    const build = (ref, style, e) => {
      const s = style ? ` s="${style}"` : "";
      if (e.s != null) return `<${P}c r="${ref}"${s} t="inlineStr"><${P}is><${P}t>${escXml(e.s)}</${P}t></${P}is></${P}c>`;
      if (e.v == null || !isFinite(e.v)) return `<${P}c r="${ref}"${s}/>`;
      return `<${P}c r="${ref}"${s}><${P}v>${+(+e.v).toFixed(6)}</${P}v></${P}c>`;
    };
    for (const ref of refs) {
      const m = cellRe(ref).exec(xmlText);
      if (m) {
        const old = m[0], sm = / s="(\d+)"/.exec(old.slice(0, old.indexOf(">") + 1));
        const shared = /<(?:\w+:)?f[^>]*\bt="(shared|array)"[^>]*\bref="([A-Z]+\d+(?::[A-Z]+\d+)?)"/.exec(old);
        if (shared) {
          const [a, b] = shared[2].split(":"), A1 = refParts(a), B1 = refParts(b || a);
          for (let r = A1.row; r <= B1.row; r++) for (let c = A1.col; c <= B1.col; c++) {
            const rr = colLetters(c) + r;
            if (!edits[rr]) throw new Error(`Cell ${ref} starts a shared formula (${shared[2]}); the file was not changed`);
          }
        }
        xmlText = xmlText.replace(old, build(ref, sm && sm[1], edits[ref]));
      } else {
        const { row, col } = refParts(ref);
        const rowRe = new RegExp(`<${P}row r="${row}"(?=[\\s>/])[^>]*?(/>|>[\\s\\S]*?</${P}row>)`);
        const rm = rowRe.exec(xmlText), cell = build(ref, null, edits[ref]);
        if (rm) {
          let rowXml = rm[0];
          if (rm[1] === "/>") rowXml = rowXml.replace(/\/>$/, `>${cell}</${P}row>`);
          else {
            const cells = [...rowXml.matchAll(new RegExp(`<${P}c r="([A-Z]+)\\d+"`, "g"))];
            const next = cells.find(x => colNum(x[1]) > col);
            rowXml = next ? rowXml.replace(next[0], cell + next[0]) : rowXml.replace(new RegExp(`</${P}row>$`), cell + `</${P}row>`);
          }
          xmlText = xmlText.replace(rm[0], rowXml);
        } else {
          const rows = [...xmlText.matchAll(new RegExp(`<${P}row r="(\\d+)"`, "g"))], nxt = rows.find(x => +x[1] > row);
          const newRow = `<${P}row r="${row}">${cell}</${P}row>`;
          if (nxt) xmlText = xmlText.replace(nxt[0], newRow + nxt[0]);
          else if (new RegExp(`<${P}sheetData/>`).test(xmlText)) xmlText = xmlText.replace(`<${P}sheetData/>`, `<${P}sheetData>${newRow}</${P}sheetData>`);
          else xmlText = xmlText.replace(`</${P}sheetData>`, newRow + `</${P}sheetData>`);
        }
      }
    }
    return xmlText;
  }
  async function editWorkbookCells(buf, sheetName, edits) {
    const entries = zipEntries(buf), get = name => entries.find(e => e.name === name);
    const wbE = get("xl/workbook.xml"), relE = get("xl/_rels/workbook.xml.rels");
    if (!wbE || !relE) throw new Error("This file has no Excel workbook inside");
    let wbX = await entryText(wbE); const relX = await entryText(relE);
    const sm = new RegExp(`<(?:\\w+:)?sheet [^>]*name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`, "i").exec(wbX);
    if (!sm) throw new Error(`No sheet called "${sheetName}"`);
    const rid = (/r:id="([^"]+)"/.exec(sm[0]) || /\bid="([^"]+)"/.exec(sm[0]) || [])[1];
    const tm = new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`).exec(relX), target = tm && /Target="([^"]+)"/.exec(tm[0])[1];
    if (!target) throw new Error("Sheet not found in the workbook");
    const path = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const shE = get(path); if (!shE) throw new Error("Sheet data not found");
    await setEntryText(shE, editSheetXml(await entryText(shE), edits));
    // Excel recalculates everything when the file is opened
    if (/<(\w+:)?calcPr\b/.test(wbX)) wbX = wbX.replace(/<((?:\w+:)?calcPr)\b([^>]*?)(\/?)>/, (m0, tag, attrs, sl) => `<${tag}${attrs.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${sl}>`);
    else wbX = wbX.replace(/(<(?:\w+:)?extLst|<\/(?:\w+:)?workbook>)/, `<calcPr fullCalcOnLoad="1"/>$1`);
    await setEntryText(wbE, wbX);
    // the calculation chain would point at cells that are no longer formulas: let Excel rebuild it
    const cc = entries.findIndex(e => e.name === "xl/calcChain.xml");
    if (cc >= 0) {
      entries.splice(cc, 1);
      await setEntryText(relE, relX.replace(/<Relationship [^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
      const ctE = get("[Content_Types].xml");
      if (ctE) await setEntryText(ctE, (await entryText(ctE)).replace(/<Override [^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    }
    return writeZip(entries);
  }

  /* ---------- 8. put a reported quarter into a transfer sheet (Mr. Market's own cells only) ----------
     opts.historyOnly: only the history columns (used when you upload your own update)
     opts.onlyEmpty:   leave history cells you filled in yourself */
  async function applyQuarterToSheet(buf, A, Q, opts = {}) {
    const wb = await readWorkbook(buf), ws = await wb.sheet("Transfer sheet");
    if (!ws) return { error: 'No sheet called "Transfer sheet"' };
    const B = r => norm(ws.cell("B", r).v);
    let headerRow = 0, statusRow = 0, latestRow = 0, fyRow = 0, section = null;
    const rows = { sales: {}, ebitda: {} }, inputs = {};
    for (let r = 1; r <= ws.maxRow; r++) {
      const lab = B(r), raw = String(ws.cell("B", r).v || "").trim();
      if (!lab) continue;
      if (lab === "line item" && !headerRow) { headerRow = r; continue; }
      if (lab === "status" && headerRow && !statusRow) { statusRow = r; continue; }
      if (lab === "latest reported quarter") { latestRow = r; continue; }
      if (lab === "fiscal year") { fyRow = r; continue; }
      if (SECTIONS[lab] !== undefined) { section = SECTIONS[lab]; continue; }
      if (section === "sales") { if (lab.startsWith("eliminations")) rows.elim = r; else if (lab !== "total net sales") rows.sales[raw] = r; }
      else if (section === "ebitda") { if (lab.startsWith("central")) rows.central = r; else if (lab !== "total ebitda") rows.ebitda[raw] = r; }
      else if (section === "pnl") {
        if (lab.startsWith("depreciation")) rows.dep = r; else if (lab.startsWith("amortisation") || lab.startsWith("amortization")) rows.amort = r;
        else if (lab.startsWith("net financial")) rows.fin = r; else if (lab === "income tax") rows.tax = r;
      } else if (section === "cash") { if (lab === "capex") rows.capex = r; else if (lab.startsWith("increase in working capital")) rows.nwc = r; }
      else if (section === "inputs") {
        if (lab.startsWith("net debt")) inputs.netDebt = r; else if (lab.startsWith("lease liabilities")) inputs.leases = r;
        else if (lab.startsWith("earn-outs")) inputs.other = r; else if (lab.startsWith("shares outstanding")) inputs.shares = r;
      }
    }
    if (!headerRow || !statusRow || !latestRow) return { error: "The transfer sheet layout was not recognised" };
    const histCols = [];
    for (let c = 4; c < 40; c++) { const st = norm(ws.cell(c, statusRow).v); if (st === "actual") histCols.push(c); if (ws.cell(c, headerRow).v == null) break; }
    const full = /^Q[1-4]\s+\d{4}$/.test(String(ws.cell("D", latestRow).v || "").trim());
    const edits = {};
    if (!opts.historyOnly) {
      if (+Q[1] === 4) return { error: "At year-end the model needs next year's quarterly forecasts, so please update it yourself", yearEnd: true };
      if (full) edits["D" + latestRow] = { s: Q };
      else {
        const fy = num(ws.cell("D", fyRow).v);
        if (fy !== +Q.slice(3)) return { error: `The sheet's fiscal year (${fy}) does not match ${Q}` };
        edits["D" + latestRow] = { s: Q.slice(0, 2) };
      }
      const qv = k => A.quarterly.value(k, Q);
      const bs = { netDebt: qv("net debt"), leases: qv("lease liabilities"), other: qv("earn-outs"), shares: qv("shares outstanding") };
      if (Object.values(bs).some(v => v == null)) return { error: `The balance sheet for ${Q} is missing in the historical data` };
      const day = { 1: "31 Mar", 2: "30 Jun", 3: "30 Sep", 4: "31 Dec" }[+Q[1]] + " " + Q.slice(3);
      Object.entries(inputs).forEach(([k, r]) => {
        edits["D" + r] = { v: bs[k] };
        const note = ws.cell("E", r).v;
        if (typeof note === "string" && /\d{1,2} [A-Z][a-z]{2} \d{4}/.test(note)) edits["E" + r] = { s: note.replace(/\d{1,2} [A-Z][a-z]{2} \d{4}/, day) };
      });
    }
    if (full && histCols.length) {
      const labels = quartersBack(Q, histCols.length);
      histCols.forEach((c, k) => {
        const col = colLetters(c), sameLabel = String(ws.cell(c, headerRow).v || "").trim() === labels[k];
        edits[col + headerRow] = { s: labels[k] };
        const h = historyRow(A, labels[k]);
        const put = (r, val) => { if (!r) return; if (opts.onlyEmpty && sameLabel && num(ws.cell(c, r).v) != null) return; edits[col + r] = { v: val }; };
        Object.entries(rows.sales).forEach(([n, r]) => put(r, h.sales(n)));
        Object.entries(rows.ebitda).forEach(([n, r]) => put(r, h.ebitda(n)));
        ["elim", "central", "dep", "amort", "fin", "tax", "capex", "nwc"].forEach(k2 => put(rows[k2], h[k2]));
      });
    }
    if (!Object.keys(edits).length) return { bytes: null, unchanged: true };
    try { return { bytes: await editWorkbookCells(buf, "Transfer sheet", edits), edits: Object.keys(edits).length }; }
    catch (e) { return { error: e.message || String(e) }; }
  }

  window.MMModels = { VERSION: "0.26", readWorkbook, parseTransferSheet, computeValuation, readActuals, rollForward, refreshHistory, compareHistory, applyQuarterToSheet, quartersBack };
})();
