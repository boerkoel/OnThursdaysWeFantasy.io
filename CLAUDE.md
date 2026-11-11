# OnThursdaysWeFantasy.io

The site for the fantasy league "On Thursdays We Watch Football": live matchups, odds, a League Wire of stories, the NFL slate, records and report cards. This repo is public: never commit secrets or anything private about league members.

## Working rules
- Commit and push straight to `main` when asked; there's no PR workflow. Commits from a cloud session's branch get merged to `main`.
- No paid APIs (including the Anthropic API). Free public data only; offer a rules-based alternative instead.
- Never automate logins to paywalled sites or get around paywalls.
- Secrets live in GitHub Actions secrets and the Cloudflare worker; the owner sets them (`gh secret set`). Never ask for them in chat or write them to files.
- League Wire story text never names its data sources.
- Keep site text concise: short labels, short play text, details in tooltips.
- Obituaries (`content/obituaries.md`) and any stats quoted in writing: double-check every number against ESPN's final box score before committing. Monday night and stat corrections move them.
- Give one clear recommendation rather than a survey of options. When a change needs a workflow run to test, say which one.
- Match the surrounding code: comment density, naming, idiom. Comments often credit the request with a date, e.g. `(Jim, 2026-11-01)`.

## Leagues
- Main league: ESPN 998599827. 12 teams, median scoring; 6-team playoffs seeded by record (head-to-head + median wins), total points as the tiebreaker, with reseeding. An 8-team "Ultimate Loser" bracket runs weeks 16–18.
- Guillotine side league: ESPN 687798070 ("On Mondays Heads Will Roll", public). Powers the Death Watch tab; its week 1 chop was a dummy and is excluded.
- History: `data/history/season-YYYY.json`; managers merged across accounts via `manager-aliases.json`. 2022–23 have no weekly lineups on ESPN (`sources-YYYY.json` marked `reliable: false`).

## Layout
- `src/`: React 19 + Vite app, deployed to GitHub Pages under base `/OnThursdaysWeFantasy.io/`. `src/main.jsx` holds most of the app; tabs in `src/lib/tabs.js`; components in `src/components/`.
- `scripts/`: data jobs run by GitHub Actions. `update-live-scoreboard.js` (scores, win odds, NFL games), `fetch-live-plays.js`, `update-guillotine.js`, `league-wire.js` (stories in `scripts/wire/*.js`, shared state in `scripts/wire/context.js`), `season-odds.js`, `report-cards.js`.
- `scripts/lib/`: shared logic used by scripts and the app: `simulation.js` (Monte Carlo odds), `game-drama.js` (Games tab drama index), `live-markets.js` (live lines from Kalshi's public API), `survivor-model.js`, `lineup-model.js`.
- `worker/`: Cloudflare Worker `otwf-notify` (web push, live data store, betting-line snapshots). Durable Object `LiveStore` holds state; KV is only for subscriptions and a few keys (free plan: 1,000 KV writes/day, so never add per-run KV writes).
- `content/obituaries.md`: hand-written obits for chopped guillotine teams.

## Data flow
- `update-espn.yml`: daily snapshot, committed as "Update ESPN league data and stats". Those commits aren't real work.
- `update-live.yml`: live data during games. It re-dispatches itself, publishes to the worker (`scripts/publish-live.js` → `POST /live`), and doesn't commit live data. The app polls the worker's `GET /live` and falls back to Pages.
- `deploy.yml`: Pages build. `deploy-worker.yml`: worker deploy.
- A daily deploy can briefly overwrite live data with output from older code; wait for the next live run before judging a change.

## Checking changes
- `npm run build` compiles the site. Main-league scripts need ESPN credentials that only exist in GitHub Actions, so test those by running the workflow. The guillotine league is public, so `scripts/update-guillotine.js` runs anywhere.
- Wire stories: `scripts/test-wire.js`.
- Check UI changes at phone width (390px); most of the league reads the site on phones.
