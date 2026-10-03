// Lineup helpers shared by the live scoreboard (the matchup cards' lineups)
// and the League Wire (lineup regret stories). Players are
// {actual, slot, bench, finished, eligibleSlots}.
export const BENCH_SLOT = 20;
export const IR_SLOT = 21;

// Best total from filling `slots` with `players` (each used at most once, only
// in slots they're eligible for). Every slot must be filled.
export function optimalFill(slots, players) {
  const full = (1 << slots.length) - 1;
  const memo = new Map();
  const best = (i, used) => {
    if (i >= players.length) return used === full ? 0 : -Infinity;
    const key = i + "|" + used;
    if (memo.has(key)) return memo.get(key);
    let value = best(i + 1, used);
    for (let s = 0; s < slots.length; s++) {
      if (used & (1 << s) || !players[i].eligibleSlots.includes(slots[s])) continue;
      value = Math.max(value, players[i].actual + best(i + 1, used | (1 << s)));
    }
    memo.set(key, value);
    return value;
  };
  return best(0, 0);
}

const round = n => Math.round(n * 100) / 100;

// Settled lineup decisions: only players whose games are over can be swapped,
// so an unplayed starter never looks like a mistake. Returns points left on
// the bench, the single best bench-for-starter swap, and every bench player
// who outscored a starter he could have replaced.
export function settledLineupRegret(players) {
  const finished = players.filter(p => p.finished && p.slot !== IR_SLOT);
  const starters = finished.filter(p => !p.bench);
  const bench = finished.filter(p => p.bench);
  const actual = starters.reduce((sum, p) => sum + p.actual, 0);
  const optimal = starters.length ? optimalFill(starters.map(p => p.slot), finished) : actual;
  let bestSwap = null;
  const outscoredStarter = new Set();
  for (const b of bench) for (const s of starters) {
    const gain = b.actual - s.actual;
    if (gain <= 0 || !b.eligibleSlots.includes(s.slot)) continue;
    outscoredStarter.add(b);
    if (!bestSwap || gain > bestSwap.gain) bestSwap = {benchPlayer:b, starter:s, gain:round(gain)};
  }
  return {
    pointsLeft:round(Math.max(0, optimal - actual)),
    finishedStarters:starters.length,
    finishedBench:bench.length,
    bestSwap,
    regretBench:[...outscoredStarter].sort((a, b) => b.actual - a.actual)
  };
}
