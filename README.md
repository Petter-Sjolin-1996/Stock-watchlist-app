# Mr. Market

A personal stock watchlist that keeps DCF models alive: compare today's share price with your own valuation,
see your forecast before each quarterly report, and track actual results against your assumptions.

## How it is built

- **This repo (public):** the app itself, served by GitHub Pages. Plain HTML/JavaScript, no build step, no secrets.
- **Data repo (private, added later):** watchlist, parsed transfer sheets and model history as JSON,
  read and written through the GitHub Contents API with a fine-grained token limited to that repo.

## Transfer sheet

Each company model includes a standardised transfer sheet (Forecast, Valuation, Actuals quarterly,
Actuals annual). The app reads rows by their labels, not by cell addresses.

## Status

- v0.1: watchlist page with placeholder prices; Hexatronic valuation from transfer sheet v3.
- v0.2: multiple watchlists (create, switch, rename, delete with double confirmation), search-and-add, day change in % or SEK, sortable columns, next report column, blue theme.
- v0.3: removed chart card and report banner; round country flags; Price / Key figures / History tabs like Avanza with averages row.
- v0.4: first column renamed Company; first tab renamed Value vs. price.
- v0.5: Mr. Market top bar; cache-busting version tags on styles.css and app.js.
- v0.6: real end-of-day prices, key figures, history and report dates from Yahoo Finance via a nightly GitHub Actions job in the private data repo; Settings dialog for the GitHub connection.
- v0.7: 'as of' date under each last price (or 'demo price' when not connected).
- v0.8: Refresh prices button that starts the data workflow from the app and reloads when done (token needs Actions: Read and write).
- v0.9: automatic update check via version.json, so new releases load without private browsing.

## Releasing a new version
Bump the number in four places: `version.json`, `APP_VERSION` in `app.js`, and the two `?v=` tags in `index.html`.
- v0.10: company page (value, model card, charts, key assumptions, version history); upload a full DCF or transfer sheet, review checks, save to the data repo; download transfer sheet template, latest model and earlier versions.
- v0.11: key chart on the company page (Revenue, EBITDA, EBIT, Net income, Free cash flow) with actual history from actuals/<TICKER>_actuals.xlsx and your forecast; CAGR arrows, margin and EPS pills; download historical data.
- v0.12: chart redesign (fixed selector, legend top-right, notes bottom-left, no y-axis, grey actual area, thinner CAGR arrows, coloured pills), ROIC view, waterfall in the same style, Download historical data in the model card.
- v0.13: labels of negative bars kept clear of the x-axis; CAGR n/a for negative start or end values; 'Download historical financials'.
- v0.14: valuation card with value-per-share panel (share price, upside) and a WACC slider with reset to the model's WACC.
- v0.15: 'Match share price' sets the WACC so your value equals today's share price (market-implied return); neutral label at 0.0% upside.
- v0.16: button renamed to 'Implied return'.
- v0.17: robust loading: loading and error states instead of 'No model yet', retry, failed loads never cached as 'no data', each page section fails independently, unexpected errors shown.
- v0.18: release guard: if files from two versions are loaded during a deployment, the app shows a notice, refreshes the files and reloads.

## Releasing
Upload all changed files in one commit (Add file → Upload files), so GitHub Pages deploys them together. Bump the version in version.json, APP_VERSION in app.js, VERSION in models.js and company.js, --mm-version in styles.css and the ?v= tags in index.html.
- v0.19: larger, vertically centred Mr. Market logo that links to the start page.
