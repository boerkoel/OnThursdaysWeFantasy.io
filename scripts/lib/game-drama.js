import { feedTeam } from "./survivor-model.js";

// 🔥 Drama index for this week's NFL games (Jim, 2026-10-31, after 538's bracket excitement index), shared by the
// Games tab and the League Wire's MUST-WATCH story. Each game gets 0-100 plus its top reasons.
// The league's NFL rooting interests (Jim): fans per team; the Rams' hometown fans count at a fair-weather discount.
export const LEAGUE_FANS = { LV: 1, KC: 2, SF: 3, LAR: 1.5, DET: 1 };
const FAN_NAMES = { LV: "Raiders", KC: "Chiefs", SF: "Niners", LAR: "Rams", DET: "Lions" };
const lev = p => 4 * p * (1 - p);   // 1 at a coin flip, 0 when decided
const clamp01 = x => Math.max(0, Math.min(1, x));

// Kickers and defenses: a defense is on the field when the other team has the ball.
const isDefense = p => p.pos === "D/ST";

// Every league starter (main league and guillotine lineups) with its NFL game.
export function leagueStarters(games, scores, guillotineTeams) {
  const gameOfTeam = new Map(games.flatMap(g => (g.teams || []).map(t => [Number(t.id), g])));
  return [
    ...scores.flatMap(s => (s.lineup?.starters || []).map(p => ({ ...p, league: "main", teamId: Number(s.teamId), owner: s.team }))),
    ...guillotineTeams.flatMap(t => (t.lineup || []).map(p => ({ ...p, league: "g", teamId: Number(t.teamId), owner: t.team })))
  ].map(p => ({ ...p, game: gameOfTeam.get(Number(p.proTeamId)) })).filter(p => p.game);
}

// games: scoreboard.nflGames; scores: scoreboard.scores; guillotineTeams: this week's guillotine.teams (or []);
// svPicks: [{ user, team }] this week's revealed survivor picks; lineOf(game): the worker's /lines entry or null;
// swings: live-plays.json's gameSwings, the league odds each game's plays have moved ({ [game id]: { win, ticket, chop } }).
export function rateGames({ games, scores, guillotineTeams = [], svPicks = [], lineOf = () => null, swings = {}, starters = leagueStarters(games, scores, guillotineTeams) }) {
  // Pieces, each 0-1:
  // - close: a coin flip before kickoff (the betting line); live, how close it is weighted by how late it is
  // - upset: how far the pregame favorite has fallen
  // - fantasy: league starters' projections weighted by how undecided their matchups (or chop races) are, vs the week's biggest
  // - playoff: how much both NFL teams' playoff odds are still in play (FPI)
  // - survivor: survivor entries riding a side, weighted by its chance to lose
  // - breakout: a starter under 50% rostered beating his projection by 6+ points
  // - shootout: the over/under (pregame only)
  // - surprise: live, on pace to blow past the over/under (a game nobody circled turning wild)
  // - fans: the league's own rooting interests (LEAGUE_FANS)
  // - swing: 🎯 fantasy swing (Jim, 2026-11-02), how far its plays have moved league odds (matchup win odds,
  //   top-score ticket odds, median odds, chop odds; percentage points summed). 0-100: 50 pts → 28, 150 → 63, 300 → 86.
  // Finals look back on the whole game instead (Jim, 2026-11-02), from g.recap (update-live-scoreboard.js):
  // - thrill: total win-probability swing; finish: how close it was late (overtime counts extra);
  //   comeback: how low the winner's chances got; knocked out: survivor entries that lost on it; fantasy: league points scored
  const scoreOf = new Map(scores.map(s => [Number(s.teamId), s]));
  const chopOf = new Map(guillotineTeams.map(t => [Number(t.teamId), Number(t.chopProbability) || 0]));
  const gameOfAbbrev = abbrev => games.find(g => (g.teams || []).some(t => feedTeam(t.abbrev) === abbrev));
  const rateGame = g => {
    const home = (g.teams || []).find(t => t.home), away = (g.teams || []).find(t => !t.home);
    if (!home || !away) return null;
    const line = lineOf(g), latest = line?.moves?.[line.moves.length - 1] || line?.open;
    const preHome = latest?.homeWin != null ? latest.homeWin / 100 : g.state === "pre" ? home.winChance : null;
    const inGame = starters.filter(p => p.game === g);
    let fantasyRaw = 0;
    for (const p of inGame) {
      const w = p.league === "main" ? lev((Number(scoreOf.get(p.teamId)?.winProbability) || 50) / 100) : lev((chopOf.get(p.teamId) || 0) / 100);
      fantasyRaw += (p.projection || 0) * w;
    }
    // The H2H matchup and the chop race this game could swing most: undecided (leverage) × the league
    // points riding on this game.
    const ptsBy = new Map();
    for (const x of inGame) { const k = x.league + x.teamId; const v = ptsBy.get(k) || { pts: 0, names: [] }; v.pts += x.projection || 0; v.names.push(x.name); ptsBy.set(k, v); }
    let h2h = null, chop = null;
    for (const sc of scores) {
      if (Number(sc.teamId) > Number(sc.opponentId)) continue;   // each matchup once
      const a = ptsBy.get("main" + Number(sc.teamId)), b = ptsBy.get("main" + Number(sc.opponentId));
      if (!a && !b) continue;
      const wp = (Number(sc.winProbability) || 50) / 100;
      const v = lev(wp) * clamp01(((a?.pts || 0) + (b?.pts || 0)) / 30);
      if (!h2h || v > h2h.v) h2h = { v, text: `Could swing ${sc.team} vs ${sc.opponent} (${Math.round(wp * 100)}–${Math.round((1 - wp) * 100)}): ${[...(a?.names || []), ...(b?.names || [])].slice(0, 3).join(", ")}` };
    }
    for (const t of guillotineTeams) {
      const mine = ptsBy.get("g" + Number(t.teamId)), c = (Number(t.chopProbability) || 0) / 100;
      if (!mine || c < 0.05) continue;
      const v = clamp01(lev(Math.min(c, 0.5)) * clamp01(mine.pts / 20) * 1.2);
      if (!chop || v > chop.v) chop = { v, text: `🪓 Could decide the chop: ${t.team} (${Math.round(c * 100)}% chop odds) has ${mine.names.slice(0, 2).join(", ")}` };
    }
    const riders = svPicks.filter(x => gameOfAbbrev(x.team) === g);
    const sideOf = abbrev => [home, away].find(t => feedTeam(t.abbrev) === abbrev);
    const losers = g.completed ? riders.filter(x => (sideOf(x.team)?.score ?? 0) < Math.max(home.score, away.score)) : [];
    const svOut = losers.length / Math.max(1, svPicks.length);
    const svRisk = riders.reduce((a, x) => a + (g.completed ? 0 : 1 - (sideOf(x.team)?.winChance ?? 0.5)), 0) / Math.max(1, svPicks.length);
    const playoff = [home, away].reduce((a, t) => a + (t.playoffOdds == null ? 0 : lev(t.playoffOdds / 100)), 0) / 2;
    const progress = g.state === "in" ? clamp01(((Number(g.period) || 1) - 1 + (900 - (Number(g.clock) || 0)) / 900) / 4) : g.completed ? 1 : 0;
    const p = home.winChance ?? 0.5;
    const close = g.state === "pre" ? (preHome == null ? 0 : lev(preHome)) : g.completed ? 0 : lev(p) * (0.4 + 0.6 * progress);
    const favHome = preHome != null && preHome >= 0.5;
    const upset = preHome == null || g.state === "pre" ? 0 : clamp01((favHome ? preHome - (g.completed ? (home.score > away.score ? 1 : 0) : p) : (1 - preHome) - (g.completed ? (away.score > home.score ? 1 : 0) : 1 - p)) * 1.4);
    const boomer = inGame.filter(x => x.owned != null && x.owned < 50 && x.projection != null && x.actual - x.projection >= 6).sort((a, b) => (b.actual - b.projection) - (a.actual - a.projection))[0];
    const breakout = boomer ? clamp01((boomer.actual - boomer.projection) / 15) : 0;
    const shootout = latest?.total != null ? clamp01((latest.total - 38) / 16) : 0;
    const pace = progress >= 0.25 ? (home.score + away.score) / progress : null;
    const surprise = pace != null && latest?.total != null ? clamp01((pace - latest.total) / 20) : 0;
    const fanTeams = [away, home].filter(t => LEAGUE_FANS[t.abbrev]);
    const fans = clamp01(fanTeams.reduce((a, t) => a + LEAGUE_FANS[t.abbrev], 0) / 3);
    const fav = favHome ? home : away;
    const sw = swings[g.id] || null, oddsMoved = sw ? (sw.win || 0) + (sw.ticket || 0) + (sw.median || 0) + (sw.chop || 0) : 0;
    const swing = 1 - Math.exp(-oddsMoved / 150);
    const rc = g.completed ? g.recap : null, winner = home.score > away.score ? home : away;
    const thrill = rc ? clamp01((rc.excitement - 1) / 5) : 0;
    const comeback = rc ? clamp01((0.5 - rc.low) / 0.45) : 0;
    // Without the win-probability history, the final margin stands in: a field goal or less is close.
    const finish = rc ? clamp01(rc.late + (rc.overtime ? 0.25 : 0)) : g.completed ? clamp01(1 - (Math.abs(home.score - away.score) - 3) / 14) : 0;
    // League points scored in this game, and who's on the field right now: the offense's league starters plus the
    // other team's defense (each player once, even if started in both leagues).
    const leaguePts = inGame.reduce((a, x) => a + (Number(x.actual) || 0), 0);
    const ball = g.state === "in" ? Number(g.drive?.possession) || null : null;
    const onField = ball ? [...new Map(inGame.filter(x => isDefense(x) ? Number(x.proTeamId) !== ball : Number(x.proTeamId) === ball).map(x => [x.id ?? x.name, x])).values()] : [];
    // In game the line and over/under are the live market's (g.live); the pregame ones still drive shootout and surprise.
    return { g, home, away, spread: g.live?.spread ?? latest?.spread ?? null, total: g.live?.total ?? latest?.total ?? null,
      pregameSpread: latest?.spread ?? null, pregameTotal: latest?.total ?? null, leaguePts, ball, onField, fantasyRaw, playoff, svRisk, svOut, sw, oddsMoved, swing, swingScore: sw ? Math.round(100 * swing) : null, thrill, finish, comeback, close, upset, breakout, shootout, surprise, fans, inGame, riders,
      why: g.completed ? [
        [thrill >= 0.5 ? thrill : 0, "Back and forth all game"],
        [finish, rc?.overtime ? "Went to overtime" : "Down to the wire"],
        [comeback, `Comeback: ${winner.abbrev} was down to ${Math.round((rc?.low ?? 0) * 100)}%`],
        [upset, `Upset: ${fav.abbrev} was ${Math.round(Math.max(preHome ?? 0, 1 - (preHome ?? 0)) * 100)}% before kickoff`],
        [swing, `🎯 Swung league odds ${Math.round(oddsMoved)} pts`],
        [svOut * 3, `🛡️ Knocked out ${losers.length} survivor ${losers.length === 1 ? "entry" : "entries"}`],
        [breakout, boomer ? `Breakout: ${boomer.name} (${boomer.owned}% rostered) had ${boomer.actual.toFixed(2)}` : ""],
        // The card's line row already shows the O/U and where it moved (Jim, 2026-11-08: said twice).
        [surprise, `Off script: ${home.score + away.score} points`],
        [fans * 0.7, `League rooting interest: ${fanTeams.map(t => `${FAN_NAMES[t.abbrev]} fans`).join(" vs ")}`]
      ] : [
        [h2h?.v || 0, h2h?.text || ""],
        [chop?.v || 0, chop?.text || ""],
        [g.state === "in" ? swing : 0, `🎯 Has swung league odds ${Math.round(oddsMoved)} pts`],
        [close >= 0.85 ? close : 0, g.state === "pre" ? `Coin flip: ${Math.round((preHome ?? 0.5) * 100)}–${Math.round((1 - (preHome ?? 0.5)) * 100)}` : `Too close to call: ${Math.round(p * 100)}–${Math.round((1 - p) * 100)}`],
        [upset, `Upset ${g.completed ? "" : "brewing"}: ${fav.abbrev} was ${Math.round(Math.max(preHome ?? 0, 1 - (preHome ?? 0)) * 100)}% before kickoff`.replace("Upset :", "Upset:")],
        [svRisk * 3, `🛡️ ${riders.length} survivor ${riders.length === 1 ? "entry" : "entries"} riding ${[...new Set(riders.map(x => x.team))].join("/")}`],
        [breakout, boomer ? `Breakout: ${boomer.name} (${boomer.owned}% rostered) has ${boomer.actual.toFixed(2)}` : ""],
        [playoff * 0.8, `Playoff stakes: ${away.abbrev} ${Math.round(away.playoffOdds ?? 0)}%, ${home.abbrev} ${Math.round(home.playoffOdds ?? 0)}%`],
        [g.state === "pre" ? shootout * 0.6 : 0, `Shootout watch: O/U ${latest?.total}`],
        [surprise, `Off script: on pace for ${Math.round(pace ?? 0)} points`],
        [fans * 0.7, `League rooting interest: ${fanTeams.map(t => `${FAN_NAMES[t.abbrev]} fans`).join(" vs ")}`]
      ] };
  };
  const rated = games.map(rateGame).filter(Boolean);
  const maxFantasy = Math.max(1, ...rated.map(r => r.fantasyRaw));
  const maxFinalPts = Math.max(1, ...rated.filter(r => r.g.completed).map(r => r.leaguePts));
  for (const r of rated) {
    // A final's fantasy weight is the league points it produced (its stakes are settled by then).
    r.fantasy = r.g.completed ? r.leaguePts / maxFinalPts : r.fantasyRaw / maxFantasy;
    // Once plays have moved odds, that counts half: what the game did, next to what it had riding on it.
    if (r.sw && r.g.state !== "pre") r.fantasy = 0.5 * r.fantasy + 0.5 * r.swing;
    const sv = clamp01(r.svRisk * 3);
    const raw = r.g.completed
      ? 0.35 * r.thrill + 0.2 * r.finish + 0.15 * r.comeback + 0.07 * r.upset + 0.1 * r.fantasy + 0.05 * clamp01(r.svOut * 3) + 0.04 * r.breakout + 0.04 * r.surprise + 0.05 * r.fans
      : r.g.state === "pre"
      ? 0.25 * r.close + 0.1 * r.shootout + 0.25 * r.fantasy + 0.15 * r.playoff + 0.15 * sv + 0.1 * r.fans
      : 0.2 * r.close + 0.15 * r.upset + 0.18 * r.fantasy + 0.08 * r.playoff + 0.12 * sv + 0.08 * r.breakout + 0.09 * r.surprise + 0.1 * r.fans;
    // A game being played always beats one that hasn't started (Jim, 2026-11-01): live games score 50-100,
    // upcoming ones 0-50 (anticipation), finals 0-100 for how dramatic they were.
    r.drama = Math.round(r.g.state === "in" ? 50 + 50 * raw : r.g.state === "pre" ? 50 * raw : 100 * clamp01(raw));
    r.reasons = r.why.filter(([v, text]) => v >= 0.35 && text).sort((a, b) => b[0] - a[0]).map(([, text]) => text);
  }
  return rated;
}
