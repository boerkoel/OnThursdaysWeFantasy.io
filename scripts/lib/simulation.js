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
// { state, period, clock (seconds left in the period), teams: [{ id, score }] }.
export function gameScriptInputs(competition) {
  const status = competition?.status;
  return {
    state: status?.type?.state || "pre",
    period: Number(status?.period) || 0,
    clock: Number.isFinite(Number(status?.clock)) ? Number(status.clock) : null,
    teams: (competition?.competitors || []).map(c => ({ id: Number(c.team?.id ?? c.id), score: Number(c.score) || 0 }))
  };
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
export function playerOutlook({ actual, projection, positionId, game = null, proTeamId = null }) {
  const unscripted = Number.isFinite(projection) ? Math.max(0, projection - (Number(actual) || 0)) : 0;
  const shareLeft = Number.isFinite(projection) && projection > 0 ? Math.min(1, unscripted / projection) : 0.5;
  const rest = unscripted * gameScriptFactor({ positionId, proTeamId, game });
  return {
    rest,
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

// team: { score, players: [playerOutlook, ...] } for starters still to play.
// If given, playerPoints[i] is set to player i's simulated points.
export function simulateFinal(team, rng, playerPoints = null) {
  let total = team.score;
  team.players.forEach((p, i) => {
    const points = rng() < p.exitRisk
      ? p.rest * EARLY_EXIT_SHARE * rng()
      : Math.max(-p.floor, p.rest + p.sd * normal(rng));
    if (playerPoints) playerPoints[i] = points;
    total += points;
  });
  return total;
}

// Lowest and highest possible final score. Used to report outcomes that are
// truly locked exactly (0% or 100%) instead of as simulation odds.
export function scoreRange(team) {
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
