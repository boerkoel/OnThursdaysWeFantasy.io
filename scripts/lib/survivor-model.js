// Survivor pool model (Jim, 2026-10-25), shared by the Survivor tab, the pinned card's Expected winnings and the
// League Wire's SURVIVOR ODDS story. Feed = the notification worker's /survivor; nflGames = scoreboard.nflGames.
const ENTRY_FEE = 5;
const FEED_ABBR = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
export const feedTeam = a => FEED_ABBR[a] || a;

// Picks relayed by hand (Jim, 2026-11-15: the Splash login keeps dying, "allow me to tell you who picked who"):
// src/data/survivor-manual.json { week, picks: { handle: team } } layered over the worker's feed. A stale feed is
// moved to that week; each handle's live entry gets its pick once the pick's game has kicked off (same privacy
// rule as the worker), graded from the NFL final, and an entry whose team lost is eliminated. Picks the feed
// already has win. A pick can also carry its final result ({ team, result: "won" | "lost" }, Jim 2026-11-17): once the
// NFL has moved on to next week, last week's games aren't in nflGames to grade from.
export function withManualPicks(feed, manual, nflGames) {
  const week = Number(manual?.week);
  if (!feed || !week || !manual.picks || Number(feed.contest?.currentWeek) > week) return feed;
  const gameOf = team => (nflGames || []).find(g => (g.teams || []).some(x => feedTeam(x.abbrev) === team));
  const entries = (feed.entries || []).map(e => {
    const given = manual.picks[e.user] || manual.picks[e.user?.toLowerCase?.()] || Object.entries(manual.picks).find(([u]) => u.toLowerCase() === String(e.user).toLowerCase())?.[1];
    const team = typeof given === "object" ? given?.team : given;
    if (!team || !e.alive || e.picks?.[week]) return e;
    let result = typeof given === "object" && (given.result === "won" || given.result === "lost") ? given.result : null;
    if (!result) {
      const g = gameOf(team);
      if (!g || g.state === "pre") return e;
      const side = (g.teams || []).find(x => feedTeam(x.abbrev) === team);
      result = g.completed ? (side?.winner || (side?.winChance ?? 0) >= 0.5 ? "won" : "lost") : "pending";
    }
    return { ...e, picks: { ...e.picks, [week]: { team, result, manual: true } },
      ...(result === "lost" ? { alive: false, eliminatedWeek: week } : {}) };
  });
  const live = entries.filter(e => e.alive || e.eliminatedWeek === week);
  const counts = new Map();
  for (const e of live) { const p = e.picks?.[week]; if (p) counts.set(p.team, { team: p.team, count: (counts.get(p.team)?.count || 0) + 1, result: p.result }); }
  const allGraded = live.length > 0 && live.every(e => e.picks?.[week] && e.picks[week].result !== "pending");
  const weekRow = { week, locked: counts.size > 0, final: allGraded, hidden: live.filter(e => !e.picks?.[week]).length, picks: [...counts.values()] };
  const weeks = [...(feed.weeks || []).filter(w => Number(w.week) !== week).map(w => w.week < week ? { ...w, final: true } : w), weekRow].sort((a, b) => a.week - b.week);
  const alive = entries.filter(e => e.alive).length;
  return { ...feed, entries, weeks, manual: true,
    contest: { ...feed.contest, currentWeek: week, alive, eliminated: (Number(feed.contest?.totalEntries) || entries.length) - alive } };
}

// The pool's money and this week's odds, shared by the Survivor tab and the pinned card's Expected winnings.
// Money: every live entry gets an equal share of the pot (a fair price when nobody knows who'll outlast whom).
export function survivorModel(feed, nflGames, nflWeek) {
  const c = feed?.contest || {};
  const total = Number(c.totalEntries) || (c.alive + c.eliminated) || 0;
  const fee = Number(c.entryFee) || ENTRY_FEE;
  const pot = Number(c.prizePool) || fee * total;
  // Live: each entry's chance to survive this week from its pick's win chance
  // (ESPN's in-game win probability, the moneyline before kickoff). Picks not
  // revealed yet are modeled (hiddenOptions) and flagged.
  // Look ahead (Jim, 2026-11-17): once the NFL has moved on to next week but Splash hasn't (Tuesday on), model the
  // coming week instead: each live entry's pick is its best available team (unused, highest win chance).
  const splashWeek = Number(c.currentWeek);
  const lookAhead = nflWeek != null && Number(nflWeek) === splashWeek + 1;
  const n = lookAhead ? splashWeek + 1 : splashWeek;
  const thisWeek = nflWeek == null || Number(nflWeek) === n;
  // Entries still in it this week (looking ahead, only the live ones: last week's losses are done).
  const inThisWeek = e => e.alive || (!lookAhead && e.eliminatedWeek === n);
  // Before any game of the week kicks off, or looking ahead, a hidden pick is the entry's best available team.
  const pregame = !(nflGames || []).some(g => g.state && g.state !== "pre");
  const chanceOf = team => {
    if (!thisWeek) return null;
    for (const g of nflGames || []) {
      const t = (g.teams || []).find(x => feedTeam(x.abbrev) === team);
      if (t && t.winChance != null) return Number(t.winChance);
    }
    return null;
  };
  // Splash marks a pick "lost" while its team trails mid-game: trust a result only once the game is final.
  const gameOfTeam = team => (nflGames || []).find(g => (g.teams || []).some(x => feedTeam(x.abbrev) === team));
  const settledPick = p => (p?.result === "won" || p?.result === "lost") && (!thisWeek || (gameOfTeam(p.team)?.completed ?? true));
  // A hidden pick must be on a game that hasn't kicked off (picks show at kickoff). Model it as one of the
  // entry's unused teams in those games, weighted toward favorites (win chance ^ 8: a 80% team is ~10x a 60% one).
  const hiddenOptions = e => {
    if (!thisWeek) return [];
    const used = new Set(Object.values(e.picks || {}).map(p => p.team));
    const opts = (nflGames || []).filter(g => g.state === "pre").flatMap(g => (g.teams || []).map(t => ({ team: feedTeam(t.abbrev), p: t.winChance == null ? null : Number(t.winChance) })))
      .filter(o => o.p != null && !used.has(o.team));
    if (lookAhead || pregame) {
      const best = opts.sort((a, b) => b.p - a.p)[0];
      return best ? [{ ...best, w: 1 }] : [];
    }
    const total = opts.reduce((a, o) => a + o.p ** 8, 0);
    return total ? opts.map(o => ({ ...o, w: o.p ** 8 / total })) : [];
  };
  // The best available pick an entry is modeled with, when its pick is hidden and the model uses one.
  const predictedPick = e => (lookAhead || pregame) && !e.picks?.[n] ? hiddenOptions(e)[0] || null : null;
  const hiddenChance = e => { const o = hiddenOptions(e); return o.length ? o.reduce((a, x) => a + x.w * x.p, 0) : null; };
  const expectedLeft = m => {
    let exp = 0, hidden = 0;
    for (const e of m.entries.filter(inThisWeek)) {
      const p = e.picks?.[n];
      if (!p) { hidden++; exp += hiddenChance(e) ?? 1; continue; }
      exp += settledPick(p) ? (p.result === "won" ? 1 : 0) : chanceOf(p.team) ?? 1;
    }
    return { exp, hidden };
  };
  // This week, simulated (Jim, 2026-10-25): each game is drawn once from its live win chance, so entries on the same
  // team live or die together; hidden picks are drawn from hiddenOptions. Gives the topline's likely range and the
  // ledger's Live value (each manager's average share of the pot, everyone revived if every entry loses).
  const sim = (() => {
    const inPlay = (feed?.entries || []).filter(inThisWeek);
    if (!thisWeek || !inPlay.length) return null;
    const lost = inPlay.filter(e => settledPick(e.picks?.[n]) && e.picks[n].result === "lost").length;
    const graded = inPlay.filter(e => settledPick(e.picks?.[n])).length;
    const hidden = inPlay.filter(e => !e.picks?.[n]).length;
    const games = new Map((nflGames || []).flatMap(g => (g.teams || []).map(t => [feedTeam(t.abbrev), g])));
    const plan = inPlay.map(e => { const p = e.picks?.[n]; return !p ? { opts: hiddenOptions(e) } : settledPick(p) ? { fixed: p.result === "won" } : { team: p.team }; });
    let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const SIMS = 2000, counts = [], value = {};
    for (let s = 0; s < SIMS; s++) {
      const winner = new Map();
      const wins = team => {
        const g = games.get(team);
        if (!g) return true;
        if (!winner.has(g.id)) { const [h, a] = [g.teams.find(t => t.home), g.teams.find(t => !t.home)]; winner.set(g.id, feedTeam(rand() < (h.winChance ?? 0.5) ? h.abbrev : a.abbrev)); }
        return winner.get(g.id) === team;
      };
      const pick = opts => { let r = rand(); for (const o of opts) if ((r -= o.w) < 0) return o.team; return opts[opts.length - 1].team; };
      let alive = inPlay.filter((e, i) => { const x = plan[i]; return x.fixed != null ? x.fixed : x.team ? wins(x.team) : !x.opts.length || wins(pick(x.opts)); });
      counts.push(alive.length);
      if (!alive.length) alive = inPlay;
      for (const e of alive) value[e.user] = (value[e.user] || 0) + pot / alive.length / SIMS;
    }
    counts.sort((a, b) => a - b);
    return { total: inPlay.length, lost, hidden, final: graded === inPlay.length, exp: counts.reduce((a, b) => a + b, 0) / SIMS,
      lo: counts[Math.floor(SIMS * 0.1)], hi: counts[Math.floor(SIMS * 0.9)], value };
  })();
  // As it stands (Jim, 2026-10-25): results count once they're final or statistically locked (a pick in a live game
  // under 0.5% to win is out); anything still open counts as surviving. Each standing entry gets an equal share.
  const LOCKED = 0.005;
  const stands = (() => {
    const inPlay = (feed?.entries || []).filter(inThisWeek);
    if (!inPlay.length) return {};
    const out = e => { const p = e.picks?.[n]; if (!p || !thisWeek) return !e.alive; if (settledPick(p)) return p.result === "lost"; const ch = chanceOf(p.team); return ch != null && ch < LOCKED; };
    let standing = inPlay.filter(e => !out(e));
    if (!standing.length) standing = inPlay;
    const value = {};
    for (const e of standing) value[e.user] = (value[e.user] || 0) + pot / standing.length;
    return value;
  })();
  return { n, splashWeek, lookAhead, thisWeek, fee, pot, total, chanceOf, settledPick, hiddenOptions, predictedPick, expectedLeft, sim, stands };
}

// Last one standing (Jim, 2026-11-17: "each team greedily picks the safest choice available to them each week, and
// simulate the odds of each being the last team standing"). This week plays out as in survivorModel's sim (live
// odds, hidden picks drawn from hiddenOptions); every later week, each surviving entry takes its unused team with
// the best odds that week (season = data/current/nfl-season-odds.json: sportsbook lines where posted, ESPN FPI
// beyond), and each game is drawn once, so entries on the same team live or die together. If every remaining entry
// loses the same week, they're all revived (the pool's rule); whoever is left alone wins, and entries still alive
// after Week 18 split. Returns { win: { user: chance of the pot }, sims, through }.
export function lastStanding(feed, nflGames, nflWeek, season, sims = 5000) {
  const m = survivorModel(feed, nflGames, nflWeek);
  const n = m.n;
  const entries = (feed?.entries || []).filter(e => e.alive || (!m.lookAhead && e.eliminatedWeek === n));
  if (!m.thisWeek || !entries.length) return null;
  const used0 = entries.map(e => Object.entries(e.picks || {}).filter(([w]) => Number(w) < n).map(([, p]) => p.team));
  const thisGames = new Map((nflGames || []).flatMap(g => (g.teams || []).map(t => [feedTeam(t.abbrev), { id: `n:${g.id}`, p: t.winChance == null ? 0.5 : Number(t.winChance) }])));
  // Later weeks: team -> { game id, chance to win }.
  const later = [];
  for (const [w, games] of Object.entries(season?.weeks || {})) {
    if (Number(w) <= n) continue;
    later.push([Number(w), new Map((games || []).flatMap(([h, a, p], i) => [[feedTeam(h), { id: `${w}:${i}`, p }], [feedTeam(a), { id: `${w}:${i}`, p: 1 - p }]]))]);
  }
  later.sort((x, y) => x[0] - y[0]);
  const plan = entries.map(e => { const p = e.picks?.[n]; return !p ? { opts: m.hiddenOptions(e) } : m.settledPick(p) ? { fixed: p.result === "won", team: p.team } : { team: p.team }; });
  let seed = 11; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const win = new Array(entries.length).fill(0);
  for (let s = 0; s < sims; s++) {
    const drawn = new Map();
    const wins = (game, chance) => {
      if (!game) return true;   // no game found: a bye can't be picked, so count it as safe
      if (!drawn.has(game.id)) drawn.set(game.id, rand());
      // Both sides of a game share one draw: the side with chance p wins when the draw is under p, its opponent
      // (chance 1 - p) when it's at or over p.
      return game.side === 0 ? drawn.get(game.id) < chance : drawn.get(game.id) >= 1 - chance;
    };
    const look = (map, team) => { const g = map.get(team); if (!g) return null; const first = [...map.entries()].find(([, x]) => x.id === g.id)[0]; return { id: g.id, side: first === team ? 0 : 1, p: g.p }; };
    const used = used0.map(u => new Set(u));
    let alive = entries.map((_, i) => i);
    // This week.
    let next = alive.filter(i => {
      const x = plan[i];
      if (x.fixed != null) { used[i].add(x.team); return x.fixed; }
      let team = x.team;
      if (!team) {
        if (!x.opts.length) return true;
        let r = rand(); team = x.opts[x.opts.length - 1].team;
        for (const o of x.opts) if ((r -= o.w) < 0) { team = o.team; break; }
      }
      used[i].add(team);
      const g = look(thisGames, team);
      return g ? wins(g, g.p) : true;
    });
    if (next.length) alive = next;
    for (const [, games] of later) {
      if (alive.length <= 1) break;
      next = alive.filter(i => {
        let best = null;
        for (const [team, g] of games) if (!used[i].has(team) && (!best || g.p > best.p)) best = { team, ...g };
        if (!best) return false;   // out of teams
        used[i].add(best.team);
        const g = look(games, best.team);
        return wins(g, g.p);
      });
      if (next.length) alive = next;
    }
    for (const i of alive) win[i] += 1 / alive.length;
  }
  const out = {};
  entries.forEach((e, i) => { out[e.user] = (out[e.user] || 0) + win[i] / sims; });
  return { win: out, sims, through: later.length ? later[later.length - 1][0] : n };
}
