import React from "react";
import { money } from "../lib/data.js";
import { TeamLogo } from "./LiveBits.jsx";
import Podium from "./Podium.jsx";

// Ticket race: the three teams with the best odds of the week's top score
// (a raffle ticket). Once the week is final, the winner's step says so.
const MEDALS = ["🥇", "🥈", "🥉"];

export default function RafflePodium({ scores, logos, week, final }) {
  const top = [...scores]
    .filter(s => s.topScoreProbability != null)
    .sort((a, b) => Number(b.topScoreProbability) - Number(a.topScoreProbability) || Number(b.score) - Number(a.score))
    .slice(0, 3);
  if (top.length < 3) return null;
  return (
    <section id="ticket-race" className="section">
      <div className="section-heading"><div><span className="section-kicker">WEEK {week} · TOP SCORE WINS A RAFFLE TICKET</span><h2>Ticket race</h2></div></div>
      <Podium ariaLabel="Best odds of the week's top score" items={top.map((s, i) => ({
        key: s.teamId,
        logo: <TeamLogo src={logos[s.teamId]} size="md" />,
        name: s.team,
        value: s.topScoreProbability,
        label: final && i === 0 ? "🎟️ Ticket won" : money(s.topScoreProbability) + "%",
        sub: `${money(s.score)} pts${final ? "" : ` · proj ${s.projectionAverage != null ? money(s.projectionAverage) : "—"}`}`,
        icon: MEDALS[i]
      }))} />
    </section>
  );
}
