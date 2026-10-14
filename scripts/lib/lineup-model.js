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

// Second-opinion projections (scripts/fetch-projections.js): ESPN player id ->
// points, for this week. The simulation uses the average of ESPN and these,
// and widens a player's spread by half the gap when they disagree.
export async function altProjectionFn(week) {
  const data = await readFile("data/current/projections.json", "utf8").then(JSON.parse).catch(() => null);
  if (!data || Number(data.week) !== Number(week)) return () => null;
  const tables = Object.values(data.sources || {}).map(src => src.points || {});
  return player => {
    const vals = tables.map(t => t[String(player.id)]).filter(v => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
}

// Each league scores differently (ESPN projects with the league's scoring;
// the second opinion is standard PPR), so scale the second opinion by
// position to match ESPN on typical players: the median ESPN/alt ratio over
// rostered players both project for 3+ points. What's left is real disagreement.
export function calibrateAlt(rawFn, players, weeklyStat) {
  const ratios = new Map();
  for (const p of players) {
    const espn = weeklyStat(p, 1), alt = rawFn(p);
    if (!(espn >= 3 && alt >= 3)) continue;
    const pos = Number(p.defaultPositionId);
    if (!ratios.has(pos)) ratios.set(pos, []);
    ratios.get(pos).push(espn / alt);
  }
  const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const scale = new Map([...ratios].filter(([, xs]) => xs.length >= 3).map(([pos, xs]) => [pos, median(xs)]));
  const fn = p => { const alt = rawFn(p); return alt == null ? null : alt * (scale.get(Number(p.defaultPositionId)) ?? 1); };
  fn.scale = Object.fromEntries([...scale].map(([k, v]) => [k, Math.round(v * 100) / 100]));
  return fn;
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
const FRESH_MS = 6 * 24 * 3600 * 1000;   // a pickup counts as new for 6 days
export function buildLineupModel({ entries, nflWeek, gameFor, weeklyStat, chanceToPlay, set, now = Date.now(), altProjection = () => null }) {
  let nextKickoff = Infinity;
  const fixed = [], fixedIdx = [], slots = [], pool = [], current = [], remaining = [], poolRemIdx = [];
  for (const entry of entries || []) {
    const slot = Number(entry.lineupSlotId), player = entry.playerPoolEntry?.player;
    if (!player || slot === IR) continue;
    const game = gameFor(Number(player.proTeamId));
    const weeklyActual = weeklyStat(player, 0);
    const actual = Number.isFinite(weeklyActual) ? weeklyActual : 0;
    // ESPN's projection averaged with the second opinion; their gap adds spread.
    const espn = weeklyStat(player, 1), alt = altProjection(player);
    const projection = Number.isFinite(espn) && alt != null ? (espn + alt) / 2 : Number.isFinite(espn) ? espn : alt ?? NaN;
    const base = playerOutlook({ actual, projection, positionId: player.defaultPositionId, game, proTeamId: player.proTeamId });
    const gap = Number.isFinite(espn) && alt != null ? Math.abs(espn - alt) : 0;
    const left = Number.isFinite(projection) && projection > 0 ? Math.min(1, base.rest / projection) : 0;
    const outlook = gap ? { ...base, sd: Math.hypot(base.sd, 0.5 * gap * left) } : base;
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
      chance, value: bye ? 0 : Math.max(0, projection) * chance, bye, starter,
      fresh: Number(entry.acquisitionDate) > now - FRESH_MS && ["WAIVER", "ADD", "FREEAGENT", "TRADE"].includes(String(entry.acquisitionType || "").toUpperCase()) });
    poolRemIdx.push(remIdx);
    if (starter) { slots.push(slot); current.push(pool.length - 1); }
  }
  if (!nflWeek || (!slots.length && !fixed.length)) return { model: null, remaining };
  const best = bestLineup(slots, pool);
  // New pickups the best lineup would start but the current one doesn't.
  const pending = best.filter(i => i >= 0 && pool[i].fresh && !pool[i].starter).map(i => pool[i].name);
  // Fewer re-sets as the team's next open kickoff nears (0 hours = now).
  const rates = lineupRates(Boolean(set), Number.isFinite(nextKickoff) ? (nextKickoff - now) / 3600000 : 0, pending.length > 0);
  const valueOf = lineup => lineup.reduce((sum, i) => sum + (i >= 0 ? pool[i].value : 0), 0);
  const summary = {
    set: Boolean(set), openSlots: slots.length,
    // Starters not kicked off yet who may not play (or are on bye).
    atRisk: current.map(i => pool[i]).filter(p => p.bye || p.chance < 0.95)
      .map(p => ({ name: p.name, chance: p.bye ? 0 : Math.round(p.chance * 100) / 100, bye: p.bye || undefined })),
    // Expected points the best lineup adds over the current one.
    gain: Math.round((valueOf(best) - valueOf(current)) * 10) / 10,
    newClaims: pending.length ? pending : undefined, reset: Math.round(rates.reset * 100) / 100
  };
  return { model: { fixed, fixedIdx, slots, pool, poolRemIdx, current, best, ...rates }, remaining, summary };
}
