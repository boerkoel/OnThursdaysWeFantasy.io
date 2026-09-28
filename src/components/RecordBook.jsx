import React from "react";
import { money } from "../lib/data.js";

// All-time record book (build-record-book.js). Loaded only if the file exists,
// so the site builds before the first daily update creates it.
const books = import.meta.glob("../../data/current/record-book.json", { eager: true, import: "default" });
const recordBook = Object.values(books)[0] || null;

const gameLine = g => `${money(g.score)}–${money(g.opponentScore)} vs ${g.opponent} · ${g.season} W${g.week}${g.playoff ? " (playoffs)" : ""}`;

function RecordCard({ icon, title, entries, headline, detail }) {
  if (!entries?.length) return null;
  const [first, ...rest] = entries;
  return (
    <article className="award-card record-card">
      <span>{icon}</span>
      <small>{title}</small>
      <strong>{headline(first)}</strong>
      <p>{detail(first)}</p>
      {rest.length ? <ol className="record-runners-up">{rest.map((e, i) => <li key={i}>{headline(e)} · {detail(e)}</li>)}</ol> : null}
    </article>
  );
}

export default function RecordBook() {
  if (!recordBook) return null;
  const { champions = [], managers = [], gameRecords = {}, seasonRecords = {}, seasons = [] } = recordBook;
  const pastSeasons = seasons.filter(s => s !== recordBook.currentSeason);
  return (
    <section id="record-book" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">SINCE {seasons[0] || recordBook.currentSeason}</span><h2>All-Time Record Book</h2></div>
        <span className="record-count">{seasons.length} SEASONS · THROUGH {recordBook.currentSeason} WEEK {recordBook.throughWeek}</span>
      </div>
      {!pastSeasons.length ? <p className="median-note">Past seasons load with the next daily ESPN update; until then this covers {recordBook.currentSeason} only.</p> : null}

      {champions.length ? <div className="champion-row">
        {champions.map(c => <article className="champion-card" key={c.season}>
          <small>{c.season}</small>
          <strong>🏆 {c.champion?.team || "—"}</strong>
          {c.runnerUp ? <span>Runner-up: {c.runnerUp.team}</span> : null}
          {c.lastPlace ? <span>Last place: {c.lastPlace.team}</span> : null}
        </article>)}
      </div> : null}

      <h3 className="survival-heading">All-time standings</h3>
      <p className="median-note">Regular-season head-to-head records, by manager (labeled with their current team name).</p>
      <div className="survival-table">
        <div className="alltime-row survival-header"><span>#</span><span>Manager</span><span>Seasons</span><span>W-L</span><span>Win %</span><span>Titles</span><span>Playoffs</span><span>Avg</span></div>
        {managers.map((m, i) => <div className="alltime-row" key={m.manager + i}>
          <span>{i + 1}</span>
          <strong><span>{m.manager}</span></strong>
          <span>{m.seasons}</span>
          <span>{m.wins}-{m.losses}{m.ties ? `-${m.ties}` : ""}</span>
          <span>{money(m.winPct)}%</span>
          <b>{m.titles ? "🏆".repeat(m.titles) : "—"}</b>
          <span>{m.playoffAppearances}</span>
          <span>{money(m.averageScore)}</span>
        </div>)}
      </div>

      <h3 className="survival-heading">Records</h3>
      <div className="award-grid">
        <RecordCard icon="🔥" title="HIGHEST SCORE" entries={gameRecords.highestScores} headline={g => g.team} detail={gameLine} />
        <RecordCard icon="🫠" title="LOWEST SCORE" entries={gameRecords.lowestScores} headline={g => g.team} detail={gameLine} />
        <RecordCard icon="💥" title="BIGGEST BLOWOUT" entries={gameRecords.biggestBlowouts} headline={g => `${g.team} by ${money(g.margin)}`} detail={gameLine} />
        <RecordCard icon="😬" title="CLOSEST GAME" entries={gameRecords.closestGames} headline={g => `${g.team} by ${money(g.margin)}`} detail={gameLine} />
        <RecordCard icon="💔" title="HIGHEST LOSING SCORE" entries={gameRecords.highestLosingScores} headline={g => g.team} detail={gameLine} />
        <RecordCard icon="📈" title="MOST POINTS IN A SEASON" entries={seasonRecords.mostPoints} headline={s => s.team} detail={s => `${money(s.pointsFor)} pts · ${s.wins}-${s.losses} · ${s.season}`} />
        <RecordCard icon="🥇" title="BEST REGULAR SEASON" entries={seasonRecords.bestRecords} headline={s => s.team} detail={s => `${s.wins}-${s.losses} · ${money(s.pointsFor)} pts · ${s.season}`} />
        <RecordCard icon="🪫" title="FEWEST POINTS IN A SEASON" entries={seasonRecords.fewestPoints} headline={s => s.team} detail={s => `${money(s.pointsFor)} pts · ${s.wins}-${s.losses} · ${s.season}`} />
      </div>
    </section>
  );
}
