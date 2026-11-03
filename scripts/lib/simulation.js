// Shared Monte Carlo pieces for the main league scoreboard and the guillotine
// Death Watch. Each starter still to play adds a random amount around the
// points ESPN still projects for them:
// - it can be negative (an interception-filled night, a defense that gets
//   torched, a kicker who misses), down to a floor that depends on position;
// - there's a chance the player leaves early or doesn't play (injury, late
//   scratch) and adds only a fraction of what was projected.
// The spreads and rates below are reasonable estimates, not fitted to data.

export const SIMULATIONS = 10000;

// ESPN position ids: 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 D/ST.
// Spread of a player's remaining points as a fraction of what's projected
// (defenses and kickers swing the most), with a minimum so a player already
// past their projection still varies.
const SD_FRACTION = { 1: 0.5, 2: 0.65, 3: 0.7, 4: 0.75, 5: 0.7, 16: 1.0 };
const DEFAULT_SD_FRACTION = 0.7;
const MIN_SPREAD_POINTS = 3;

// The most a player could plausibly lose from here.
const NEGATIVE_FLOOR = { 1: 6, 2: 1, 3: 1, 4: 1, 5: 4, 16: 10 };
const DEFAULT_FLOOR = 2;

// Chance a player who hasn't started leaves early or doesn't play, scaled down
// by how much of their projection is already in. If it happens, they add only
// 0-30% of what they still had projected.
const EARLY_EXIT_RATE = 0.06;
const EARLY_EXIT_SHARE = 0.3;

export const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function medianOf(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Game script --------------------------------------------------------------
// How a starter's game is going changes what he's likely to add from here: in
// a lopsided second half the trailing team throws (QB/WR/TE up, RB down), the
// leading team runs out the clock (the reverse), and either side may pull its
// starters. gameScriptFactor() is the multiplier on his remaining points. It
// grows with the margin (none for a one-score game, full at 24+) and with the
// clock (none in the first half, full from the start of the 4th quarter), and
// is 1 for a game not in progress or when the score or clock is missing.
// Score and clock only: they come with the scoreboard every run.
const SCRIPT_MARGIN_START = 8;
const SCRIPT_MARGIN_FULL = 24;
const SCRIPT_SECONDS_START = 1800;   // halftime
const SCRIPT_SECONDS_FULL = 900;     // start of the 4th quarter
// At full strength: every starter in a blowout loses 10% (garbage time,
// starters sitting); then by side and position (1 QB, 2 RB, 3 WR, 4 TE).
const SCRIPT_BLOWOUT = 0.1;
const SCRIPT_TRAILING = { 1: 0.2, 2: -0.15, 3: 0.2, 4: 0.2 };
const SCRIPT_LEADING = { 1: -0.15, 2: 0.12, 3: -0.15, 4: -0.15 };
const SCRIPT_MIN = 0.75, SCRIPT_MAX = 1.15;
const clamp01 = x => Math.min(1, Math.max(0, x));

// The pieces of an ESPN scoreboard competition that game script needs:
// { state, period, clock (seconds left in the period), teams: [{ id, score, home }], drive }.
// drive (live games): { possession, yardLine (from the home team's goal line), down, distance, text, redZone }.
export function gameScriptInputs(competition) {
  const status = competition?.status, s = competition?.situation;
  const state = status?.type?.state || "pre";
  return {
    state,
    period: Number(status?.period) || 0,
    clock: Number.isFinite(Number(status?.clock)) ? Number(status.clock) : null,
    teams: (competition?.competitors || []).map(c => ({ id: Number(c.team?.id ?? c.id), score: Number(c.score) || 0, home: c.homeAway === "home" })),
    drive: state === "in" && s?.possession ? { possession: Number(s.possession), yardLine: Number.isFinite(s.yardLine) ? s.yardLine : null,
      down: Number(s.down) || null, distance: Number.isFinite(Number(s.distance)) ? Number(s.distance) : null,
      text: s.downDistanceText || s.possessionText || "", redZone: s.isRedZone === true } : null
  };
}

// ---- Drive state --------------------------------------------------------------
// Where the ball is (Jim, 2026-11-02): a starter's remaining points include this drive's share (his rest ÷ his
// team's drives left), and that share scales with how likely this drive is to score from here, so a sack on
// 3rd down or a catch into the red zone moves the odds right away. Chances are rough NFL rates: by yards to the
// goal for a fresh set of downs, times the chance this set keeps going (a 3rd-and-long often doesn't).
// The game decides the rest:
// - 4th down: go for it or kick? Short yardage in plus territory often goes; out of range (but not deep in
//   their own end) leans go; late, a team down 4-8 needs a TD (goes nearly always), down 9+ mostly goes, down
//   1-3 kicks to tie or win, and a leading team takes the points.
// - Pass or run: a trailing team throws more and a leading one runs, more so late (as gameScriptFactor), which
//   tilts who on the drive would score: passing TDs to the QB and his targets, rushing TDs to the RB.
// Offense only: D/STs score nothing for points allowed here.
const TD_BY_YARDS = [[1, 0.78], [5, 0.66], [10, 0.56], [20, 0.46], [35, 0.37], [50, 0.3], [65, 0.24], [80, 0.18], [99, 0.1]];
const FG_BY_YARDS = [[1, 0.12], [10, 0.28], [20, 0.34], [35, 0.3], [50, 0.18], [65, 0.1], [80, 0.07], [99, 0.04]];
const interpolate = (table, x) => {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return table[table.length - 1][1];
};
const LATE_SECONDS = 300;
// How often an offense goes for it on 4th, given yards to go, distance and the game (margin = its lead).
export function goForItRate({ toGo, distance, margin = 0, secondsLeft = 3600 }) {
  const fgYds = toGo + 17;
  let go = distance <= 2 && toGo <= 55 ? 0.45 : distance <= 4 && toGo <= 40 ? 0.2 : 0.04;
  if (fgYds > 57 && toGo <= 45) go = Math.max(go, 0.35);   // too far to kick, too close to punt
  if (secondsLeft <= LATE_SECONDS) {
    if (margin < 0 && margin >= -3) go = Math.min(go, 0.15);       // a FG ties or wins: kick
    else if (margin < -3 && margin >= -8) go = 0.95;               // needs a TD
    else if (margin < -8) go = 0.7;                                // needs scores, and fast
    else if (margin > 0) go = Math.min(go, 0.08);                  // leading: take the points
  }
  return go;
}
const fgMake = yds => yds <= 40 ? 0.88 : yds <= 50 ? 0.75 : yds <= 57 ? 0.55 : 0;
// Chance this drive ends in a TD or a FG from here. ctx: { toGo, down, distance, margin, secondsLeft }.
export function driveChances({ toGo, down, distance, margin = 0, secondsLeft = 3600 }) {
  if (!Number.isFinite(toGo)) return null;
  const d = Number.isFinite(distance) ? distance : 10;
  const fresh = { td: interpolate(TD_BY_YARDS, toGo), fg: interpolate(FG_BY_YARDS, toGo) };
  const fourth = () => {
    const go = goForItRate({ toGo, distance: d, margin, secondsLeft });
    const convert = Math.min(0.72, Math.max(0.15, 0.72 - 0.055 * (d - 1)));
    const kick = (1 - go) * fgMake(toGo + 17);
    return { td: go * convert * fresh.td, fg: go * convert * fresh.fg + kick, go };
  };
  if (down === 4) return fourth();
  if (down === 3) {
    const keep = Math.min(0.75, Math.max(0.12, 0.75 - 0.045 * d)), f = fourth();
    return { td: keep * fresh.td + (1 - keep) * f.td, fg: keep * fresh.fg + (1 - keep) * f.fg };
  }
  const keep = down === 2 ? Math.min(1, Math.max(0.75, 1.05 - 0.02 * d)) : 1;
  return { td: keep * fresh.td, fg: keep * fresh.fg };
}
// Share of a drive's TDs that are passing TDs: 60% normally, up to 75% for a team trailing by two scores late
// and down to 45% for one protecting a lead (the same ramps as gameScriptFactor).
export function passShare({ margin = 0, secondsLeft = 3600 }) {
  const strength = clamp01((SCRIPT_SECONDS_START - secondsLeft) / (SCRIPT_SECONDS_START - SCRIPT_SECONDS_FULL)) *
    clamp01((Math.abs(margin) - SCRIPT_MARGIN_START) / (SCRIPT_MARGIN_FULL - SCRIPT_MARGIN_START));
  return 0.6 + (margin < 0 ? 0.15 : -0.15) * strength;
}
// What a drive is worth to each position, against an average drive (22% TD, 14% FG, 60% passing TDs).
const positionValue = (positionId, c, pass) => {
  const pos = Number(positionId);
  if (pos === 5) return c.td + 3.8 * c.fg;
  const tdWeight = pos === 2 ? (1 - pass) / 0.4 : pos === 1 ? 0.5 + 0.5 * pass / 0.6 : pass / 0.6;
  return 6.5 * c.td * tdWeight + 1.5 * c.fg + 0.6;
};
const AVERAGE_DRIVE = { td: 0.22, fg: 0.14 };
// The game situation from the offense's side: its lead and the seconds left (overtime counts as late and tied).
export function driveContext(game, proTeamId) {
  const drive = game?.drive;
  const offense = (game?.teams || []).find(t => Number(t.id) === Number(proTeamId));
  const defense = (game?.teams || []).find(t => Number(t.id) !== Number(proTeamId));
  if (!drive || !offense || !Number.isFinite(drive.yardLine)) return null;
  const secondsLeft = game.period > 4 ? 0 : Math.max(0, (4 - (Number(game.period) || 1)) * 900 + (Number(game.clock) || 0));
  return { toGo: offense.home ? 100 - drive.yardLine : drive.yardLine, down: drive.down, distance: drive.distance,
    margin: (Number(offense.score) || 0) - (Number(defense?.score) || 0), secondsLeft };
}
export function driveFactor({ positionId, proTeamId, game }) {
  const drive = game?.drive;
  if (game?.state !== "in" || !drive || Number(drive.possession) !== Number(proTeamId) || Number(positionId) === 16) return 1;
  const ctx = driveContext(game, proTeamId), c = ctx && driveChances(ctx);
  if (!c) return 1;
  const pass = passShare(ctx);
  const ratio = Math.min(3.5, Math.max(0.2, positionValue(positionId, c, pass) / positionValue(positionId, AVERAGE_DRIVE, 0.6)));
  // This drive's share of what's left: about 11 drives a game, fewer as the clock runs. Never more than a
  // quarter of it: late in a game the projections still hold more than one drive's worth.
  const drivesLeft = Math.max(4, 11 * ctx.secondsLeft / 3600);
  return 1 + (ratio - 1) / drivesLeft;
}

// ---- Usage ------------------------------------------------------------------------
// How involved he's been (Jim, 2026-11-02): an RB, WR or TE's targets plus carries so far against what his
// projection expected by this point in his game. Getting hyper-targeted, more of his rest is coming; not
// involved at all, less. Shrunk toward his projection by a few touches' worth, so two early targets don't
// swing it, and his remaining points scale a bit less than one-for-one with it (0.6× to 1.45×).
// usage: { touches, expected } (targets + carries, plus pass attempts for a QB (Jim, 2026-11-02): so far, and
// projected for the whole game).
const USAGE_PRIOR = 4;
// From an ESPN player's stats: targets (58) plus carries (23) this week, so far (source 0) and projected (1).
export function weeklyUsage(player, week) {
  const touches = src => {
    const stat = (player?.stats || []).find(s => Number(s.scoringPeriodId) === Number(week) && Number(s.statSourceId) === src && Number(s.statSplitTypeId) === 1);
    return stat?.stats ? (Number(stat.stats["58"]) || 0) + (Number(stat.stats["23"]) || 0) + (Number(stat.stats["0"]) || 0) : null;
  };
  const expected = touches(1);
  return expected >= 1 ? { touches: touches(0) ?? 0, expected: Math.round(expected * 10) / 10 } : null;
}
export function usageFactor({ positionId, usage, game }) {
  if (![1, 2, 3, 4].includes(Number(positionId)) || game?.state !== "in" || !(usage?.expected >= 1) || !Number.isFinite(usage.touches)) return 1;
  const secondsLeft = game.period > 4 ? 0 : Math.max(0, (4 - (Number(game.period) || 1)) * 900 + (Number(game.clock) || 0));
  const soFar = usage.expected * (1 - secondsLeft / 3600);
  const ratio = (usage.touches + USAGE_PRIOR) / (soFar + USAGE_PRIOR);
  return Math.min(1.45, Math.max(0.6, Math.pow(ratio, 0.8)));
}

// game: { state, period, clock, teams: [{ id, score }] } (an nflGames entry);
// proTeamId: the player's NFL team.
export function gameScriptFactor({ positionId, proTeamId, game }) {
  if (game?.state !== "in" || !(game.period >= 1) || !Number.isFinite(game.clock)) return 1;
  const mine = (game.teams || []).find(t => t.id === Number(proTeamId));
  const theirs = (game.teams || []).find(t => t.id !== Number(proTeamId));
  if (!mine || !theirs || !Number.isFinite(mine.score) || !Number.isFinite(theirs.score)) return 1;
  // Overtime is a tie game: no script.
  if (game.period > 4) return 1;
  const secondsLeft = (4 - game.period) * 900 + game.clock;
  const margin = mine.score - theirs.score;
  const strength = clamp01((SCRIPT_SECONDS_START - secondsLeft) / (SCRIPT_SECONDS_START - SCRIPT_SECONDS_FULL)) *
    clamp01((Math.abs(margin) - SCRIPT_MARGIN_START) / (SCRIPT_MARGIN_FULL - SCRIPT_MARGIN_START));
  if (!strength) return 1;
  const side = (margin < 0 ? SCRIPT_TRAILING : SCRIPT_LEADING)[Number(positionId)] || 0;
  const factor = (1 - SCRIPT_BLOWOUT * strength) * (1 + side * strength);
  return Math.min(SCRIPT_MAX, Math.max(SCRIPT_MIN, factor));
}

// What a starter who hasn't finished might still add. With his NFL game
// (and team), the remaining points are adjusted for game script.
// A starter's points still to come before script, drives and usage (Jim, 2026-11-02: a kicker projected for 9.8
// isn't still owed 6.8 at halftime): in a game being played, his projection times the share of the game left
// (projections don't update in game, so projection minus points so far ignored the clock); otherwise his
// projection less what he has. Overtime counts as a sliver.
export function gameShareLeft(game) {
  if (game?.state !== "in" || !(Number(game.period) >= 1) || !Number.isFinite(Number(game.clock))) return null;
  if (Number(game.period) > 4) return 0.05;
  return Math.min(1, Math.max(0, ((4 - Number(game.period)) * 900 + Number(game.clock)) / 3600));
}
export function restOf({ projection, actual, game = null }) {
  if (!Number.isFinite(Number(projection))) return 0;
  const share = gameShareLeft(game);
  return share == null ? Math.max(0, Number(projection) - (Number(actual) || 0)) : Math.max(0, Number(projection)) * share;
}

// Kickers and defenses have no usage to read, so a light pull toward their actual pace instead (Jim, 2026-11-02):
// points so far against what his projection expected by now, shrunk by a few points' worth and square-rooted, so
// a quiet half trims his rest a little (Myers with 3 of an expected 4.9 at halftime keeps about 87%), 0.7x-1.3x.
const PACE_PRIOR = 3;
export function paceFactor({ positionId, actual, projection, game }) {
  const share = gameShareLeft(game);
  if (![5, 16].includes(Number(positionId)) || share == null || !(Number(projection) > 0)) return 1;
  const due = Number(projection) * (1 - share);
  return Math.min(1.3, Math.max(0.7, Math.sqrt(((Number(actual) || 0) + PACE_PRIOR) / (due + PACE_PRIOR))));
}

export function playerOutlook({ actual, projection, positionId, game = null, proTeamId = null, usage = null }) {
  const unscripted = restOf({ projection, actual, game }) * paceFactor({ positionId, actual, projection, game });
  const shareLeft = Number.isFinite(projection) && projection > 0 ? Math.min(1, unscripted / projection) : 0.5;
  const rest = unscripted * gameScriptFactor({ positionId, proTeamId, game }) * driveFactor({ positionId, proTeamId, game }) * usageFactor({ positionId, usage, game });
  const live = game?.state === "in" && TD_POINTS[Number(positionId)];
  return {
    rest,
    ...(live ? { td: { chance: tdChance(positionId, rest), points: TD_POINTS[Number(positionId)] } } : {}),
    sd: (SD_FRACTION[Number(positionId)] ?? DEFAULT_SD_FRACTION) * Math.max(rest, MIN_SPREAD_POINTS),
    floor: NEGATIVE_FLOOR[Number(positionId)] ?? DEFAULT_FLOOR,
    exitRisk: EARLY_EXIT_RATE * shareLeft
  };
}

// Deterministic for the same inputs, so odds don't jitter between refreshes
// when nothing has changed.
export function seededRng(seedValues) {
  let state = 2166136261;
  for (const char of JSON.stringify(seedValues)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normal(rng) {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}

// One player's simulated remaining points (see playerOutlook). Projections
// already price in the usual chance of getting hurt mid-game, so the early-exit
// draw only shapes the spread: the no-exit outcome is scaled up so the average
// stays at the projection (exitRisk x EARLY_EXIT_SHARE / 2 is the exit draw's mean).
// A touchdown is one lump (Jim, 2026-11-02: TDsMaGee needed 6.7 from Emanuel Wilson's last quarter and a half,
// which a smooth spread around his ~2.4 expected called 0.5%): for a skill player in a game being played, his
// chance of a TD in the time left and its worth in this league (a catch ~9, a run 6.5, a QB's pass 4.8). The
// draw adds the lump that often and takes its expected value out of the smooth part, so his average holds.
export const TD_POINTS = { 1: 4.8, 2: 6.5, 3: 9, 4: 9 };
const TD_RATE = { 1: 0.12, 2: 0.07, 3: 0.06, 4: 0.07 };   // chance = 1 - e^(-rate x remaining points)
export const tdChance = (positionId, rest) => TD_RATE[Number(positionId)] ? 1 - Math.exp(-TD_RATE[Number(positionId)] * Math.max(0, rest)) : 0;

// While one big play could still flip a race, its odds stay off the ends (Jim, 2026-11-02: never 100, not even
// 99.9): a ceiling per starter still to play (a long TD catch ~13, run 12, a QB's long TD pass 6.4, a 50-yard
// FG 5, a return TD 8), summed; if it covers the gap, the odds are held to 1.5-98.5% (they show as 1% and 99%
// but never read as settled).
export const BIG_PLAY = { QB: 6.4, RB: 12, WR: 13, TE: 13, K: 5, "D/ST": 8 };
export const STILL_IN_PLAY = [1.5, 98.5];
export function bigPlayCeiling(starters, unfinished) {
  return (starters || []).filter(unfinished).reduce((sum, p) => sum + (BIG_PLAY[p.pos] || 0), 0);
}
export const keepInPlay = p => Math.min(STILL_IN_PLAY[1], Math.max(STILL_IN_PLAY[0], p));

function drawPoints(p, rng) {
  const keep = 1 - p.exitRisk * (1 - EARLY_EXIT_SHARE / 2);
  const rest = keep > 0 ? p.rest / keep : p.rest;
  if (rng() < p.exitRisk) return rest * EARLY_EXIT_SHARE * rng();
  if (p.td) {
    const smooth = Math.max(0, rest - p.td.chance * p.td.points);
    return Math.max(-p.floor, smooth + 0.7 * p.sd * normal(rng)) + (rng() < p.td.chance ? p.td.points : 0);
  }
  return Math.max(-p.floor, rest + p.sd * normal(rng));
}

// team: { score, players: [playerOutlook, ...] } for starters still to play.
// If given, playerPoints[i] is set to player i's simulated points. A team with
// a lineup model (team.lineup, below) simulates lineup decisions too.
export function simulateFinal(team, rng, playerPoints = null) {
  if (team.lineup) return simulateLineupWeek(team, rng, playerPoints);
  let total = team.score;
  team.players.forEach((p, i) => {
    const points = drawPoints(p, rng);
    if (playerPoints) playerPoints[i] = points;
    total += points;
  });
  return total;
}

// ---- Lineup decisions still to come ------------------------------------
// Before kickoff a lineup isn't final: managers swap players, and injured
// starters sit. team.lineup = {
//   fixed: [playerOutlook]   starters whose games are under way (locked),
//   slots: [slotId]          starting slots whose player hasn't kicked off,
//   pool:  [{ outlook, eligibleSlots, chance, value }]  everyone who can still
//          fill those slots (starters and bench not yet kicked off); chance =
//          chance to play, value = projection x chance,
//   current: [pool index per slot]  the lineup as set (-1 = empty),
//   best:    [pool index per slot]  the best lineup by projection,
//   reset, cover }  chance the manager re-sets to the best lineup, and chance
//   he replaces a starter who doesn't play.
// Players whose games start are locked; as the week goes on fewer slots stay
// open, so the simulation follows the lineups actually played.
export const LINEUP_RATES = {
  // Chance of re-setting to the best lineup, from 3+ days before the team's
  // next open kickoff (far) down to kickoff (near). Managers who've already
  // changed their lineup this week mostly leave it.
  set: { far: 0.15, near: 0.05, cover: 0.9 },
  untouched: { far: 0.65, near: 0.2, cover: 0.6 },
  // A fresh pickup (claimed this week) who belongs in the best lineup but
  // isn't starting yet: he's almost certainly in the plan.
  newClaim: { far: 0.85, near: 0.5 }
};
const DECAY_HOURS = 72;
export function lineupRates(set, hoursToKickoff, claimPending = false) {
  const r = set ? LINEUP_RATES.set : LINEUP_RATES.untouched;
  const w = Math.min(1, Math.max(0, (Number(hoursToKickoff) || 0) / DECAY_HOURS));
  const at = x => x.near + (x.far - x.near) * w;
  return { reset: Math.max(at(r), claimPending ? at(LINEUP_RATES.newClaim) : 0), cover: r.cover };
}

// Playing hurt: an injured player who suits up (chance to play < 1) scores a
// bit less, swings more and is likelier to leave early, scaled by how unlikely
// he was to play.
export const HURT = { meanCut: 0.15, sdBoost: 0.3, exitAdd: 0.15 };
export function hurtOutlook(o, chance) {
  const doubt = Math.max(0, 1 - chance);
  if (!doubt) return o;
  return { ...o, rest: o.rest * (1 - HURT.meanCut * doubt), sd: o.sd * (1 + HURT.sdBoost * doubt), exitRisk: Math.min(0.9, o.exitRisk + HURT.exitAdd * doubt) };
}

// Best assignment of pool players to slots by value (each player once, only
// in eligible slots). Returns a pool index per slot (-1 if none fits).
export function bestLineup(slots, pool) {
  const full = (1 << slots.length) - 1, memo = new Map();
  const solve = (i, used) => {
    if (i >= pool.length || used === full) return { value: 0, picks: [] };
    const key = i * 4096 + used;
    if (memo.has(key)) return memo.get(key);
    let best = solve(i + 1, used);
    for (let k = 0; k < slots.length; k++) {
      if (used & (1 << k) || !pool[i].eligibleSlots.includes(slots[k])) continue;
      const rest = solve(i + 1, used | (1 << k));
      if (pool[i].value + rest.value > best.value) best = { value: pool[i].value + rest.value, picks: [[k, i], ...rest.picks] };
    }
    memo.set(key, best);
    return best;
  };
  const out = slots.map(() => -1);
  for (const [k, i] of solve(0, 0).picks) out[k] = i;
  return out;
}

// playerPoints (optional) gets each current starter's contribution, indexed as
// in buildLineupModel's `remaining` (0 if he sat or was benched).
function simulateLineupWeek(team, rng, playerPoints = null) {
  const L = team.lineup;
  if (playerPoints) playerPoints.fill(0);
  let total = team.score;
  L.fixed.forEach((p, j) => {
    const points = drawPoints(p, rng);
    if (playerPoints && L.fixedIdx?.[j] >= 0) playerPoints[L.fixedIdx[j]] = points;
    total += points;
  });
  const lineup = rng() < L.reset ? L.best : L.current;
  const plays = L.pool.map(p => rng() < p.chance);
  const used = new Set(lineup.filter(i => i >= 0 && plays[i]));
  L.slots.forEach((slot, k) => {
    let i = lineup[k];
    if (i < 0 || !plays[i]) {
      // Starter out (or slot empty): usually swapped for the best healthy bench option.
      i = -1;
      if (rng() < L.cover) {
        for (let j = 0; j < L.pool.length; j++) {
          if (used.has(j) || !plays[j] || !L.pool[j].eligibleSlots.includes(slot)) continue;
          if (i < 0 || L.pool[j].outlook.rest > L.pool[i].outlook.rest) i = j;
        }
        if (i >= 0) used.add(i);
      }
    }
    if (i >= 0) {
      const points = drawPoints(L.pool[i].outlook, rng);
      if (playerPoints && L.poolRemIdx?.[i] >= 0) playerPoints[L.poolRemIdx[i]] = points;
      total += points;
    }
  });
  return total;
}

// Lowest and highest possible final score. Used to report outcomes that are
// truly locked exactly (0% or 100%) instead of as simulation odds.
export function scoreRange(team) {
  if (team.lineup) {
    const L = team.lineup;
    if (!L.fixed.length && !L.slots.length) return { min: team.score, max: team.score };
    const worst = L.pool.reduce((m, p) => Math.max(m, p.outlook.floor), 0);
    return { min: team.score - L.fixed.reduce((sum, p) => sum + p.floor, 0) - L.slots.length * worst, max: Infinity };
  }
  if (!team.players.length) return { min: team.score, max: team.score };
  return { min: team.score - team.players.reduce((sum, p) => sum + p.floor, 0), max: Infinity };
}

// Odds for an outcome that is still possible either way: start with one
// simulated success and one failure so it never reads exactly 0% or 100%.
export const possibleOdds = count => round(((count + 1) / (SIMULATIONS + 2)) * 100);

// Standard normal CDF and its inverse, for odds from a normal approximation.
export function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26, accurate to about 1e-7.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
export function normalQuantile(p) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (normalCdf(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// A player's or group's typical points in a big game versus a quiet one: the
// average of the upper and lower halves of a normal is 0.8 SD from the middle.
export const HALF_MEAN_SD = 0.7979;

// How far a normal-approximation probability moves between a big and a quiet
// game from players whose points have the given SD, when the outcome's own
// SD is outcomeSd: P(big) - P(quiet), in percentage points.
export function swingOdds(probabilityPct, playersSd, outcomeSd) {
  if (!(outcomeSd > 0) || !(playersSd > 0) || !Number.isFinite(Number(probabilityPct))) return 0;
  const z = normalQuantile(Math.min(0.9999, Math.max(0.0001, Number(probabilityPct) / 100)));
  const shift = HALF_MEAN_SD * playersSd / outcomeSd;
  return round(100 * (normalCdf(z + shift) - normalCdf(z - shift)));
}
