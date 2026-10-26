import React, { useState } from "react";
import { TeamLogo } from "./LiveBits.jsx";

// Report cards (scripts/report-cards.js): every manager graded on a curve
// against the league, this season (by category), last week and all-time.
const PARTS = [
  ["scoring", "Scoring", "Points per week"],
  ["startSit", "Start/sit", "Points scored ÷ the best lineup you could have set"],
  ["draft", "Draft", "Points per week started from players you drafted"],
  ["waivers", "Waivers", "Points per week started from pickups"],
  ["trades", "Trades", "Points per week started from players acquired by trade. No trades while a win-win swap existed (see Trades) marks a team down by the wins passed up, scaled by need: a playoff lock stays at C+, a team out of it gets a D or F"],
  ["record", "Record", "Win % (head-to-head + median)"]
];
const tone = g => !g ? "" : g.startsWith("A") ? "g-a" : g.startsWith("B") ? "g-b" : g.startsWith("C") ? "g-c" : "g-d";
// Sorting: letters best first, no grade last.
const LETTERS = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const rank = g => g ? LETTERS.indexOf(g) : 99;
const Grade = ({ g, big = false, title }) => <span className={`grade ${tone(g)}${big ? " big" : ""}`} title={title}>{g || "—"}</span>;

export default function ReportCards({ cards, logos = {} }) {
  const [open, setOpen] = useState(null);
  const [sortKey, setSortKey] = useState("season");
  if (!cards?.season?.length) return null;
  const allTime = new Map((cards.allTime || []).map(a => [a.teamId, a]));
  const parts = PARTS.filter(([k]) => cards.season.some(s => s.parts?.[k]));
  const keyOf = {
    team: s => s.team, season: s => -s.score,
    last: s => { const w = s.weekly[s.weekly.length - 1]; return w ? -w.score : 1; },
    allTime: s => { const a = allTime.get(s.teamId); return a ? -a.score : 1; }
  };
  const sortVal = s => keyOf[sortKey] ? keyOf[sortKey](s) : rank(s.parts?.[sortKey]?.grade);
  const rows = [...cards.season].sort((a, b) => { const x = sortVal(a), y = sortVal(b);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) || b.score - a.score; });
  const head = (k, label, tip) => <button type="button" key={k} title={tip} className={"rc-sort" + (sortKey === k ? " active" : "")} onClick={() => setSortKey(k)}>{label}</button>;
  return (
    <section id="report-cards" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">THROUGH WEEK {cards.throughWeek} · GRADED ON A CURVE</span><h2>Report cards</h2></div>
      </div>
      <div className="report-cards">
        <div className="rc-row head">
          {head("team", "Team")}{head("season", "Season", "Season grade")}
          {parts.map(([k, label, tip]) => head(k, label, tip))}
          {head("last", "Last wk", "Last week's grade")}{head("allTime", "All-time", "All-time grade (record book)")}
        </div>
        {rows.map(s => {
          const last = s.weekly[s.weekly.length - 1];
          const at = allTime.get(s.teamId);
          return <React.Fragment key={s.teamId}>
            <button type="button" className={"rc-row" + (open === s.teamId ? " open" : "")} onClick={() => setOpen(open === s.teamId ? null : s.teamId)} aria-expanded={open === s.teamId}>
              <strong><TeamLogo src={logos[s.teamId]} /><span>{s.team}</span></strong>
              <Grade g={s.grade} big />
              {parts.map(([k]) => <Grade key={k} g={s.parts[k]?.grade} title={s.parts[k]?.label} />)}
              <Grade g={last?.grade} title={last ? `Week ${last.week}: ${last.points} pts, ${last.efficiency}% of the best lineup` : undefined} />
              <Grade g={at?.grade} title={at ? `${at.seasons} seasons, ${at.winPct}% wins, ${at.titles} title${at.titles === 1 ? "" : "s"}` : undefined} />
            </button>
            {open === s.teamId ? <div className="rc-detail">
              <ul>
                {parts.map(([k, label]) => { const p = s.parts[k]; return p ? <li key={k}><Grade g={p.grade} /> <b>{label}</b> · {p.value != null && p.value !== 0 ? `${p.value} ${p.label || ""}` : p.label}
                  {p.pointsLeft ? ` · ${p.pointsLeft} pts left on the bench` : ""}
                  {p.top?.length ? ` · led by ${p.top.map(x => `${x.player} (${x.points})`).join(", ")}` : ""}</li> : null; })}
                {s.luck != null ? <li><b>Luck</b> · {s.luck > 0 ? "+" : ""}{s.luck} wins vs what their scores would earn against everyone (not graded)</li> : null}
              </ul>
              <p className="rc-weeks">Week by week: {s.weekly.map(w => <span key={w.week} title={`${w.points} pts, ${w.efficiency}% of the best lineup${w.lostToMistake ? ", a loss a better lineup would have won" : ""}`}>W{w.week} <Grade g={w.grade} /></span>)}</p>
              {at ? <p className="rc-weeks">All-time: {at.seasons} seasons, {at.winPct}% wins, {at.playoffs} playoff trips, {at.titles} title{at.titles === 1 ? "" : "s"}.</p> : null}
            </div> : null}
          </React.Fragment>;
        })}
      </div>
      <p className="median-note">Grades are on a curve against the league: roughly the top two earn A's, the bottom two D's or an F. Season: {cards.weights?.season}. Week: {cards.weights?.weekly}. All-time: {cards.weights?.allTime}. Tap a column to sort, a team for the details.</p>
    </section>
  );
}
