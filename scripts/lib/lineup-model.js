import { readFile } from "node:fs/promises";
import { bestLineup, hurtOutlook, lineupRates, playerOutlook } from "./simulation.js";

// Lineup decisions still to come, shared by the main league's weekly
// simulation (update-live-scoreboard.js) and the guillotine league's
// (update-guillotine.js). See LINEUP_RATES and simulateFinal in simulation.js.

const BENCH = 20, IR = 21;
const normName = name => String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
export const fixAbbr = a => ({ WSH: "WAS", JAC: "JAX" })[a] || a;

// Chance to play: ESPN's OUT/IR is final; otherwise FantasyPros "Are They
// Playing?" (scripts/fetch-play-chance.js), else a rule of thumb from ESPN's tag.
const ESPN_TAG_CHANCE = { OUT: 0, INJURY_RESERVE: 0, SUSPENSION: 0, DOUBTFUL: 0.2, QUESTIONABLE: 0.6, DAY_TO_DAY: 0.8 };
export async function chanceToPlayFn(abbrByProTeam) {
  const data = await readFile("data/current/play-chance.json", "utf8").then(JSON.parse).catch(() => null);
  const byPlayer = new Map((data?.players || []).filter(p => p.chance != null)
    .map(p => [`${normName(p.name)}|${fixAbbr(p.team)}`, p.chance]));
  return player => {
    const tag = String(player.injuryStatus || "").toUpperCase();
    if (ESPN_TAG_CHANCE[tag] === 0) return 0;
    const fp = byPlayer.get(`${normName(player.fullName)}|${abbrByProTeam.get(Number(player.proTeamId))}`);
    return fp ?? ESPN_TAG_CHANCE[tag] ?? 1;
  };
}

// The week's first lineups (kept in the published scoreboard/guillotine JSON,
// which every run restores) and which teams have changed their starters since.
export const lineupKey = entries => (entries || [])
  .filter(e => ![BENCH, IR].includes(Number(e.lineupSlotId)))
  .map(e => `${e.playerId}:${e.lineupSlotId}`).sort().join(",");
export function trackLineups(previous, week, entriesByTeam) {
  const base = previous?.week === week
    ? { ...previous, teams: { ...previous.teams }, changed: { ...(previous.changed || {}) } }
    : { week, seenAt: new Date().toISOString(), teams: {}, changed: {} };
  for (const [teamId, entries] of entriesByTeam) {
    const key = lineupKey(entries);
    if (base.teams[teamId] == null) base.teams[teamId] = key;
    else if (!base.changed[teamId] && key !== base.teams[teamId]) base.changed[teamId] = new Date().toISOString();
  }
  return base;
}

// One team's lineup model. gameFor(proTeamId) -> { state: "pre"|"in"|"post",
// completed, ...gameScriptInputs } or null on bye. Starters still to play keep
// the order of `entries` (their index in the returned `remaining`), so callers
// can tally each current starter's simulated points.
export function buildLineupModel({ entries, nflWeek, gameFor, weeklyStat, chanceToPlay, set, now = Date.now() }) {
  let nextKickoff = Infinity;
  const fixed = [], fixedIdx = [], slots = [], pool = [], current = [], remaining = [], poolRemIdx = [];
  for (const entry of entries || []) {
    const slot = Number(entry.lineupSlotId), player = entry.playerPoolEntry?.player;
    if (!player || slot === IR) continue;
    const game = gameFor(Number(player.proTeamId));
    const weeklyActual = weeklyStat(player, 0);
    const actual = Number.isFinite(weeklyActual) ? weeklyActual : 0;
    const projection = weeklyStat(player, 1);
    const outlook = playerOutlook({ actual, projection, positionId: player.defaultPositionId, game, proTeamId: player.proTeamId });
    const starter = slot !== BENCH;
    const stillToPlay = starter && (!nflWeek || (game && !game.completed));
    const remIdx = stillToPlay ? remaining.push({ player, game, actual, outlook }) - 1 : -1;
    const open = nflWeek && (!game || game.state === "pre");   // not kicked off (or on bye): can still be moved
    if (!open) {
      if (stillToPlay) { fixed.push(outlook); fixedIdx.push(remIdx); }
      continue;
    }
    const bye = !game || !Number.isFinite(projection);
    const chance = bye ? 1 : chanceToPlay(player);
    if (starter && game?.kickoff) nextKickoff = Math.min(nextKickoff, Date.parse(game.kickoff));
    pool.push({ name: player.fullName, outlook: bye ? { ...outlook, rest: 0, sd: 0 } : hurtOutlook(outlook, chance), eligibleSlots: (player.eligibleSlots || []).map(Number),
      chance, value: bye ? 0 : Math.max(0, projection) * chance, bye, starter });
    poolRemIdx.push(remIdx);
    if (starter) { slots.push(slot); current.push(pool.length - 1); }
  }
  if (!nflWeek || (!slots.length && !fixed.length)) return { model: null, remaining };
  // Fewer re-sets as the team's next open kickoff nears (0 hours = now).
  const rates = lineupRates(Boolean(set), Number.isFinite(nextKickoff) ? (nextKickoff - now) / 3600000 : 0);
  const best = bestLineup(slots, pool);
  const valueOf = lineup => lineup.reduce((sum, i) => sum + (i >= 0 ? pool[i].value : 0), 0);
  const summary = {
    set: Boolean(set), openSlots: slots.length,
    // Starters not kicked off yet who may not play (or are on bye).
    atRisk: current.map(i => pool[i]).filter(p => p.bye || p.chance < 0.95)
      .map(p => ({ name: p.name, chance: p.bye ? 0 : Math.round(p.chance * 100) / 100, bye: p.bye || undefined })),
    // Expected points the best lineup adds over the current one.
    gain: Math.round((valueOf(best) - valueOf(current)) * 10) / 10
  };
  return { model: { fixed, fixedIdx, slots, pool, poolRemIdx, current, best, ...rates }, remaining, summary };
}
