import { readFile, writeFile } from "node:fs/promises";

// Trade log for the League Wire's TRADE TAUNT (Jim, 2026-10-25): what each
// side has scored since a trade, four weeks on.
// - trades: every accepted trade (ESPN's transaction log, visible league-wide).
// - suggestions: each week's "trades that should have happened" (Trades card,
//   teams.json), saved the first time we see that week, so we can check later
//   how the swap would have turned out.
// - offers: trade offers the site's ESPN login can see, i.e. only the ones
//   involving that account's own team (ESPN keeps other offers private).
//   Recorded, but only published when Jim switches TRADE_TAUNT_OFFERS on.
// Points are each player's weekly fantasy points in league scoring (any
// lineup), from the week after the move. Writes data/current/trade-log.json,
// keeping earlier suggestions (they can't be rebuilt later).
const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const OUT = process.env.TRADE_LOG_PATH || "data/current/trade-log.json";
const TAUNT_AFTER_WEEKS = 4;

async function fetchJson(url, extraHeaders = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0",
    ...(process.env.ESPN_S2 && process.env.ESPN_SWID ? { Cookie: `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}` } : {}), ...extraHeaders } });
  if (!response.ok) throw new Error(`ESPN request failed: ${response.status}`);
  return response.json();
}
const readJson = p => readFile(p, "utf8").then(JSON.parse);
const matchup = await readJson("data/current/mMatchup.json").catch(() => ({}));
const week = Number(process.env.TRADE_WEEK || matchup.scoringPeriodId || 1);   // TRADE_WEEK: tests
const previous = await readJson(OUT).catch(() => ({}));

// A move counts from that week when processed Tuesday/Wednesday (Eastern),
// before the week's games; otherwise from the next week.
const firstWeekOf = (at, period) => {
  const day = new Date(at).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  return ["Tue", "Wed"].includes(day) ? period : period + 1;
};
const sides = items => {
  const by = {};
  for (const i of items || []) if (i.type === "TRADE" && Number(i.toTeamId) > 0) (by[i.toTeamId] ||= []).push(Number(i.playerId));
  return by;   // team id -> player ids it receives
};

const tx = (await Promise.all(Array.from({ length: week }, (_, i) => i + 1).map(w =>
  fetchJson(`${base}?view=mTransactions2&scoringPeriodId=${w}`).then(d => (d.transactions || []).map(t => ({ ...t, period: w }))).catch(() => [])))).flat();
const byId = new Map(tx.map(t => [t.id, t]));

// Accepted trades: an executed accept (or a commissioner's uphold), with its
// items or its proposal's.
const trades = [];
for (const t of tx) {
  if (!["TRADE_ACCEPT", "TRADE_UPHOLD", "TRADE"].includes(t.type) || t.status !== "EXECUTED") continue;
  const proposal = byId.get(t.relatedTransactionId);
  const gets = sides(t.items?.length ? t.items : proposal?.items);
  const teams = Object.keys(gets).map(Number);
  if (teams.length !== 2 || trades.some(x => x.id === (proposal?.id || t.id))) continue;
  const at = Number(t.processDate || t.proposedDate);
  trades.push({ id: proposal?.id || t.id, at: new Date(at).toISOString(), week: t.period, firstWeek: firstWeekOf(at, t.period), gets });
}

// Offers visible to this login (its own team's), and how they ended.
const offers = [];
for (const t of tx) {
  if (t.type !== "TRADE_PROPOSAL") continue;
  const related = tx.filter(x => x.relatedTransactionId === t.id);
  const outcome = related.some(x => x.type === "TRADE_VETO") ? "vetoed"
    : related.some(x => x.type === "TRADE_DECLINE") ? "declined"
    : related.some(x => ["TRADE_ACCEPT", "TRADE_UPHOLD"].includes(x.type) && x.status === "EXECUTED") ? "accepted"
    : t.status === "CANCELED" ? "withdrawn or expired" : t.status === "PENDING" ? "pending" : String(t.status || "").toLowerCase();
  if (outcome === "accepted" || outcome === "pending") continue;
  const gets = sides(t.items);
  if (Object.keys(gets).length !== 2) continue;
  const at = Number(t.proposedDate);
  offers.push({ id: t.id, at: new Date(at).toISOString(), week: t.period, firstWeek: firstWeekOf(at, t.period), proposer: Number(t.teamId), outcome, gets });
}

// The same offer re-sent (or a counter with the same players) counts once; the
// most telling outcome wins.
const RANK = { declined: 0, vetoed: 1, "withdrawn or expired": 2 };
const offerKey = o => o.week + ":" + Object.entries(o.gets).map(([t, ps]) => t + "=" + [...ps].sort().join("+")).sort().join("|");
const uniqueOffers = [...offers].sort((a, b) => (RANK[a.outcome] ?? 9) - (RANK[b.outcome] ?? 9))
  .filter((o, i, all) => all.findIndex(x => offerKey(x) === offerKey(o)) === i);
offers.length = 0;
offers.push(...uniqueOffers);

// This week's suggestions (Trades card: win-win swaps for both sides), saved once per week.
const teamsData = await readJson("data/current/teams.json").catch(() => ({ teams: [] }));
const suggestions = [...(previous.suggestions || [])];
if (!suggestions.some(s => s.week === week)) {
  const seen = new Set();
  for (const t of teamsData.teams || []) {
    for (const x of (t.profileAnalytics?.winWinTrades || []).filter(x => x.perspective === "A" && Math.min(x.yourWinsAdded, x.theirWinsAdded) >= 1)) {
      const give = x.givePlayerIds || [x.givePlayerId], get = x.getPlayerIds || [x.getPlayerId];
      const key = [t.id, x.otherTeamId, ...give, ...get].join("|");
      if (seen.has(key) || give.some(v => v == null) || get.some(v => v == null)) continue;
      seen.add(key);
      suggestions.push({ id: key, week, firstWeek: week, gets: { [t.id]: get.map(Number), [x.otherTeamId]: give.map(Number) },
        winsAtTheTime: { [t.id]: x.yourWinsAdded, [x.otherTeamId]: x.theirWinsAdded } });
    }
  }
}

// Weekly points for every player involved.
const ids = [...new Set([...trades, ...offers, ...suggestions].flatMap(x => Object.values(x.gets).flat()))];
const points = new Map(ids.map(id => [id, {}]));
const names = new Map();
for (let w = 1; w < week && ids.length; w++) {
  const data = await fetchJson(`${base}?view=kona_player_info&scoringPeriodId=${w}`, { "X-Fantasy-Filter": JSON.stringify({ players: { filterIds: { value: ids } } }) }).catch(() => ({ players: [] }));
  for (const e of data.players || []) {
    const p = e.player || {};
    const v = Number((p.stats || []).find(s => Number(s.scoringPeriodId) === w && Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1)?.appliedTotal);
    if (Number.isFinite(v)) points.get(Number(p.id))[w] = Math.round(v * 100) / 100;
    names.set(Number(p.id), p.fullName);
  }
}
// Each side's points since, over finished weeks; ready once 4 have been played.
const score = x => {
  const weeks = Array.from({ length: Math.max(0, week - x.firstWeek) }, (_, i) => x.firstWeek + i);
  const sidesOut = Object.fromEntries(Object.entries(x.gets).map(([team, players]) => [team, {
    players: players.map(id => ({ id, name: names.get(id) || String(id), points: Math.round(weeks.reduce((a, w) => a + (points.get(id)?.[w] || 0), 0) * 100) / 100 })),
  }]));
  for (const s of Object.values(sidesOut)) s.total = Math.round(s.players.reduce((a, p) => a + p.points, 0) * 100) / 100;
  return { ...x, weeksSince: weeks.length, ready: weeks.length >= TAUNT_AFTER_WEEKS, sides: sidesOut };
};

const out = { trades: trades.map(score), offers: offers.map(score), suggestions: suggestions.map(score) };
await writeFile(OUT, JSON.stringify({ week, updatedAt: new Date().toISOString(), tauntAfterWeeks: TAUNT_AFTER_WEEKS, ...out }, null, 2) + "\n");
console.log(`Trade log: ${trades.length} trades, ${offers.length} offers (this login's), ${suggestions.length} saved suggestions; ready to taunt: ${Object.values(out).flat().filter(x => x.ready).length}.`);
