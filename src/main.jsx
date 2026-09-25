import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import scoreboard from "../data/current/scoreboard.json";
import standingsData from "../data/current/standings.json";
import awards from "../data/current/awards.json";
import raffle from "../data/current/raffle.json";
import playoffs from "../data/current/playoffs.json";

const money = (n) => Number(n).toFixed(2);

function App() {
  const scores = scoreboard.scores || [];
  const median = scoreboard.median;
  const preGame = scores.length > 0 && scores.every(s => Number(s.score) === 0 && Number(s.opponentScore) === 0);
  const currentWeekComplete = raffle.completedWeeks?.includes(scoreboard.week);

  return (
    <main className="site">
      <header className="topbar">
        <div>
          <p className="eyebrow">ON THURSDAYS WE WATCH FOOTBALL</p>
          <h1>On Thursdays We Fantasy</h1>
          <p className="subtitle">The Officially Unofficial League Record Book</p>
        </div>
        <nav><a href="#scores">Scores</a><a href="#playoffs">Playoffs</a><a href="#ultimate-loser">Ultimate Loser</a><a href="#raffle">Raffle</a><a href="#standings">Standings</a><a href="#awards">Awards</a></nav>
      </header>

      <section className="hero-strip">
        <div><span className="section-kicker">2026 SEASON</span><h2>Week {scoreboard.week}</h2><p>{preGame ? "The Week is set. Scores will appear here once the games begin." : "The league is live. Here’s how everyone is doing."}</p></div>
        <div className="hero-stat"><strong>{preGame ? "—" : money(median)}</strong><span>{preGame ? "Games not started" : "Current median score"}</span></div>
      </section>

      <section id="scores" className="section">
        <div className="section-heading"><div><span className="section-kicker">RIGHT NOW</span><h2>Week {scoreboard.week} Scores</h2></div><span className="live-pill">{preGame ? "● NOT STARTED" : "● LIVE"}</span></div>
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
            {i === Math.floor(scores.length / 2) && <div className="median-line"><span>MEDIAN {preGame ? "—" : money(median)}</span></div>}
            <div className="score-row"><span className="rank">{i + 1}</span><span className="score-team">{s.team}{i === 0 && !preGame ? <em className="raffle-badge">🎟️ {currentWeekComplete ? "RAFFLE SPOT" : "CURRENT LEADER"}</em> : null}</span><span className="score-opponent">vs {s.opponent}</span><strong>{money(s.score)}</strong></div>
          </React.Fragment>)}
        </div>
        <p className="median-note">{preGame ? "The median will appear once scoring begins. In your median-scoring format, six teams score above the median and six below it." : "The line marks the median of the 12 current scores. In your median-scoring format, six teams are above it and six are below it."}</p>
      </section>

      <section id="playoffs" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">ROAD TO THE TITLE</span><h2>2026 Playoffs</h2></div>
          <span className="record-count">{playoffs.status === "ACTIVE" ? "PLAYOFFS ACTIVE" : "PROJECTED FROM CURRENT STANDINGS"}</span>
        </div>
        <p className="playoff-intro">Six teams qualify. Seeding is based on total points scored, with the top two seeds receiving first-round byes. ESPN's playoff reseeding is reflected in the semifinal placeholders.</p>
        <div className="prize-board"><div><span>RAFFLE</span><strong>$100</strong></div><div><span>1ST</span><strong>$375</strong></div><div><span>2ND</span><strong>$225</strong></div><div><span>3RD</span><strong>$100</strong></div></div>
        <div className="bracket">
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 15 · QUARTERFINALS</div>
            {playoffs.schedule.filter(g=>g.round==="Quarterfinal").map(g => {
              const home = playoffs.seeds.find(s=>s.seed===g.homeSeed);
              const away = playoffs.seeds.find(s=>s.seed===g.awaySeed);
              return <div className="bracket-game" key={g.id}>
                <div><small>{home ? "#" + home.regularSeasonSeed : "TBD"}</small><strong>{home?.team || "TBD"}</strong></div>
                <span>vs</span>
                <div><small>{away ? "#" + away.regularSeasonSeed : "TBD"}</small><strong>{away?.team || "TBD"}</strong></div>
              </div>;
            })}
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 16 · SEMIFINALS</div>
            {playoffs.schedule.filter(g=>g.round==="Semifinal").map(g => <div className="bracket-game" key={g.id}>
              <div><small>#{g.homeSeed}</small><strong>{g.homeTeam || "TBD"}</strong></div>
              <span>vs</span>
              <div><small>RESEED</small><strong>Lowest remaining seed</strong></div>
            </div>)}
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 17 · THIRD PLACE</div>
            <div className="bracket-game">
              <div><small>3RD PLACE</small><strong>Semifinal Loser</strong></div>
              <span>vs</span>
              <div><small>3RD PLACE</small><strong>Semifinal Loser</strong></div>
            </div>
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 17 · CHAMPIONSHIP</div>
            <div className="bracket-game championship-game">
              <div><small>FINAL</small><strong>Semifinal Winner</strong></div>
              <span>vs</span>
              <div><small>FINAL</small><strong>Semifinal Winner</strong></div>
            </div>
          </div>
        </div>
        <div className="seed-board">
          {playoffs.seeds.map(s => <div className="seed-row" key={s.seed}><span>#{s.regularSeasonSeed || s.playoffSeed}</span><strong>{s.team}</strong><span>{s.wins}-{s.losses}</span><span>{money(s.pointsFor)} PF</span>{s.seed<=2 ? <em>BYE</em> : null}</div>)}
        </div>
      </section>

      <section id="ultimate-loser" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE OTHER ROAD</span><h2>Ultimate Loser</h2></div>
          <span className="record-count">WEEKS 16–18 · 8 TEAMS</span>
        </div>
        <p className="playoff-intro">Three weeks. Single elimination. The lower-scoring team advances. Six regular-season non-playoff teams enter first, then the two Week 15 playoff losers join them.</p>
        <div className="bracket">
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 16 · QUARTERFINALS</div>
            {playoffs.ultimateLoser?.schedule.filter(g=>g.round==="Quarterfinal").map(g => {
              const home = playoffs.ultimateLoser.entrants.find(s=>s.seed===g.homeSeed);
              const away = playoffs.ultimateLoser.entrants.find(s=>s.seed===g.awaySeed);
              return <div className="bracket-game" key={g.id}>
                <div><small>#{g.homeSeed}</small><strong>{home?.team || "TBD"}</strong></div>
                <span>LOWER SCORE ADVANCES</span>
                <div><small>#{g.awaySeed}</small><strong>{away?.team || "TBD"}</strong></div>
              </div>;
            })}
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 17 · SEMIFINALS</div>
            {playoffs.ultimateLoser?.schedule.filter(g=>g.round==="Semifinal").map(g => <div className="bracket-game" key={g.id}>
              <div><small>QF</small><strong>Loser advances</strong></div>
              <span>LOWER SCORE ADVANCES</span>
              <div><small>QF</small><strong>Loser advances</strong></div>
            </div>)}
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 18 · ULTIMATE LOSER CHAMPIONSHIP</div>
            <div className="bracket-game championship-game">
              <div><small>FINALISTS</small><strong>Semifinal Loser-Advance</strong></div>
              <span>LOWER SCORE ADVANCES</span>
              <div><small>FINALISTS</small><strong>Semifinal Loser-Advance</strong></div>
            </div>
          </div>
        </div>
        <div className="seed-board">
          {(playoffs.ultimateLoser?.entrants || []).map(s => <div className="seed-row" key={s.seed}>
            <span>#{s.seed}</span><strong>{s.team}</strong>
            <span>{s.source==="REGULAR_SEASON" ? "REG SEED" : "W15 LOSER"}</span>
            <span>{s.pointsFor != null ? money(s.pointsFor) + " PF" : "TBD"}</span>
          </div>)}
        </div>
      </section>

      <section id="awards" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE GOOD STUFF</span><h2>League Awards</h2></div>
          <span className="record-count">THROUGH WEEK {awards.currentWeek}</span>
        </div>
        <div className="award-grid">
          <article className="award-card"><span>💔</span><small>HEARTBREAK AWARD</small><strong>{awards.awards?.highestScoringLoser?.team || "—"}</strong><p>{awards.awards?.highestScoringLoser ? `${money(awards.awards.highestScoringLoser.score)} points in a loss · Week ${awards.awards.highestScoringLoser.week}` : "—"}</p></article>
          <article className="award-card"><span>💥</span><small>BLOWOUT KING</small><strong>{awards.awards?.blowoutKing?.winner || "—"}</strong><p>{awards.awards?.blowoutKing ? `${money(awards.awards.blowoutKing.margin)}-point margin · Week ${awards.awards.blowoutKing.week}` : "—"}</p></article>
          <article className="award-card"><span>🪑</span><small>BENCH WARMER CHAMPION</small><strong>{awards.awards?.benchWarmerChampion?.team || "—"}</strong><p>{awards.awards?.benchWarmerChampion ? `${money(awards.awards.benchWarmerChampion.points)} points on the bench · Week ${awards.awards.benchWarmerChampion.week}` : "—"}</p></article>
          <article className="award-card"><span>🔥</span><small>HIGHEST SCORE</small><strong>{awards.awards?.highestScore?.team || "—"}</strong><p>{awards.awards?.highestScore ? `${money(awards.awards.highestScore.score)} points · Week ${awards.awards.highestScore.week}` : "—"}</p></article>
          <article className="award-card"><span>🫠</span><small>LOWEST SCORE</small><strong>{awards.awards?.lowestScore?.team || "—"}</strong><p>{awards.awards?.lowestScore ? `${money(awards.awards.lowestScore.score)} points · Week ${awards.awards.lowestScore.week}` : "—"}</p></article>
          <article className="award-card"><span>🥴</span><small>BAD BEAT</small><strong>{awards.awards?.lowestScoringWinner?.team || "—"}</strong><p>{awards.awards?.lowestScoringWinner ? `${money(awards.awards.lowestScoringWinner.score)} points in a win · Week ${awards.awards.lowestScoringWinner.week}` : "—"}</p></article>
          <article className="award-card"><span>🤝</span><small>THE NEGOTIATOR</small><strong>{awards.awards?.negotiator?.team || "—"}</strong><p>{awards.awards?.negotiator?.trades ? awards.awards.negotiator.trades + " trades" : "No completed trades yet"}</p></article>
          <article className="award-card"><span>🛒</span><small>GET A LIFE</small><strong>{awards.awards?.getALife?.team || "—"}</strong><p>{awards.awards?.getALife?.moves ? awards.awards.getALife.moves + " roster moves" : "No roster activity yet"}</p></article>
          <article className="award-card"><span>🔥</span><small>HEATING UP</small><strong>{awards.awards?.heatingUp?.team || "—"}</strong><p>{awards.awards?.heatingUp ? "Trend +" + money(awards.awards.heatingUp.slope) + " pts/week" : "Need more completed weeks"}</p></article>
          <article className="award-card"><span>🧊</span><small>COOLING OFF</small><strong>{awards.awards?.coolingOff?.team || "—"}</strong><p>{awards.awards?.coolingOff ? "Trend " + money(awards.awards.coolingOff.slope) + " pts/week" : "Need more completed weeks"}</p></article>
          <article className="award-card"><span>🍀</span><small>THE LUCK BOX</small><strong>{awards.awards?.luckBox?.team || "—"}</strong><p>{awards.awards?.luckBox ? "+" + money(awards.awards.luckBox.luck) + " wins vs expected" : "Need more completed weeks"}</p></article>
          <article className="award-card"><span>😭</span><small>UNLUCKIEST</small><strong>{awards.awards?.unluckiest?.team || "—"}</strong><p>{awards.awards?.unluckiest ? money(awards.awards.unluckiest.luck) + " wins vs expected" : "Need more completed weeks"}</p></article>
        </div>
      </section>

      <section className="section" id="raffle">
        <div className="section-heading">
          <div><span className="section-kicker">SEASON RAFFLE</span><h2>Raffle Tickets</h2></div>
          <span className="record-count">{raffle.completedWeeks?.length || 0} TICKET WEEKS COMPLETE</span>
        </div>
        <p className="raffle-intro">Each week's highest-scoring team earns one entry into the end-of-season prize raffle.</p>
        <div className="raffle-board">
          {raffle.tickets?.map((t, i) => <div className="raffle-row" key={t.teamId}>
            <span className="rank">{i + 1}</span>
            <span className="score-team">{t.team}</span>
            <span className="raffle-weeks">{t.winningWeeks?.length ? ("Won Week" + (t.winningWeeks.length > 1 ? "s " : " ") + t.winningWeeks.join(", ")) : "No tickets yet"}</span>
            <strong>{t.tickets} {t.tickets === 1 ? "ticket" : "tickets"}</strong>
          </div>)}
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