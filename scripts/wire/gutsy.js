import { IR_SLOT } from "../lib/lineup.js";
import { clockNow, currentScores, currentWeek, fit, money, nflGames, pickLine, rosterData, sleeperData } from "./context.js";

// League Wire: GUTSY CALL (Jim, 2026-11-02). A manager starts a backup (an RB or TE who isn't his team's top one
// on Sleeper's depth chart, or a WR outside its top three) while benching the safer play at his position: best,
// the man ahead of him on that same depth chart (the handcuff over the starter); else a bench player projected
// higher. Before kickoff it's the call; once both games are final, whether it paid off or backfired.
// A benched player who's out or injured isn't a choice, so he doesn't count; one left in the IR slot after he's
// healthy again is (activating him was one move away: Jim, 2026-11-02, Price behind Wilson). ESPN's status wins
// over Sleeper's, which lags on reactivations.
const players = sleeperData?.players || {};
const BACKUP_FROM = { RB: 2, TE: 2, WR: 4 };
const SOON_MS = 30 * 60 * 60 * 1000;
const OUTCOME_GAP = 3;

const gameOf = p => nflGames.find(g => (g.teamIds || []).map(Number).includes(Number(p.proTeamId)));
const abbrevOf = p => (gameOf(p)?.teams || []).find(t => Number(t.id) === Number(p.proTeamId))?.abbrev || "";
const last = n => String(n || "").replace(/^[A-Z]\.\s*/, "");
const depthOf = p => players[String(p.id)];
const unavailable = p => Boolean(p.injury) && /^(O|OUT|IR|D|DOUBTFUL|SUSP)/i.test(String(p.injury));
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const HEALTHY = new Set(["ACTIVE", "NORMAL", "PROBABLE", "QUESTIONABLE", "DAY_TO_DAY"]);
const weekStat = (player, source) => Number((player.stats || []).find(x => Number(x.scoringPeriodId) === currentWeek && Number(x.statSourceId) === source && Number(x.statSplitTypeId) === 1)?.appliedTotal);
// A team's healthy players sitting in the IR slot, shaped like its bench.
const healthyOnIr = teamId => ((rosterData.teams || []).find(t => Number(t.id) === Number(teamId))?.roster?.entries || [])
  .filter(e => Number(e.lineupSlotId) === IR_SLOT && e.playerPoolEntry?.player && HEALTHY.has(e.playerPoolEntry.player.injuryStatus || "ACTIVE"))
  .map(e => { const pl = e.playerPoolEntry.player; return { id: Number(e.playerId), name: (pl.firstName ? pl.firstName[0] + ". " : "") + (pl.lastName || pl.fullName),
    pos: POSITIONS[Number(pl.defaultPositionId)] || "", proTeamId: Number(pl.proTeamId), projection: weekStat(pl, 1) || 0, actual: weekStat(pl, 0) || 0, onIr: true }; });

export function addGutsyCallStory(add) {
  const found = [];
  for (const s of currentScores) {
    const bench = [...(s.lineup?.bench || []).filter(p => !unavailable(p)), ...healthyOnIr(s.teamId)];
    for (const p of s.lineup?.starters || []) {
      const d = depthOf(p);
      if (!BACKUP_FROM[p.pos] || !d || d.pos !== p.pos || !(d.depth >= BACKUP_FROM[p.pos])) continue;
      // The safer play on his bench: the man ahead of him on his own depth chart, else one projected higher.
      const teammate = bench.find(b => b.pos === p.pos && Number(b.proTeamId) === Number(p.proTeamId) && depthOf(b)?.depth < d.depth);
      const better = teammate || bench.filter(b => b.pos === p.pos && Number(b.projection) > Number(p.projection) + 2).sort((x, y) => y.projection - x.projection)[0];
      if (!better) continue;
      found.push({ s, p, d, better, teammate: Boolean(teammate) });
    }
  }
  const pick = found.sort((x, y) => y.teammate - x.teammate || (y.better.projection - y.p.projection) - (x.better.projection - x.p.projection))[0];
  if (!pick) return;
  const { s, p, d, better, teammate } = pick;
  const gp = gameOf(p), gb = gameOf(better);
  const rank = `${abbrevOf(p)}'s ${p.pos}${d.depth}`;
  const lead = pickLine("gutsy:" + s.teamId + ":" + p.id, ["🎲 GUTSY CALL", "🎲 Bold move", "🎲 Against the grain"]);
  const where = better.onIr ? "left on IR though healthy" : "on the bench";
  const why = teammate ? `over ${last(better.name)}, ${abbrevOf(better)}'s ${better.pos}${depthOf(better).depth}, ${where}` : `over ${last(better.name)} (projected ${money(better.projection)}) ${where}`;
  if (gp?.completed && gb?.completed) {
    const gap = Number(p.actual) - Number(better.actual);
    if (Math.abs(gap) < OUTCOME_GAP) return;
    const verdict = gap > 0 ? `paid off: ${last(p.name)} ${money(p.actual)}, ${last(better.name)} ${money(better.actual)}` : `backfired: ${last(better.name)} outscored ${last(p.name)} by ${money(-gap)}`;
    add("GUTSY CALL", fit(
      `${lead}: ${s.team} started ${p.name} (${rank}) ${why}. It ${verdict}.`,
      `${lead}: ${s.team} started ${last(p.name)} (${rank}) over ${last(better.name)}. It ${verdict}.`,
      `${lead}: ${s.team} started ${last(p.name)} over ${last(better.name)}. It ${gap > 0 ? "paid off" : "backfired"} (${money(p.actual)} vs ${money(better.actual)}).`
    ), gap > 0 ? 74 : 80);
    return;
  }
  // Before his game: the call itself, a day out at most.
  if (gp && gp.state === "pre" && Date.parse(gp.kickoff) - clockNow() <= SOON_MS) {
    add("GUTSY CALL", fit(
      `${lead}: ${s.team} is starting ${p.name} (${rank}) ${why}.`,
      `${lead}: ${s.team} is starting ${last(p.name)} (${rank}) over ${last(better.name)} ${where}.`,
      `${lead}: ${s.team} starts ${last(p.name)} (${rank}) over ${last(better.name)}.`
    ), teammate ? 72 : 66);
  }
}
