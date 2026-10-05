import { round } from "../lib/simulation.js";
import { currentScores, currentWeek, name, pct, pickLine, possessive, seasonOddsData } from "./context.js";

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
