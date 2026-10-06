import { DATA, fit, pickLine, possessive, readJson } from "./context.js";

// League Wire: TRADE THAT NEEDS TO HAPPEN. The 1-for-1 swap where both
// sides gain the most, from the win-win trades calculate-stats.js finds
// (each team's optimal lineups before vs after, over the weeks played).
const teamsData = await readJson(`${DATA}/teams.json`).catch(() => null);

export function bestWinWinTrade() {
  const trades = (teamsData?.teams || []).flatMap(t => (t.profileAnalytics?.winWinTrades || [])
    .filter(x => x.perspective === "A")
    .map(x => ({ ...x, team: t.name })));
  return trades.sort((a, b) =>
    Math.min(b.yourWinsAdded, b.theirWinsAdded) - Math.min(a.yourWinsAdded, a.theirWinsAdded) ||
    (b.yourWinsAdded + b.theirWinsAdded) - (a.yourWinsAdded + a.theirWinsAdded) ||
    (b.yourBoost + b.theirBoost) - (a.yourBoost + a.theirBoost))[0] || null;
}

export function addTradeStory(add) {
  const t = bestWinWinTrade();
  if (!t || Math.min(t.yourWinsAdded, t.theirWinsAdded) < 1) return;
  const wins = n => `${n} more win${n === 1 ? "" : "s"}`;
  const both = t.yourWinsAdded === t.theirWinsAdded
    ? `${wins(t.yourWinsAdded)} each`
    : `${wins(t.yourWinsAdded)} for ${t.team}, ${wins(t.theirWinsAdded)} for ${t.otherTeam}`;
  const lead = pickLine("trade:" + t.givePlayerId + ":" + t.getPlayerId, [
    "🤝 TRADE THAT NEEDS TO HAPPEN",
    "🤝 Somebody pick up the phone",
    "🤝 The trade machine has spoken"
  ]);
  const short = t.yourWinsAdded === t.theirWinsAdded ? `+${t.yourWinsAdded} win${t.yourWinsAdded === 1 ? "" : "s"} each`
    : `+${t.yourWinsAdded} for ${t.team}, +${t.theirWinsAdded} for ${t.otherTeam}`;
  add("TRADE THAT NEEDS TO HAPPEN", fit(
    `${lead}: ${possessive(t.team)} ${t.givePlayer} for ${possessive(t.otherTeam)} ${t.getPlayer}. Swapping them would have led to ${both} in their optimal lineups.`,
    `${lead}: ${possessive(t.team)} ${t.givePlayer} for ${possessive(t.otherTeam)} ${t.getPlayer}. Optimal lineups say ${short} in wins.`,
    `${lead}: ${possessive(t.team)} ${t.givePlayer} for ${possessive(t.otherTeam)} ${t.getPlayer}. Win-win: +${t.yourWinsAdded} and +${t.theirWinsAdded} wins in optimal lineups.`,
    `${lead}: ${possessive(t.team)} ${t.givePlayer} for ${possessive(t.otherTeam)} ${t.getPlayer}. A win-win in optimal lineups.`,
    `${lead}: ${t.givePlayer} for ${t.getPlayer} (${t.team} ↔ ${t.otherTeam}). Optimal lineups: ${short} in wins.`,
    `${lead}: ${t.givePlayer} ↔ ${t.getPlayer}, a win-win in optimal lineups.`
  ), 34);
}
