// Survivor pool model (Jim, 2026-10-25), shared by the Survivor tab, the pinned card's Expected winnings and the
// League Wire's SURVIVOR ODDS story. Feed = the notification worker's /survivor; nflGames = scoreboard.nflGames.
const ENTRY_FEE = 5;
const FEED_ABBR = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
export const feedTeam = a => FEED_ABBR[a] || a;

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
  const n = Number(c.currentWeek);
  const thisWeek = nflWeek == null || Number(nflWeek) === n;
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
    const total = opts.reduce((a, o) => a + o.p ** 8, 0);
    return total ? opts.map(o => ({ ...o, w: o.p ** 8 / total })) : [];
  };
  const hiddenChance = e => { const o = hiddenOptions(e); return o.length ? o.reduce((a, x) => a + x.w * x.p, 0) : null; };
  const expectedLeft = m => {
    let exp = 0, hidden = 0;
    for (const e of m.entries.filter(e => e.alive || e.eliminatedWeek === n)) {
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
    const inPlay = (feed?.entries || []).filter(e => e.alive || e.eliminatedWeek === n);
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
    const inPlay = (feed?.entries || []).filter(e => e.alive || e.eliminatedWeek === n);
    if (!inPlay.length) return {};
    const out = e => { const p = e.picks?.[n]; if (!p || !thisWeek) return !e.alive; if (settledPick(p)) return p.result === "lost"; const ch = chanceOf(p.team); return ch != null && ch < LOCKED; };
    let standing = inPlay.filter(e => !out(e));
    if (!standing.length) standing = inPlay;
    const value = {};
    for (const e of standing) value[e.user] = (value[e.user] || 0) + pot / standing.length;
    return value;
  })();
  return { n, thisWeek, fee, pot, total, chanceOf, settledPick, hiddenOptions, expectedLeft, sim, stands };
}
