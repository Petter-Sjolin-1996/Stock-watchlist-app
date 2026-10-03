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
    let headerRow = 0, statusRow = 0, fiscalYear = null, latestQuarter = null, checkCell = null, version = null;
    const titleCell = ws.cell("A", 1).v;
    for (let r = 1; r <= ws.maxRow; r++) {
      const lab = B(r);
      if (lab === "line item" && !headerRow) headerRow = r;
      else if (lab === "status" && headerRow && !statusRow) statusRow = r;
      else if (lab === "fiscal year") fiscalYear = num(D(r));
      else if (lab === "latest reported quarter") latestQuarter = D(r);
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
    const ticker = tm ? tm[1].trim() : null;
    const company = typeof titleCell === "string" ? titleCell.replace(/^.*\u00b7\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim() : null;
    const model = {
      schema: 1, ticker, company, templateVersion: version, fiscalYear, latestQuarter,
      basis: latestQuarter && fiscalYear ? `${latestQuarter} ${periods[0] && periods[0].kind === "Q" ? periods[0].label.slice(3) : fiscalYear}` : null,
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
    for (const name of ["Annual", "Quarterly"]) {
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
      for (let r = hdr + 1; r <= ws.maxRow; r++) {
        const lab = norm(ws.cell("B", r).v);
        if (!lab || rows[lab]) continue;
        rows[lab] = periods.map((_, i) => num(ws.cell(4 + i, r).v));
      }
      out[name.toLowerCase()] = {
        periods,
        get(label) {
          const n = norm(label), keys = Object.keys(rows);
          const k = keys.find(x => x === n) || keys.find(x => x.startsWith(n));
          return k ? rows[k] : periods.map(() => null);
        },
        value(label, period) { const i = periods.indexOf(period); return i < 0 ? null : this.get(label)[i]; }
      };
    }
    return out;
  }

  window.MMModels = { VERSION: "0.19", readWorkbook, parseTransferSheet, computeValuation, readActuals };
})();
