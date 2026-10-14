// One-time probe: which ESPN fantasy views carry head-to-head win
// probabilities? Prints only key paths whose name mentions probability/win/
// likel(ihood) and the value type, never team names, ids or values. Safe to
// delete once found.
const season = Number(process.env.SEASON || new Date().getFullYear());
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const headers = { Cookie: `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`, Accept: "application/json" };
const VIEWS = ["mMatchupScore", "mScoreboard", "mMatchup", "mBoxscore", "mLiveScoring", "kona_game_state", "mStatus", "mPositionalRatings", "modular", "mNav"];
const settings = await (await fetch(`${base}?view=mSettings`, { headers })).json();
const week = settings.scoringPeriodId;
const found = new Map();
const walk = (x, path) => {
  if (Array.isArray(x)) { if (x.length) walk(x[0], path + "[]"); return; }
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
    const p = path ? `${path}.${k}` : k;
    if (/prob|win|likel|odds|chance/i.test(k)) found.set(p, typeof v);
    walk(v, p);
  }
};
for (const view of VIEWS) {
  for (const url of [`${base}?view=${view}&scoringPeriodId=${week}`, `${base}?view=${view}&scoringPeriodId=${week}&matchupPeriodId=${week}`]) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) { console.log(view, r.status); continue; }
      found.clear(); walk(await r.json(), "");
      console.log(`${view}${url.includes("matchupPeriodId") ? " (+matchupPeriod)" : ""}: ${[...found].map(([k, t]) => `${k}:${t}`).join(", ") || "none"}`);
    } catch (e) { console.log(view, "error", e.message); }
  }
}
