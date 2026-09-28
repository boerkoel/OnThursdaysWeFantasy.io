import { mkdir, readFile, writeFile } from "node:fs/promises";
import { managerKey } from "./lib/history.js";

// Saves each finished past season of the league (as listed by ESPN) to
// data/history/season-YYYY.json, once: teams, final ranks, playoff seeds and
// every game's score. Used by build-record-book.js. Managers are linked across
// seasons by a short hash of their ESPN account id, so no personal details
// are stored.
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;
if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

// Recent seasons live at the usual league address; older ones are only served
// by ESPN's leagueHistory endpoint (which wraps the season in an array).
async function fetchSeason(season, view) {
  const headers = { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0", Cookie: `espn_s2=${espnS2}; SWID=${swid}` };
  const current = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`);
  current.searchParams.set("view", view);
  const response = await fetch(current, { headers });
  if (response.ok) return response.json();

  const history = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${leagueId}`);
  history.searchParams.set("seasonId", String(season));
  history.searchParams.set("view", view);
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
