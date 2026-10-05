import React from "react";
import { money } from "../lib/data.js";
import { TeamLogo } from "./LiveBits.jsx";

// Ticket race: the three teams with the best odds of the week's top score
// (a raffle ticket), on an Olympic podium: 1st in the middle, 2nd left,
// 3rd right. Once the week is final, the winner's step says so.
const PLACES = [
  { rank: 1, medal: "🥇", className: "first" },
  { rank: 0, medal: "🥈", className: "second" },
  { rank: 2, medal: "🥉", className: "third" }
];

export default function RafflePodium({ scores, logos, week, final }) {
  const top = [...scores]
    .filter(s => s.topScoreProbability != null)
    .sort((a, b) => Number(b.topScoreProbability) - Number(a.topScoreProbability) || Number(b.score) - Number(a.score))
    .slice(0, 3);
  if (top.length < 3) return null;
  const ordered = [top[1], top[0], top[2]];
  return (
    <section id="ticket-race" className="section">
      <div className="section-heading"><div><span className="section-kicker">WEEK {week} · TOP SCORE WINS A RAFFLE TICKET</span><h2>Ticket race</h2></div></div>
      <div className="podium" role="list" aria-label="Best odds of the week's top score">
        {ordered.map((s, i) => {
          const place = [PLACES[1], PLACES[0], PLACES[2]][i];
          const won = final && s === top[0];
          return <div className={"podium-spot " + place.className} role="listitem" key={s.teamId}>
            <div className="podium-team">
              <TeamLogo src={logos[s.teamId]} size="md" />
              <b>{s.team}</b>
              <em>{won ? "🎟️ Ticket won" : money(s.topScoreProbability) + "%"}</em>
              <small>{money(s.score)} pts{final ? "" : ` · proj ${s.projectionAverage != null ? money(s.projectionAverage) : "—"}`}</small>
            </div>
            <div className="podium-step"><span>{place.medal}</span></div>
          </div>;
        })}
      </div>
    </section>
  );
}
