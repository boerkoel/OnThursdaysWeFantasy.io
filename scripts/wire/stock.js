import { round } from "../lib/simulation.js";
import { currentScores, currentWeek, fit, name, pct, pickLine, possessive, seasonOddsData, standingsData } from "./context.js";

// League Wire: playoff odds movers.
// ---- Stock report ------------------------------------------------------------
// Playoff odds movers: this week so far (from the start-of-week snapshot in
// season-odds.json), and last week's final moves in the week in review.
export const STOCK_MIN_MOVE = 10;
export function stockMovers(start, end, names = id => name(Number(id))) {
  return Object.keys(end || {}).filter(id => start?.[id] && Number.isFinite(start[id].playoffOdds) && Number.isFinite(end[id].playoffOdds))
    .map(id => ({team: names(id), from: start[id].playoffOdds, to: end[id].playoffOdds, move: end[id].playoffOdds - start[id].playoffOdds}))
    .filter(x => Math.abs(x.move) >= STOCK_MIN_MOVE).sort((a, b) => b.move - a.move);
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
export function addStockWatchStory(add) {
  if (Number(seasonOddsData?.week) !== currentWeek || currentScores.every(s => Number(s.score) === 0)) return;
  stockLines(stockMovers(seasonOddsData.weekStart, Object.fromEntries((seasonOddsData.teams || []).map(t => [String(t.teamId), t]))), "STOCK WATCH")
    .forEach((text, i) => add("STOCK WATCH", text, 66 - i));
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
// Seeds go by points, so nothing is mathematically certain with weeks left;
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

// ---- Live standings (Jim, 2026-10-25: point people at the Standings tab) -----
// Seeds go by points: this week's points so far re-rank them. The biggest
// climber and faller (2+ spots), and anyone crossing the playoff line.
export const LIVE_SEED_MOVE = 2;
export function addLiveStandingsStory(add) {
  const table = standingsData?.standings || [];
  if (!table.length || table.some(t => Number(t.games) >= currentWeek) || currentScores.every(s => !(Number(s.score) > 0))) return;
  const cut = Number(seasonOddsData?.playoffTeamCount) || 6;
  const scoreOf = id => Number(currentScores.find(s => s.teamId === Number(id))?.score || 0);
  const before = [...table].sort((a, b) => b.pointsFor - a.pointsFor).map(t => t.id);
  const now = [...table].sort((a, b) => (b.pointsFor + scoreOf(b.id)) - (a.pointsFor + scoreOf(a.id))).map(t => t.id);
  const moves = table.map(t => ({ id: t.id, from: before.indexOf(t.id) + 1, to: now.indexOf(t.id) + 1 }))
    .map(m => ({ ...m, move: m.from - m.to, crosses: (m.from > cut) !== (m.to > cut) }));
  const ord = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const lines = [];
  const into = moves.filter(m => m.crosses && m.to <= cut).sort((a, b) => b.move - a.move)[0];
  const outOf = moves.filter(m => m.crosses && m.to > cut).sort((a, b) => a.move - b.move)[0];
  if (into) lines.push([82, `📊 LIVE STANDINGS: As it stands, ${name(into.id)} would climb from ${ord(into.from)} into a playoff spot (${ord(into.to)})${outOf ? `, bumping ${name(outOf.id)} to ${ord(outOf.to)}` : ""}. Seeds go by points; check the Standings tab's live view.`]);
  const up = moves.filter(m => m.move >= LIVE_SEED_MOVE && m !== into).sort((a, b) => b.move - a.move)[0];
  const down = moves.filter(m => -m.move >= LIVE_SEED_MOVE && m !== outOf).sort((a, b) => a.move - b.move)[0];
  if (up) lines.push([74, `📈 LIVE STANDINGS: ${name(up.id)} is up ${up.move} spots this week, from ${ord(up.from)} to ${ord(up.to)} as it stands.`]);
  if (down) lines.push([73, `📉 LIVE STANDINGS: ${name(down.id)} is sliding, from ${ord(down.from)} to ${ord(down.to)} as it stands.`]);
  lines.slice(0, 2).forEach(([score, text]) => add("LIVE STANDINGS", fit(text, text.replace(" Seeds go by points; check the Standings tab's live view.", "")), score));
}
