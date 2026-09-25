import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import scoreboard from "../data/current/scoreboard.json";
import standingsData from "../data/current/standings.json";
import awards from "../data/current/awards.json";

const money = (n) => Number(n).toFixed(2);

function App() {
  const scores = scoreboard.scores || [];
  const median = scoreboard.median;

  return (
    <main className="site">
      <header className="topbar">
        <div>
          <p className="eyebrow">ON THURSDAYS WE WATCH FOOTBALL</p>
          <h1>On Thursdays We Fantasy</h1>
          <p className="subtitle">The Officially Unofficial League Record Book</p>
        </div>
        <nav><a href="#scores">Scores</a><a href="#standings">Standings</a><a href="#awards">Awards</a></nav>
      </header>

      <section className="hero-strip">
        <div><span className="section-kicker">2026 SEASON</span><h2>Week {scoreboard.week}</h2><p>The league is live. Here’s how everyone is doing.</p></div>
        <div className="hero-stat"><strong>{money(median)}</strong><span>Current median score</span></div>
      </section>

      <section id="scores" className="section">
        <div className="section-heading"><div><span className="section-kicker">RIGHT NOW</span><h2>Week {scoreboard.week} Scores</h2></div><span className="live-pill">● LIVE</span></div>
        <div className="matchups">
          {Array.from({length: Math.ceil(scores.length / 2)}, (_, i) => {
            const matchupId = scores[i * 2]?.matchupId;
            const teams = scores.filter(s => s.matchupId === matchupId);
            const a = teams[0], b = teams[1];
            if (!a || !b) return null;
            return <article className="matchup" key={matchupId}>
              <div className={a.score >= b.score ? "team winning" : "team"}><span>{a.team}</span><strong>{money(a.score)}</strong></div>
              <div className="versus">vs</div>
              <div className={b.score >= a.score ? "team winning" : "team"}><span>{b.team}</span><strong>{money(b.score)}</strong></div>
            </article>;
          })}
        </div>
      </section>

      <section id="standings" className="section">
        <div className="section-heading"><div><span className="section-kicker">MEDIAN SCORING</span><h2>Week {scoreboard.week} Scoreboard</h2></div></div>
        <div className="score-list">
          {scores.map((s, i) => <React.Fragment key={s.teamId}>
            {i === Math.floor(scores.length / 2) && <div className="median-line"><span>MEDIAN {money(median)}</span></div>}
            <div className="score-row"><span className="rank">{i + 1}</span><span className="score-team">{s.team}</span><span className="score-opponent">vs {s.opponent}</span><strong>{money(s.score)}</strong></div>
          </React.Fragment>)}
        </div>
        <p className="median-note">The line marks the median of the 12 current scores. In your median-scoring format, six teams are above it and six are below it.</p>
      </section>

      <section id="awards" className="section">
        <div className="section-heading"><div><span className="section-kicker">THE GOOD STUFF</span><h2>League Awards</h2></div></div>
        <div className="award-grid">
          <article><span>💔</span><small>HEARTBREAK AWARD</small><strong>{awards.highestScoringLoser?.team || "—"}</strong><p>{awards.highestScoringLoser ? \`${money(awards.highestScoringLoser.score)} points in a loss\` : "—"}</p></article>
          <article><span>💥</span><small>BLOWOUT KING</small><strong>{awards.blowoutKing?.winner || "—"}</strong><p>{awards.blowoutKing ? \`${money(awards.blowoutKing.margin)}-point margin\` : "—"}</p></article>
          <article><span>🪑</span><small>BENCH WARMER CHAMPION</small><strong>{awards.benchWarmerChampion?.team || "—"}</strong><p>{awards.benchWarmerChampion ? \`${money(awards.benchWarmerChampion.points)} points on the bench\` : "—"}</p></article>
        </div>
      </section>

      <section className="section">
        <div className="section-heading"><div><span className="section-kicker">RECORD BOOK</span><h2>Standings</h2></div></div>
        <div className="standings-table">
          {standingsData.standings.map((t, i) => <div className="standing-row" key={t.id}><span>{i+1}</span><strong>{t.name}</strong><span>{t.wins}-{t.losses}</span><span>{money(t.pointsFor)} PF</span></div>)}
        </div>
      </section>
      <footer>On Thursdays We Fantasy · 2026 · Officially unofficial.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);