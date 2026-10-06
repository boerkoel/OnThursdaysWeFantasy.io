import { readFile, writeFile } from "node:fs/promises";

// Recent drops and how the dropped players are doing this week, for the
// League Wire's MANAGER MISCUE story. Reads this week's and last week's
// executed transactions, then looks up each dropped player's points this
// week (league scoring) and where he is now (another team, or unowned).
// Writes data/current/drops.json, and data/current/waivers.json: waiver
// claims processed in the last few days (won, and lost ones when ESPN shows
// them), for the League Wire's waiver stories. Uses the ESPN cookies when present (the
// main league is private); a public league works without them.
const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;
const OUT = process.env.DROPS_PATH || "data/current/drops.json";
const WAIVERS_OUT = process.env.WAIVERS_PATH || "data/current/waivers.json";
const WAIVER_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const DROP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };

async function fetchJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      ...(espnS2 && swid ? { Cookie: `espn_s2=${espnS2}; SWID=${swid}` } : {}),
      ...extraHeaders
    }
  });
  if (!response.ok) throw new Error(`ESPN request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

const matchup = JSON.parse(await readFile("data/current/mMatchup.json", "utf8").catch(() => "{}"));
const week = Number(process.env.DROPS_WEEK || matchup.scoringPeriodId || 1);

const periods = [week, week - 1].filter(w => w >= 1);
const allTransactions = (await Promise.all(periods.map(w => fetchJson(`${base}?view=mTransactions2&scoringPeriodId=${w}`).then(d => d.transactions || []))))
  .flat();
const transactions = allTransactions.filter(t => t.status === "EXECUTED" && Date.now() - Number(t.processDate) <= DROP_WINDOW_MS);

// Waiver claims (traditional waivers: priority, no bids) processed lately.
const claims = allTransactions
  .filter(t => t.type === "WAIVER" && Number(t.processDate) && Date.now() - Number(t.processDate) <= WAIVER_WINDOW_MS)
  .map(t => {
    const add = (t.items || []).find(i => i.type === "ADD" && Number(i.playerId) > 0);
    const drop = (t.items || []).find(i => i.type === "DROP" && Number(i.playerId) > 0);
    return add && { teamId: Number(t.teamId ?? add.toTeamId), won: t.status === "EXECUTED", status: t.status,
      processedAt: new Date(Number(t.processDate)).toISOString(), playerId: Number(add.playerId), droppedPlayerId: drop ? Number(drop.playerId) : null };
  }).filter(Boolean);

// Each drop, with the player added in the same move (a waiver claim or
// free-agent pickup is one transaction holding both the ADD and the DROP).
const drops = [];
for (const t of transactions) {
  const added = (t.items || []).find(i => i.type === "ADD" && Number(i.playerId) > 0);
  for (const item of t.items || []) {
    // Defenses have negative ids; skip them (and anything malformed).
    if (item.type !== "DROP" || !(Number(item.playerId) > 0)) continue;
    drops.push({ playerId: Number(item.playerId), fromTeamId: Number(item.fromTeamId), droppedAt: new Date(Number(t.processDate)).toISOString(),
      addedPlayerId: added && Number(added.toTeamId) === Number(item.fromTeamId) ? Number(added.playerId) : null });
  }
}

let players = [];
const lookup = [...new Set([...drops.flatMap(d => [d.playerId, d.addedPlayerId]), ...claims.flatMap(c => [c.playerId, c.droppedPlayerId])].filter(Boolean))];
if (lookup.length) {
  const filter = JSON.stringify({ players: { filterIds: { value: lookup } } });
  const data = await fetchJson(`${base}?view=kona_player_info&scoringPeriodId=${week}`, { "X-Fantasy-Filter": filter });
  players = data.players || [];
}
const byId = new Map(players.map(p => [Number(p.player?.id ?? p.id), p]));
const stat = (player, source) => Number((player?.stats || []).find(s =>
  Number(s.scoringPeriodId) === week && Number(s.statSourceId) === source && Number(s.statSplitTypeId) === 1)?.appliedTotal);

const describe = id => {
  const entry = byId.get(id);
  const player = entry?.player;
  if (!player) return null;
  const points = stat(player, 0), projection = stat(player, 1);
  return {
    player: player.fullName,
    position: POSITIONS[Number(player.defaultPositionId)] || "",
    proTeamId: Number(player.proTeamId),
    nowOnTeamId: Number(entry.onTeamId) || null,
    points: Number.isFinite(points) ? Math.round(points * 100) / 100 : 0,
    projection: Number.isFinite(projection) ? Math.round(projection * 100) / 100 : null
  };
};
const out = drops.map(({ addedPlayerId, ...d }) => {
  const dropped = describe(d.playerId);
  if (!dropped) return null;
  const added = addedPlayerId ? describe(addedPlayerId) : null;
  return { ...d, ...dropped, added: added && { playerId: addedPlayerId, ...added } };
}).filter(Boolean)
  // The same player dropped twice (picked up and dropped again): keep the latest.
  .sort((a, b) => Date.parse(b.droppedAt) - Date.parse(a.droppedAt))
  .filter((d, i, all) => all.findIndex(x => x.playerId === d.playerId) === i);

await writeFile(OUT, JSON.stringify({ week, updatedAt: new Date().toISOString(), drops: out }, null, 2) + "\n");
console.log(`Drops: ${out.length} in the last 7 days; best this week: ${[...out].sort((a, b) => b.points - a.points).slice(0, 3).map(d => `${d.player} ${d.points}`).join(", ") || "none"}.`);

const waivers = claims.map(c => {
  const player = describe(c.playerId);
  return player && { ...c, player: player.player, position: player.position, projection: player.projection,
    dropped: c.droppedPlayerId ? describe(c.droppedPlayerId)?.player || null : null };
}).filter(Boolean);
await writeFile(WAIVERS_OUT, JSON.stringify({ week, updatedAt: new Date().toISOString(), claims: waivers }, null, 2) + "\n");
console.log(`Waivers: ${waivers.filter(c => c.won).length} claims won, ${waivers.filter(c => !c.won).length} lost, in the last 4 days.`);
