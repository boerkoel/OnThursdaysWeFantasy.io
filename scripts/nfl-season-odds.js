// Every remaining regular-season NFL game's win odds (Jim, 2026-11-17), for the survivor pool's "last one standing"
// odds: each live entry greedily takes its safest unused team each week, simulated to the end of the season
// (scripts/lib/survivor-model.js lastStanding). Per game, the home side's chance to win: the sportsbook moneyline
// ESPN carries (DraftKings; vig removed) where one is posted, otherwise ESPN's FPI matchup prediction. Run daily by
// update-espn.yml; writes data/current/nfl-season-odds.json. This week's games use the live feed's odds instead.
import fs from "node:fs";

const OUT = "data/current/nfl-season-odds.json";
const HEADERS = { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" };
const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const PREDICTOR = id => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}/predictor`;
const LAST_WEEK = 18;

const get = async url => {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const american = v => { const n = Number(String(v ?? "").replace("+", "")); return Number.isFinite(n) && n !== 0 ? (n > 0 ? 100 / (n + 100) : -n / (-n + 100)) : null; };
const moneyline = competition => {
  for (const o of competition.odds || []) {
    const ml = o.moneyline;
    const h = american(ml?.home?.current?.odds ?? ml?.home?.close?.odds ?? ml?.home?.open?.odds);
    const a = american(ml?.away?.current?.odds ?? ml?.away?.close?.odds ?? ml?.away?.open?.odds);
    if (h && a) return h / (h + a);
  }
  return null;
};
const fpi = async id => {
  try {
    const d = await get(PREDICTOR(id));
    const v = (d.homeTeam?.statistics || []).find(s => s.name === "gameProjection")?.value;
    return Number.isFinite(Number(v)) ? Number(v) / 100 : null;
  } catch { return null; }
};

const now = await get(SCOREBOARD);
const season = Number(now.season?.year), type = Number(now.season?.type), week = Number(now.week?.number);
if (type !== 2) {
  console.log("NFL season odds: not the regular season; leaving the file as it is.");
  process.exit(0);
}
const weeks = {}, counts = { line: 0, fpi: 0, none: 0 };
for (let w = week; w <= LAST_WEEK; w++) {
  const d = await get(`${SCOREBOARD}?week=${w}&seasontype=2&season=${season}`);
  const games = [];
  for (const e of d.events || []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find(x => x.homeAway === "home"), away = c?.competitors?.find(x => x.homeAway === "away");
    if (!home || !away || c.status?.type?.completed) continue;
    let p = moneyline(c), source = "line";
    if (p == null) { p = await fpi(e.id); source = "fpi"; }
    counts[p == null ? "none" : source]++;
    games.push([home.team.abbreviation, away.team.abbreviation, p == null ? 0.5 : Math.round(1000 * p) / 1000]);
  }
  weeks[w] = games;
}
fs.writeFileSync(OUT, JSON.stringify({ season, week, updated: new Date().toISOString(), weeks }) + "\n");
console.log(`NFL season odds: weeks ${week}-${LAST_WEEK}, ${counts.line} games from sportsbook lines, ${counts.fpi} from FPI, ${counts.none} at 50%.`);
