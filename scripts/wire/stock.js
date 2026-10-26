import { round } from "../lib/simulation.js";
import { currentScores, currentWeek, fit, name, pct, pickLine, possessive, seasonOddsData, standingsData } from "./context.js";

// League Wire: playoff odds movers.
// ---- Stock report ------------------------------------------------------------
// Playoff odds movers: this week so far (from the start-of-week snapshot in
// season-odds.json), and last week's final moves in the week in review.
export const STOCK_MIN_MOVE = 10;
export function stockMovers(start, end, names = id => name(Number(id)), min = STOCK_MIN_MOVE) {
  return Object.keys(end || {}).filter(id => start?.[id] && Number.isFinite(start[id].playoffOdds) && Number.isFinite(end[id].playoffOdds))
    .map(id => ({team: names(id), from: start[id].playoffOdds, to: end[id].playoffOdds, move: end[id].playoffOdds - start[id].playoffOdds}))
    .filter(x => Math.abs(x.move) >= min).sort((a, b) => b.move - a.move);
}
// Up to two stories: the biggest riser and the biggest faller.
export function stockLines(movers, label) {
  const up = movers[0]?.move > 0 ? movers[0] : null;
  const down = movers.at(-1)?.move < 0 ? movers.at(-1) : null;
  const upText = up && pickLine("up" + up.team + label, [
    possessive(up.team) + " playoff odds are up from " + pct(up.from) + " to " + pct(up.to) + ". Buy now before it's too late.",
    possessive(up.team) + " playoff odds surged from " + pct(up.from) + " to " + pct(up.to) + ". Analysts are calling it a bubble.",
    possessive(up.team) + " playoff odds climbed from " + pct(up.from) + " to " + pct(up.to) + ". Somebody's been reading the waiver wire."
  ]);
  const downText = down && pickLine("down" + down.team + label, [
    possessive(down.team) + " playoff odds slid from " + pct(down.from) + " to " + pct(down.to) + ". Thoughts and prayers.",
    possessive(down.team) + " playoff odds cratered from " + pct(down.from) + " to " + pct(down.to) + ". Somebody check on the group chat.",
    possessive(down.team) + " playoff odds fell from " + pct(down.from) + " to " + pct(down.to) + ". Selling at a loss is still selling."
  ]);
  return [up && "📈 " + label + ": " + upText, down && "📉 " + label + ": " + downText].filter(Boolean);
}
// While the week is on (Jim, 2026-10-25): smaller moves count (6+ pts), tied
// to the week's results so far: expected wins = H2H win odds + odds of beating
// the median (out of 2).
export const LIVE_STOCK_MIN_MOVE = 6;
export function addStockWatchStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek || currentScores.every(s => Number(s.score) === 0)) return;
  const movers = stockMovers(seasonOddsData.weekStart, Object.fromEntries((seasonOddsData.teams || []).map(t => [String(t.teamId), t])),
    id => id, LIVE_STOCK_MIN_MOVE);
  const ew = id => { const s = currentScores.find(x => x.teamId === Number(id)); return s && s.winProbability != null ? (Number(s.winProbability) + Number(s.aboveMedianProbability || 0)) / 100 : null; };
  const up = movers[0]?.move > 0 ? movers[0] : null, down = movers.at(-1)?.move < 0 ? movers.at(-1) : null;
  // Live odds use projected finals, so a move is where a team is headed ("in line to"), not yet banked.
  const exp = id => { const e = ew(id); return e != null ? ` (${e.toFixed(1)} expected wins of 2)` : ""; };
  const rise = x => `${name(Number(x.team))} is in line to raise their playoff odds ${Math.round(x.move)} pts this week${exp(x.team)}, ${pct(x.from)} → ${pct(x.to)}`;
  const fall = (x, joined) => `${name(Number(x.team))} ${joined ? "is dropping" : "is on track to drop"} ${Math.round(-x.move)} pts${joined ? "" : " of playoff odds this week"}${exp(x.team)}, ${pct(x.from)} → ${pct(x.to)}`;
  if (up && down) {   // Jim, 2026-10-26: one story, both directions
    add("STOCK WATCH", fit(
      `📈📉 STOCK WATCH: ${rise(up)}, while ${fall(down, true)}.`,
      `📈📉 STOCK WATCH: ${name(Number(up.team))} ${pct(up.from)} → ${pct(up.to)} playoff odds; ${name(Number(down.team))} ${pct(down.from)} → ${pct(down.to)}.`
    ), 70 + Math.min(Math.max(up.move, -down.move), 20) / 2);
  } else if (up) {
    add("STOCK WATCH", fit(`📈 STOCK WATCH: ${rise(up)}.`,
      `📈 STOCK WATCH: ${name(Number(up.team))}: playoff odds ${pct(up.from)} → ${pct(up.to)} on this week's results.`), 68 + Math.min(up.move, 20) / 2);
  } else if (down) {
    add("STOCK WATCH", fit(`📉 STOCK WATCH: ${fall(down)}.`,
      `📉 STOCK WATCH: ${name(Number(down.team))}: playoff odds ${pct(down.from)} → ${pct(down.to)} on this week's results.`), 67 + Math.min(-down.move, 20) / 2);
  }
}

// ---- Playoff swing (Jim, 2026-10-25: prioritize it) ------------------------------
// This week's game whose result moves the playoff race most: the change in
// both teams' playoff odds between winning and losing (season-odds.json
// matchupLeverage). Runs until the game is decided.
export const SWING_MIN = 15;
export function addPlayoffSwingStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek) return;
  const open = id => { const s = currentScores.find(x => x.teamId === Number(id)); const p = Number(s?.winProbability); return !s || (p > 1 && p < 99); };
  const games = (seasonOddsData.matchupLeverage || []).filter(g => g.ifHomeWins?.home != null && g.ifAwayWins?.home != null && open(g.home))
    .map(g => ({ ...g, swing: Math.abs(g.ifHomeWins.home - g.ifAwayWins.home) + Math.abs(g.ifHomeWins.away - g.ifAwayWins.away) }))
    .sort((a, b) => b.swing - a.swing);
  const g = games[0];
  if (!g || g.swing < SWING_MIN) return;
  const side = (id, win, lose) => `${name(id)} ${pct(win)} with a win, ${pct(lose)} with a loss`;
  const lead = pickLine("swing" + g.home + g.away, [
    `${name(g.home)} vs ${name(g.away)} is the game of the week for the playoff race.`,
    `No matchup moves the playoff picture more than ${name(g.home)} vs ${name(g.away)}.`,
    `The playoff race runs through ${name(g.home)} vs ${name(g.away)} this week.`
  ]);
  add("PLAYOFF SWING", fit(
    "🎯 PLAYOFF SWING: " + lead + " Playoff odds: " + side(g.home, g.ifHomeWins.home, g.ifAwayWins.home) + "; " + side(g.away, g.ifAwayWins.away, g.ifHomeWins.away) + ".",
    "🎯 PLAYOFF SWING: " + name(g.home) + " vs " + name(g.away) + ". Playoff odds with a win / loss: " + name(g.home) + " " + pct(g.ifHomeWins.home) + " / " + pct(g.ifAwayWins.home) + ", " + name(g.away) + " " + pct(g.ifAwayWins.away) + " / " + pct(g.ifHomeWins.away) + "."
  ), 86 + Math.min(g.swing - SWING_MIN, 30) / 10);   // Jim: always in the top 8
}

// ---- Clinch watch (Jim, 2026-10-25) -------------------------------------------
// Seeds go by record (points break ties); this is a simulation, so nothing is certain with weeks left;
// 99.5% in the season simulation counts as "all but". Stories, best first:
// - a team that can all but lock up a spot with a win (or lose it with a loss)
//   this week: the #1 seed, a playoff spot, or last place;
// - a team that has all but locked one up already.
export const LOCK = 99.5;
export function addClinchStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek) return;
  const teams = new Map((seasonOddsData.teams || []).map(t => [t.teamId, t]));
  const open = id => { const s = currentScores.find(x => x.teamId === Number(id)); const p = Number(s?.winProbability); return !s || (p > 1 && p < 99); };
  const out = [];
  for (const g of seasonOddsData.matchupLeverage || []) {
    if (!g.top || !open(g.home)) continue;
    for (const [id, side, other] of [[g.home, "home", "away"], [g.away, "away", "home"]]) {
      const t = teams.get(id);
      if (!t) continue;
      const win = side === "home" ? "ifHomeWins" : "ifAwayWins", lose = side === "home" ? "ifAwayWins" : "ifHomeWins";
      const opp = name(g[other]);
      const checks = [
        ["#1 seed", t.topSeedOdds, g.top[win][side], g.top[lose][side], 90, "lock up the #1 seed"],
        ["playoffs", t.playoffOdds, g[win][side], g[lose][side], 86, "all but clinch a playoff spot"],
        ["last", t.lastSeedOdds, g.last[lose][side], g.last[win][side], 84, "be all but locked into last place"]
      ];
      for (const [what, now, ifGood, ifBad, score, phrase] of checks) {
        if (now == null || ifGood == null || now >= LOCK) continue;
        if (what === "last") {   // ifGood here = with a loss
          if (ifGood >= LOCK) out.push({ score, text: `🔒 CLINCH WATCH: ${name(id)} could ${phrase} with a loss to ${opp} (${pct(ifGood)} with a loss, ${pct(ifBad)} with a win).` });
        } else if (ifGood >= LOCK) {
          out.push({ score, text: `🔒 CLINCH WATCH: ${name(id)} can ${phrase} with a win over ${opp} (${pct(ifGood)} with a win, ${pct(ifBad)} with a loss).` });
        }
      }
    }
  }
  for (const t of teams.values()) {
    if (t.topSeedOdds >= LOCK) out.push({ score: 70, text: `🔒 CLINCH WATCH: ${name(t.teamId)} has all but locked up the #1 seed (${pct(t.topSeedOdds)}).` });
    if (t.lastSeedOdds >= LOCK) out.push({ score: 68, text: `🪦 CLINCH WATCH: ${name(t.teamId)} is all but locked into last place (${pct(t.lastSeedOdds)}).` });
  }
  out.sort((a, b) => b.score - a.score).slice(0, 2).forEach(x => add("CLINCH WATCH", x.text, x.score));
}

// ---- Bye watch (Jim, 2026-10-25: "will the wire announce when a team is eliminated from winning the bye?") ----
// The top 2 seeds get byes. Odds come from a simulation, so nothing is certain: "out" = under 0.5%.
// - a team that falls out of the bye race this week (had ≥0.5% at the start of the week);
// - a team still in it whose game this week decides it: a loss all but ends it.
export const BYE_OUT = 0.5;
export function addByeWatchStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek) return;
  const start = seasonOddsData.weekStart || {};
  const open = id => { const s = currentScores.find(x => x.teamId === Number(id)); const p = Number(s?.winProbability); return !s || (p > 1 && p < 99); };
  const teams = new Map((seasonOddsData.teams || []).map(t => [t.teamId, t]));
  const out = [];
  // Snapshots before 2026-10-25 lack byeOdds: then only the team just under the line counts as newly out.
  const justOut = Math.max(...[...teams.values()].map(t => t.byeOdds).filter(x => x != null && x < BYE_OUT));
  for (const t of teams.values()) {
    const was = start[String(t.teamId)]?.byeOdds;
    if (t.byeOdds != null && t.byeOdds < BYE_OUT && (was == null ? t.byeOdds === justOut : was >= BYE_OUT))
      out.push({ score: 74, text: `🚪 BYE WATCH: ${name(t.teamId)} is all but out of the race for a first-round bye (${pct(t.byeOdds)}${was != null ? `, from ${pct(was)} at the start of the week` : ""}).` });
  }
  for (const g of seasonOddsData.matchupLeverage || []) {
    if (!g.bye || !open(g.home)) continue;
    for (const [id, side, other] of [[g.home, "home", "away"], [g.away, "away", "home"]]) {
      const t = teams.get(id), win = side === "home" ? "ifHomeWins" : "ifAwayWins", lose = side === "home" ? "ifAwayWins" : "ifHomeWins";
      const ifWin = g.bye[win][side], ifLose = g.bye[lose][side];
      if (!t || t.byeOdds < BYE_OUT || ifWin == null || ifLose == null) continue;
      if (ifLose < BYE_OUT && ifWin >= 5)
        out.push({ score: 78, text: `🚪 BYE WATCH: ${name(id)} needs to beat ${name(g[other])} to stay in the bye race (${pct(ifWin)} with a win, ${pct(ifLose)} with a loss).` });
    }
  }
  out.sort((a, b) => b.score - a.score).slice(0, 2).forEach(x => add("BYE WATCH", x.text, x.score));
}

// ---- Live standings (Jim, 2026-10-25: point people at the Standings tab) -----
// Seeds go by record, points for breaks ties. As it stands = this week's results that are locked (99.5%+ either
// way, like the Standings tab's As it stands view) plus points so far. The biggest climber and faller (2+ spots),
// and anyone crossing the playoff line.
export const LIVE_SEED_MOVE = 2;
export function addLiveStandingsStory(add) {
  const table = standingsData?.standings || [];
  if (!table.length || table.some(t => Number(t.games) >= currentWeek) || currentScores.every(s => !(Number(s.score) > 0))) return;
  const cut = Number(seasonOddsData?.playoffTeamCount) || 6;
  const cur = id => currentScores.find(s => s.teamId === Number(id));
  const scoreOf = id => Number(cur(id)?.score || 0);
  const lockedWins = id => { const s = cur(id); return s ? [s.winProbability, s.aboveMedianProbability].filter(p => Number(p) >= LOCK).length : 0; };
  const before = [...table].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor).map(t => t.id);
  const now = [...table].sort((a, b) => (b.wins + lockedWins(b.id)) - (a.wins + lockedWins(a.id)) || (b.pointsFor + scoreOf(b.id)) - (a.pointsFor + scoreOf(a.id))).map(t => t.id);
  const moves = table.map(t => ({ id: t.id, from: before.indexOf(t.id) + 1, to: now.indexOf(t.id) + 1 }))
    .map(m => ({ ...m, move: m.from - m.to, crosses: (m.from > cut) !== (m.to > cut) }));
  const ord = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const lines = [];
  const into = moves.filter(m => m.crosses && m.to <= cut).sort((a, b) => b.move - a.move)[0];
  const outOf = moves.filter(m => m.crosses && m.to > cut).sort((a, b) => a.move - b.move)[0];
  if (into) lines.push([82, `📊 LIVE STANDINGS: As it stands, ${name(into.id)} would climb from ${ord(into.from)} into a playoff spot (${ord(into.to)})${outOf ? `, bumping ${name(outOf.id)} to ${ord(outOf.to)}` : ""}. Check the Standings tab's As it stands view.`]);
  const up = moves.filter(m => m.move >= LIVE_SEED_MOVE && m !== into).sort((a, b) => b.move - a.move)[0];
  const down = moves.filter(m => -m.move >= LIVE_SEED_MOVE && m !== outOf).sort((a, b) => a.move - b.move)[0];
  if (up) lines.push([74, `📈 LIVE STANDINGS: ${name(up.id)} is up ${up.move} spots this week, from ${ord(up.from)} to ${ord(up.to)} as it stands.`]);
  if (down) lines.push([73, `📉 LIVE STANDINGS: ${name(down.id)} is sliding, from ${ord(down.from)} to ${ord(down.to)} as it stands.`]);
  lines.slice(0, 2).forEach(([score, text]) => add("LIVE STANDINGS", fit(text, text.replace(" Check the Standings tab's As it stands view.", "")), score));
}

// ---- Two wins (Jim, 2026-10-26: "what would happen with 2 wins, if it makes a difference") ----
// The team whose playoff odds swing most between 2 wins this week (H2H + median) and 0, while both are still
// live (each 5%+ likely) and the gap is 10+ pts. season-odds.json byWins.
export const TWO_WIN_MIN = 10;
export function addTwoWinsStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek || !seasonOddsData.byWins) return;
  const best = (seasonOddsData.teams || []).map(t => {
    const [zero, , two] = seasonOddsData.byWins[String(t.teamId)] || [];
    return zero && two && zero.chance >= 5 && two.chance >= 5 ? { t, zero, two, gap: two.playoffOdds - zero.playoffOdds } : null;
  }).filter(x => x && x.gap >= TWO_WIN_MIN).sort((a, b) => b.gap - a.gap)[0];
  if (!best) return;
  const { t, zero, two } = best;
  add("TWO WINS", fit(
    `🎯 TWO WINS: ${name(t.teamId)} is at ${pct(t.playoffOdds)} to make the playoffs. Winning both this week (head-to-head and the median, ${pct(two.chance)} likely) would lift that to ${pct(two.playoffOdds)}; losing both drops it to ${pct(zero.playoffOdds)}.`,
    `🎯 TWO WINS: ${name(t.teamId)}: ${pct(two.playoffOdds)} playoff odds with 2 wins this week, ${pct(zero.playoffOdds)} with none (now ${pct(t.playoffOdds)}).`
  ), 70 + Math.min(best.gap, 30) / 3);
}
