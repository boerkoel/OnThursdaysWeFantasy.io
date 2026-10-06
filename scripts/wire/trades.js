import { DATA, fit, listNames, pickLine, possessive, readJson } from "./context.js";

// League Wire: TRADE THAT NEEDS TO HAPPEN (the swap where both sides gain the
// most) and up to two more TRADE IDEAs, from the win-win trades
// calculate-stats.js finds (each team's optimal lineups before vs after, over
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

function story(t, lead) {
  const give = listNames(playersIn(t)), get = listNames(gettingIn(t));
  const wins = n => `${n} more win${n === 1 ? "" : "s"}`;
  const both = t.yourWinsAdded === t.theirWinsAdded
    ? `${wins(t.yourWinsAdded)} each`
    : `${wins(t.yourWinsAdded)} for ${t.team}, ${wins(t.theirWinsAdded)} for ${t.otherTeam}`;
  const short = t.yourWinsAdded === t.theirWinsAdded ? `+${t.yourWinsAdded} win${t.yourWinsAdded === 1 ? "" : "s"} each`
    : `+${t.yourWinsAdded} for ${t.team}, +${t.theirWinsAdded} for ${t.otherTeam}`;
  return fit(
    `${lead}: ${possessive(t.team)} ${give} for ${possessive(t.otherTeam)} ${get}. Swapping them would have led to ${both} in their optimal lineups.`,
    `${lead}: ${possessive(t.team)} ${give} for ${possessive(t.otherTeam)} ${get}. Optimal lineups say ${short}.`,
    `${lead}: ${possessive(t.team)} ${give} for ${possessive(t.otherTeam)} ${get}. Win-win: +${t.yourWinsAdded} and +${t.theirWinsAdded} wins in optimal lineups.`,
    `${lead}: ${possessive(t.team)} ${give} for ${possessive(t.otherTeam)} ${get}. A win-win in optimal lineups.`,
    `${lead}: ${give} for ${get} (${t.team} ↔ ${t.otherTeam}). Optimal lineups: ${short}.`,
    `${lead}: ${give} ↔ ${get}, a win-win in optimal lineups.`
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
      add("TRADE THAT NEEDS TO HAPPEN", story(t, pickLine(key, ["🤝 TRADE THAT NEEDS TO HAPPEN", "🤝 Somebody pick up the phone", "🤝 The trade machine has spoken"])), 72);
    } else {
      add("TRADE IDEA", story(t, pickLine(key, ["💡 Trade idea", "📞 Call your trade partner", "🔁 Swap shop"])), 40 - i);
    }
  });
}
