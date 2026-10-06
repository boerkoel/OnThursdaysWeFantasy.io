import { round } from "../lib/simulation.js";
import { DATA, clockNow, currentScores, currentWeek, nflGameByProTeam, readJson } from "./context.js";
import { freshNews, newlyRuledOut } from "./news.js";

// League Wire: each matchup's key plays (key-plays.json).
export async function buildKeyPlays(pregameNews = []) {
  const plays = await readJson(`${DATA}/live-plays.json`).catch(() => ({ plays: [] }));
  return [...(plays.plays || [])
    .filter(play => Math.abs(Number(play.points)) >= 4)
    .sort((a, b) => {
      const aTime = a.wallclock ? new Date(a.wallclock).getTime() : 0;
      const bTime = b.wallclock ? new Date(b.wallclock).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 60)
    .map(play => ({
      id: play.id,
      matchupId: play.matchupId,
      teamId: play.fantasyTeamId,
      playerId: play.playerId,
      points: round(play.points),
      player: play.player,
      text: play.text,
      wallclock: play.wallclock || null
    })), ...pregameNews];
}

// Pregame news (📰) for the key plays: a breaking headline about a starter, or
// a starter ruled out, before his game kicks off. news.json only holds recent
// headlines and a ruling-out is only seen in the update where it happens, so
// the week's list is kept in marquee.json and each run adds what's new (ids
// keep it from repeating). No points, so they never become chart markers.
const PREGAME_NEWS_MAX = 40;
export async function pregameNewsPlays() {
  const previous = await readJson(`${DATA}/marquee.json`).catch(() => null);
  const kept = Number(previous?.week) === currentWeek ? previous.pregameNews || [] : [];
  const starters = new Map(currentScores.flatMap(s => (s.lineup?.starters || []).map(p => [Number(p.id), { s, p }])));
  const entry = (s, p, fields) => ({ matchupId: s.matchupId, teamId: s.teamId, playerId: Number(p.id), player: p.name, ...fields });
  const found = [];
  for (const n of freshNews()) for (const named of n.players) {
    const starter = starters.get(Number(named.id));
    const game = starter && nflGameByProTeam.get(Number(starter.p.proTeamId));
    if (!game || game.state !== "pre" || Date.parse(n.published) >= Date.parse(game.kickoff)) continue;
    found.push(entry(starter.s, starter.p, { id: `news-${named.id}-${Date.parse(n.published)}`, news: "headline",
      text: n.headline.replace(/[.!?]+$/, ""), wallclock: n.published }));
  }
  for (const { s, p } of newlyRuledOut()) {
    found.push(entry(s, p, { id: `out-${p.id}`, news: "out", text: "ruled out before kickoff", wallclock: new Date(clockNow()).toISOString() }));
  }
  const byId = new Map(kept.map(n => [n.id, n]));
  for (const n of found) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => Date.parse(b.wallclock) - Date.parse(a.wallclock)).slice(0, PREGAME_NEWS_MAX);
}
