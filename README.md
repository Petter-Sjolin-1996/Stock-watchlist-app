# Watchlist

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
