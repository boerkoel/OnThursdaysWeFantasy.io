import { mkdir, readFile, writeFile } from "node:fs/promises";
import { managerKey } from "./lib/history.js";

// Saves each finished past season of the league (as listed by ESPN) to
// data/history/season-YYYY.json, once: teams, final ranks, playoff seeds and
// every game's score. Used by build-record-book.js. Also, once per season,
// data/history/sources-YYYY.json: where each team's started points came from
// (draft picks, pickups, trades), for the all-time report card categories. Managers are linked across
// seasons by a short hash of their ESPN account id, so no personal details
// are stored.
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;
if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

// Recent seasons live at the usual league address; older ones are only served
// by ESPN's leagueHistory endpoint (which wraps the season in an array).
async function fetchSeason(season, view, params = {}) {
  const headers = { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0", Cookie: `espn_s2=${espnS2}; SWID=${swid}` };
  const current = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`);
  current.searchParams.set("view", view);
  for (const [k, v] of Object.entries(params)) current.searchParams.set(k, String(v));
  const response = await fetch(current, { headers });
  if (response.ok) return response.json();

  const history = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${leagueId}`);
  history.searchParams.set("seasonId", String(season));
  history.searchParams.set("view", view);
  for (const [k, v] of Object.entries(params)) history.searchParams.set(k, String(v));
  const fallback = await fetch(history, { headers });
  if (!fallback.ok) throw new Error(`${season} ${view}: ${response.status} ${response.statusText}, then leagueHistory ${fallback.status} ${fallback.statusText}`);
  const data = await fallback.json();
  const entry = Array.isArray(data) ? data.find(d => Number(d.seasonId) === Number(season)) || data[0] : data;
  if (!entry) throw new Error(`${season} ${view}: leagueHistory returned no season`);
  return entry;
}

const settings = JSON.parse(await readFile("data/current/mSettings.json", "utf8"));
const previousSeasons = settings.status?.previousSeasons || [];
await mkdir("data/history", { recursive: true });

for (const season of previousSeasons) {
  const path = `data/history/season-${season}.json`;
  const exists = await readFile(path).then(() => true).catch(() => false);
  if (exists) continue;
  try {
    const [seasonSettings, teamData, matchupData] = await Promise.all([
      fetchSeason(season, "mSettings"),
      fetchSeason(season, "mTeam"),
      fetchSeason(season, "mMatchup")
    ]);
    const scheduleSettings = seasonSettings.settings?.scheduleSettings || {};
    const regularSeasonWeeks = Number(scheduleSettings.matchupPeriodCount || 14);
    const history = {
      season,
      leagueName: seasonSettings.settings?.name || null,
      regularSeasonWeeks,
      playoffTeamCount: Number(scheduleSettings.playoffTeamCount || 6),
      teams: (teamData.teams || []).map(t => ({
        id: Number(t.id),
        manager: managerKey(t.primaryOwner || t.owners?.[0]),
        name: (t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`).trim(),
        finalRank: Number(t.rankCalculatedFinal || t.rankFinal || 0) || null,
        playoffSeed: Number(t.playoffSeed || 0) || null
      })),
      games: (matchupData.schedule || [])
        .filter(m => m.home?.teamId && m.away?.teamId)
        .map(m => ({
          week: Number(m.matchupPeriodId),
          home: Number(m.home.teamId),
          away: Number(m.away.teamId),
          homeScore: Number(m.home.totalPoints || 0),
          awayScore: Number(m.away.totalPoints || 0),
          winner: m.winner,
          playoff: Number(m.matchupPeriodId) > regularSeasonWeeks,
          tier: m.playoffTierType || null
        }))
    };
    await writeFile(path, JSON.stringify(history) + "\n");
    console.log(`Saved ${season}: ${history.teams.length} teams, ${history.games.length} games.`);
  } catch (error) {
    // Try again on the next daily run.
    console.warn(`Could not save ${season}: ${error.message}`);
  }
}

// Where each team's started points came from, per past season (Jim, 2026-10-29: all-time report card
// categories). Regular-season weeks only: each week's roster (mRoster with scoringPeriodId) gives the starters
// and their points; mDraftDetail the draft picks; mTransactions2 the trades (a player counts as a trade
// acquisition for the team that received him from that week on). Anyone else started was a pickup.
// Stores totals and each team's top 2 players per source, no account details.
const BENCH = 20, IR = 21;
for (const season of previousSeasons) {
  const path = `data/history/sources-${season}.json`;
  if (await readFile(path).then(() => true).catch(() => false)) continue;
  const base = JSON.parse(await readFile(`data/history/season-${season}.json`, "utf8").catch(() => "null"));
  if (!base) continue;
  try {
    const draft = await fetchSeason(season, "mDraftDetail");
    const drafted = new Set((draft.draftDetail?.picks || []).map(p => `${p.teamId}:${p.playerId}`));
    const tradedFrom = new Map();   // "team:player" -> first week it counts as a trade
    const totals = new Map(base.teams.map(t => [t.id, { drafted: 0, pickups: 0, trades: 0, weeks: 0, top: { drafted: {}, pickups: {}, trades: {} } }]));
    let tradeData = false;
    for (let week = 1; week <= base.regularSeasonWeeks; week++) {
      const tx = await fetchSeason(season, "mTransactions2", { scoringPeriodId: week }).catch(() => null);
      if (tx?.transactions) tradeData = true;
      for (const t of tx?.transactions || []) {
        if (!/TRADE/.test(t.type || "") || (t.status && t.status !== "EXECUTED")) continue;
        for (const item of t.items || []) {
          const key = `${item.toTeamId}:${item.playerId}`;
          if (item.toTeamId > 0 && !tradedFrom.has(key)) tradedFrom.set(key, week);
        }
      }
      const roster = await fetchSeason(season, "mRoster", { scoringPeriodId: week });
      for (const team of roster.teams || []) {
        const rec = totals.get(Number(team.id));
        if (!rec) continue;
        rec.weeks++;
        for (const e of team.roster?.entries || []) {
          const slot = Number(e.lineupSlotId), p = e.playerPoolEntry?.player;
          if (!p || slot === BENCH || slot === IR) continue;
          const points = Number((p.stats || []).find(x => Number(x.scoringPeriodId) === week && Number(x.statSourceId) === 0 && Number(x.statSplitTypeId) === 1)?.appliedTotal);
          if (!Number.isFinite(points)) continue;
          const key = `${team.id}:${e.playerId}`;
          const kind = tradedFrom.has(key) && tradedFrom.get(key) <= week ? "trades" : drafted.has(key) ? "drafted" : "pickups";
          rec[kind] += points;
          rec.top[kind][p.fullName] = (rec.top[kind][p.fullName] || 0) + points;
        }
      }
    }
    const top = m => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([player, points]) => ({ player, points: Math.round(points * 100) / 100 }));
    const out = {
      season, weeks: base.regularSeasonWeeks, tradeData, draftPicks: drafted.size,
      teams: base.teams.map(t => { const r = totals.get(t.id); return { id: t.id, manager: t.manager, weeks: r.weeks,
        drafted: Math.round(r.drafted * 100) / 100, pickups: Math.round(r.pickups * 100) / 100, trades: Math.round(r.trades * 100) / 100,
        top: { drafted: top(r.top.drafted), pickups: top(r.top.pickups), trades: top(r.top.trades) } }; })
    };
    if (!out.teams.some(t => t.weeks)) throw new Error("no weekly rosters");
    await writeFile(path, JSON.stringify(out) + "\n");
    console.log(`Saved ${season} sources: ${drafted.size} draft picks, ${tradedFrom.size} traded players${tradeData ? "" : " (no transaction data)"}.`);
  } catch (error) {
    console.warn(`Could not save ${season} sources: ${error.message}`);
  }
}
