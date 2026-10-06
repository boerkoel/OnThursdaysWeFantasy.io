import { DATA, fit, listNames, pickLine, possessive, readJson, surname } from "./context.js";

// League Wire: TRADE THAT SHOULD HAVE HAPPENED (the swap where both sides would have gained the
// most) and up to two more RETRO TRADEs, from the retroactive win-win trades
// calculate-stats.js finds (each team's lineups before vs after, optimal or projection-set, over
// the weeks played). No player appears in two stories.
const teamsData = await readJson(`${DATA}/teams.json`).catch(() => null);

const playersIn = t => t.givePlayers || [t.givePlayer];
const gettingIn = t => t.getPlayers || [t.getPlayer];

export function rankedWinWinTrades() {
  const trades = (teamsData?.teams || []).flatMap(t => (t.profileAnalytics?.winWinTrades || [])
    .filter(x => x.perspective === "A")
    .map(x => ({ ...x, team: t.name })));
  return trades.filter(t => Math.min(t.yourWinsAdded, t.theirWinsAdded) >= 1).sort((a, b) =>
    Math.min(b.yourWinsAdded, b.theirWinsAdded) - Math.min(a.yourWinsAdded, a.theirWinsAdded) ||
    (b.yourWinsAdded + b.theirWinsAdded) - (a.yourWinsAdded + a.theirWinsAdded) ||
    (b.yourBoost + b.theirBoost) - (a.yourBoost + a.theirBoost));
}

const inLineups = t => (t.basis?.lineup === "projected" ? "projection-set lineups" : "optimal lineups") +
  (t.basis?.window && t.basis.window !== "season" ? ` over the ${t.basis.window}` : "");

// Always framed as hindsight: "if they had swapped back in Week N", never
// a promise that the trade will work out from here.
function story(t, lead) {
  // Multi-player trades name players by surname so the teams still fit.
  const multi = playersIn(t).length + gettingIn(t).length > 2;
  const label = list => listNames(multi ? list.map(surname) : list);
  const give = label(playersIn(t)), get = label(gettingIn(t));
  const when = t.fromWeek ? `back in Week ${t.fromWeek}` : "earlier this season";
  const gains = t.yourWinsAdded === t.theirWinsAdded
    ? `+${t.yourWinsAdded} win${t.yourWinsAdded === 1 ? "" : "s"} each`
    : `+${t.yourWinsAdded} and +${t.theirWinsAdded} wins`;
  const where = inLineups(t);
  return fit(
    `${lead}: If ${t.team} and ${t.otherTeam} had swapped ${give} for ${get} ${when}, both would be ahead: ${gains} in ${where}. Hindsight only!`,
    `${lead}: If ${t.team} and ${t.otherTeam} had swapped ${give} for ${get} ${when}, both would be ahead: ${gains} in ${where}.`,
    `${lead}: If ${t.team} and ${t.otherTeam} had swapped ${give} for ${get} ${when}, both would be ahead (${gains}).`,
    `${lead}: Had ${t.team} and ${t.otherTeam} swapped ${give} for ${get} ${when}, both would be ahead (${gains}).`,
    `${lead}: If ${t.team} and ${t.otherTeam} had swapped ${give} for ${get} ${when}, both would be ahead.`,
    `${lead}: ${give} for ${get} ${when} would have helped both ${t.team} and ${t.otherTeam}.`,
    `${lead}: ${give} ↔ ${get} ${when} would have helped both sides.`
  );
}

export function addTradeStory(add) {
  const used = new Set();
  const picks = [];
  for (const t of rankedWinWinTrades()) {
    const names = [...playersIn(t), ...gettingIn(t)];
    if (names.some(n => used.has(n))) continue;
    names.forEach(n => used.add(n));
    picks.push(t);
    if (picks.length === 3) break;
  }
  picks.forEach((t, i) => {
    const key = "trade:" + [...playersIn(t), ...gettingIn(t)].join("+");
    if (i === 0) {
      add("TRADE THAT SHOULD HAVE HAPPENED", story(t, pickLine(key, ["🔁 Trade that should have happened", "🕰️ Coulda-shoulda swap", "🔁 In hindsight"])), 72);
    } else {
      add("RETRO TRADE", story(t, pickLine(key, ["🕰️ Hindsight swap", "🔁 Retro trade", "🤔 What could have been"])), 40 - i);
    }
  });
}
