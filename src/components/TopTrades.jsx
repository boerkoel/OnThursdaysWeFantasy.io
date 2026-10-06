import React from "react";
import { ShareButton, TeamLogo } from "./LiveBits.jsx";
import { basisTag } from "../lib/tradeBasis.js";

// Teams tab: the league's best win-win trades (1-for-1, 2-for-1, 2-for-2),
// ranked like the League Wire's TRADE THAT SHOULD HAVE HAPPENED: the smaller of
// the two sides' gains first, then the total. Gains are wins added in each
// team's lineups over the weeks played (see basis). No player appears twice.
const MAX_TRADES = 5;

export function topTrades(teams) {
  const all = (teams || []).flatMap(t => (t.profileAnalytics?.winWinTrades || [])
    .filter(x => x.perspective === "A").map(x => ({ ...x, teamId: t.id, team: t.name })))
    .filter(t => Math.min(t.yourWinsAdded, t.theirWinsAdded) >= 1)
    .sort((a, b) =>
      Math.min(b.yourWinsAdded, b.theirWinsAdded) - Math.min(a.yourWinsAdded, a.theirWinsAdded) ||
      (b.yourWinsAdded + b.theirWinsAdded) - (a.yourWinsAdded + a.theirWinsAdded) ||
      (b.yourBoost + b.theirBoost) - (a.yourBoost + a.theirBoost));
  const used = new Set(), out = [];
  for (const t of all) {
    const names = [...(t.givePlayers || [t.givePlayer]), ...(t.getPlayers || [t.getPlayer])];
    if (names.some(n => used.has(n))) continue;
    names.forEach(n => used.add(n));
    out.push(t);
    if (out.length === MAX_TRADES) break;
  }
  return out;
}

const wins = n => `+${n} win${Number(n) === 1 ? "" : "s"}`;
const players = (list, single) => (list || [single]).join(" + ");

export default function TopTrades({ teams, week }) {
  const trades = topTrades(teams);
  if (!trades.length) return null;
  const logoOf = id => (teams || []).find(t => Number(t.id) === Number(id))?.logo;
  const share = () => ({
    kicker: `Week ${week} · Win-win trades`,
    title: "🔁 Trades that should have happened",
    lines: trades.flatMap(t => [
      { text: `${t.team} ⇄ ${t.otherTeam} (${t.kind ? t.kind + ", " : ""}${basisTag(t.basis)})`, size: 26, color: "accent", weight: 800, gap: 24 },
      { text: `If they'd swapped ${t.fromWeek ? `back in Week ${t.fromWeek}` : "earlier this season"}:`, size: 21, gap: 6 },
      { text: `${t.team} gets ${players(t.getPlayers, t.getPlayer)}: ${wins(t.yourWinsAdded)}`, size: 23, color: "ink", gap: 4 },
      { text: `${t.otherTeam} gets ${players(t.givePlayers, t.givePlayer)}: ${wins(t.theirWinsAdded)}`, size: 23, color: "ink", gap: 4 }
    ]).concat([{ text: "Hindsight only: wins each team would have added by now, in optimal lineups or the lineups ESPN's projections would set. Not a promise about what happens next.", size: 19, gap: 26 }])
  });
  return (
    <section id="trades" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">THE TRADE MACHINE · IN HINDSIGHT</span><h2>Trades that should have happened</h2></div>
        <ShareButton section="trades" iconOnly label="Share the trades that should have happened" filename={`week-${week}-top-trades`} build={share} />
      </div>
      <p className="team-cards-intro">If these teams had swapped these players back then, both would be ahead today: the wins each would have added, replaying the weeks with optimal lineups or the lineups ESPN's projections would have set. Hindsight, not a promise about what happens next.</p>
      <div className="top-trades">
        {trades.map(t => <article className="top-trade" key={t.teamId + ":" + t.givePlayerId + ":" + t.getPlayerId}>
          <span className="top-trade-kind">{t.kind ? `${t.kind} · ` : ""}{basisTag(t.basis)}</span>
          <p className="top-trade-when">If they'd swapped {t.fromWeek ? `back in Week ${t.fromWeek}` : "earlier this season"}:</p>
          {[[t.team, t.teamId, t.getPlayers || [t.getPlayer], t.yourWinsAdded, t.yourBoost], [t.otherTeam, t.otherTeamId, t.givePlayers || [t.givePlayer], t.theirWinsAdded, t.theirBoost]]
            .map(([team, id, gets, w, boost]) => <div className="top-trade-side" key={id}>
              <strong><TeamLogo src={logoOf(id)} />{team}</strong>
              <span>would have gotten {gets.join(" + ")}</span>
              <b>{wins(w)} <small>({boost > 0 ? "+" : ""}{Math.round(boost)} pts)</small></b>
            </div>)}
        </article>)}
      </div>
    </section>
  );
}
