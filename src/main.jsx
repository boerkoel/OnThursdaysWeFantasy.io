import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import scoreboard from "../data/current/scoreboard.json";
import standingsData from "../data/current/standings.json";
import awards from "../data/current/awards.json";
import raffle from "../data/current/raffle.json";
import playoffs from "../data/current/playoffs.json";
import teamsData from "../data/current/teams.json";
import weekly from "../data/current/weekly.json";

const money = (n) => Number(n).toFixed(2);

const TeamLogo = ({ src, size = "sm" }) => src ? <img src={src} alt="" className={`inline-team-logo ${size}`} /> : null;

function TeamCards({ teams }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = teams.find(t => t.id === selectedId);

  const Profile = ({ team }) => (
    <article className="team-profile">
      <div className="profile-header">
        <div className="profile-identity">
          <div className="profile-logo-wrap"><img src={team.logo} alt="" className="profile-logo" /></div>
          <div>
            <span className="section-kicker">2026 TEAM PROFILE</span>
            <h3>{team.name.trim()}</h3>
            <p>{team.abbrev} · {team.standings.wins}-{team.standings.losses} · {team.standings.streak?.length ? (team.standings.streak.type === "W" ? "Win" : "Loss") + " streak: " + team.standings.streak.length : "No streak"}</p>
          </div>
        </div>
        <button className="profile-close" type="button" onClick={() => setSelectedId(null)}>×</button>
      </div>

      <div className="profile-metrics">
        <div><small>POINTS FOR</small><strong>{money(team.standings.pointsFor)}</strong></div>
        <div><small>POINTS AGAINST</small><strong>{money(team.standings.pointsAgainst)}</strong></div>
        <div><small>AVERAGE</small><strong>{money(team.standings.games ? team.standings.pointsFor / team.standings.games : 0)}</strong></div>
        <div><small>WIN %</small><strong>{money((team.standings.winPct || 0) * 100)}%</strong></div>
      </div>

      {team.playerAwards && (<div className="profile-awards">
        <div className="profile-awards-heading"><span className="section-kicker">PLAYER AWARDS</span><strong>Season So Far</strong></div>
        <div className="profile-award-grid">
          {team.playerAwards.mvp ? <div className="profile-award"><span>🏆</span><div><small>MVP</small><strong>{team.playerAwards.mvp.player}</strong><em>{money(team.playerAwards.mvp.points)} pts · #{team.playerAwards.mvp.seasonRank} overall</em></div></div> : null}
          {team.playerAwards.bestDraftValue ? <div className="profile-award"><span>💰</span><div><small>BEST DRAFT VALUE</small><strong>{team.playerAwards.bestDraftValue.player}</strong><em>Pick #{team.playerAwards.bestDraftValue.draftPick} · +{team.playerAwards.bestDraftValue.valueGap} value spots</em></div></div> : null}
          {team.playerAwards.worstDraftValue ? <div className="profile-award"><span>📉</span><div><small>WORST DRAFT VALUE</small><strong>{team.playerAwards.worstDraftValue.player}</strong><em>Pick #{team.playerAwards.worstDraftValue.draftPick} · {team.playerAwards.worstDraftValue.valueGap} value spots</em></div></div> : null}
          {team.playerAwards.boomMachine ? <div className="profile-award"><span>💥</span><div><small>BOOM MACHINE</small><strong>{team.playerAwards.boomMachine.player}</strong><em>{money(team.playerAwards.boomMachine.score)} pts · Week {team.playerAwards.boomMachine.week}</em></div></div> : null}
          {team.playerAwards.mostConsistent ? <div className="profile-award"><span>🎯</span><div><small>MOST CONSISTENT</small><strong>{team.playerAwards.mostConsistent.player}</strong><em>{money(team.playerAwards.mostConsistent.variance)} pt weekly SD</em></div></div> : null}
          {team.playerAwards.lateRoundWizard ? <div className="profile-award"><span>🧙</span><div><small>LATE-ROUND WIZARD</small><strong>{team.playerAwards.lateRoundWizard.player}</strong><em>Round {team.playerAwards.lateRoundWizard.round} · +{team.playerAwards.lateRoundWizard.valueGap} value spots</em></div></div> : null}
          {team.playerAwards.boomBust ? <div className="profile-award"><span>🎰</span><div><small>BOOM / BUST</small><strong>{team.playerAwards.boomBust.player}</strong><em>{money(team.playerAwards.boomBust.range)} pt range</em></div></div> : null}
        </div>
      </div>)}

      <div className="profile-history">
        <div className="profile-history-heading"><span className="section-kicker">GAME LOG</span><strong>Weekly Matchups</strong></div>
        {team.weeklyResults?.length ? team.weeklyResults.map(w => (
          <div className={w.result === "W" ? "profile-week win" : "profile-week loss"} key={w.week}>
            <span className="week-number">W{w.week}</span>
            <div><strong>{w.result}</strong><span>vs {w.opponent}</span></div>
            <strong>{money(w.score)}–{money(w.opponentScore)}</strong>
          </div>
        )) : <p className="profile-empty">No completed games yet.</p>}
      </div>
    </article>
  );

  return (
    <>
      <div className="team-card-grid">
        {teams.map((team, i) => {
          const s = team.standings || {};
          const avg = s.games ? s.pointsFor / s.games : 0;
          return (
            <div className="team-card-item" key={team.id}>
              <button className={selectedId === team.id ? "team-card selected" : "team-card"} type="button" aria-expanded={selectedId === team.id} onClick={() => setSelectedId(selectedId === team.id ? null : team.id)}>
                <div className="card-top"><span className="card-rank">#{i + 1}</span><span className="card-season">2026</span></div>
                <div className="card-logo-wrap"><img src={team.logo} alt="" className="team-logo" /></div>
                <h3>{team.name.trim()}</h3>
                <div className="card-record">{s.wins}-{s.losses} <span>·</span> {money(avg)} PPG</div>
                <div className="card-stats">
                  <span><small>PF</small><strong>{money(s.pointsFor)}</strong></span>
                  <span><small>PA</small><strong>{money(s.pointsAgainst)}</strong></span>
                  <span><small>STREAK</small><strong>{s.streak?.length ? s.streak.type + s.streak.length : "—"}</strong></span>
                </div>
                <div className="card-footer"><span>{selectedId === team.id ? "CLOSE PROFILE" : "VIEW PROFILE"}</span><span>↗</span></div>
              </button>
              {selectedId === team.id ? <div className="mobile-profile"><Profile team={team} /></div> : null}
            </div>
          );
        })}
      </div>

      {selected ? <div className="desktop-profile"><Profile team={selected} /></div> : null}
    </>
  );
}

function App() {
  const scores = scoreboard.scores || [];
  const median = scoreboard.median;
  const [scoreSort, setScoreSort] = useState("current");
  const sortedScores = [...scores].sort((a, b) => Number(b.score) - Number(a.score));
  const projectedSortScores = [...scores].sort((a, b) => {
    const aProjection = Number(a.projectionAverage);
    const bProjection = Number(b.projectionAverage);
    if (Number.isFinite(aProjection) && Number.isFinite(bProjection)) return bProjection - aProjection;
    if (Number.isFinite(aProjection)) return -1;
    if (Number.isFinite(bProjection)) return 1;
    return Number(b.score) - Number(a.score);
  });
  const displayScores = scoreSort === "projected" ? projectedSortScores : sortedScores;
  const preGame = scores.length > 0 && scores.every(s => Number(s.score) === 0 && Number(s.opponentScore) === 0);
  const currentWeekComplete = raffle.completedWeeks?.includes(scoreboard.week);
  const teamLogos = Object.fromEntries((teamsData.teams || []).map(t => [t.id, t.logo]));
  const totalRaffleTickets = (raffle.tickets || []).reduce((sum, t) => sum + Number(t.tickets || 0), 0);
  const completedHistoryWeeks = weekly.weeks || [];
  const [historyWeek, setHistoryWeek] = useState(completedHistoryWeeks.length ? completedHistoryWeeks[completedHistoryWeeks.length - 1].week : null);
  const history = completedHistoryWeeks.find(w => w.week === historyWeek);
  const historyTeamNames = Object.fromEntries((teamsData.teams || []).map(t => [t.id, t.name.trim()]));
  const historyMatchups = history?.matchups || [];
  const historyScores = historyMatchups.flatMap(m => [Number(m.homeScore || 0), Number(m.awayScore || 0)]).sort((a, b) => a - b);
  const historyAverage = historyScores.length ? historyScores.reduce((sum, score) => sum + score, 0) / historyScores.length : null;
  const historyMedian = historyScores.length ? (historyScores.length % 2 ? historyScores[Math.floor(historyScores.length / 2)] : (historyScores[historyScores.length / 2 - 1] + historyScores[historyScores.length / 2]) / 2) : null;

  const projectedMedian = Number(scoreboard.projectedMedian);
  const projectedWithScores = scores.filter(s => Number.isFinite(Number(s.projectionAverage)) && Number.isFinite(projectedMedian));
  const closestAbove = projectedWithScores
    .filter(s => Number(s.projectionAverage) >= projectedMedian)
    .sort((a, b) => Number(a.projectionAverage) - Number(b.projectionAverage))[0];
  const closestBelow = projectedWithScores
    .filter(s => Number(s.projectionAverage) < projectedMedian)
    .sort((a, b) => Number(b.projectionAverage) - Number(a.projectionAverage))[0];
  const projectedMedianEdgeTeams = new Set(
    [closestAbove?.teamId, closestBelow?.teamId].filter(Boolean)
  );

  return (
    <main className="site">
      <header className="topbar">
        <div>
          <p className="eyebrow">ON THURSDAYS WE WATCH FOOTBALL</p>
          <h1>On Thursdays We Fantasy</h1>
          <p className="subtitle">The Officially Unofficial League Record Book</p>
        </div>
        <nav><a href="#scores">Scores</a><a href="#history">History</a><a href="#playoffs">Playoffs</a><a href="#ultimate-loser">Ultimate Loser</a><a href="#raffle">Raffle</a><a href="#standings">Standings</a><a href="#awards">Awards</a></nav>
      </header>

<div className="data-timestamp">LAST REFRESHED <strong>{scoreboard.lastUpdated ? new Date(scoreboard.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</strong></div>

      <section className="hero-strip">
        <div><span className="section-kicker">2026 SEASON</span><h2>Week {scoreboard.week}</h2><p>{preGame ? "The Week is set. Scores will appear here once the games begin." : "The league is live. Here’s how everyone is doing."}</p></div>
        <div className="hero-stat"><strong>{scoreboard.projectedMedian != null ? money(scoreboard.projectedMedian) : "—"}</strong><span>Projected median</span></div>
      </section>

      <section id="scores" className="section">
        <div className="section-heading"><div><span className="section-kicker">RIGHT NOW</span><h2>Week {scoreboard.week} Scores</h2></div><span className="live-pill">{preGame ? "● NOT STARTED" : "● LIVE"}</span></div>
        <div className="matchups">
          {[...new Set(scores.map(s => s.matchupId))].map(matchupId => {
            const teams = scores.filter(s => s.matchupId === matchupId);
            const a = teams[0], b = teams[1];
            if (!a || !b) return null;
            return <article className="matchup" key={matchupId}>
              <div className={a.score >= b.score ? "team winning" : "team"}><span className="matchup-team-name"><TeamLogo src={teamLogos[a.teamId]} />{a.team}</span><strong className="score-value"><span className={projectedMedianEdgeTeams.has(a.teamId) ? "projection-dot yellow" : (Number.isFinite(Number(a.projectionAverage)) && Number.isFinite(projectedMedian) ? (Number(a.projectionAverage) >= projectedMedian ? "projection-dot green" : "projection-dot red") : "")} aria-hidden="true"></span>{money(a.score)}</strong><small>PROJ {a.projectionTrend === "up" ? <span className="projection-trend up" aria-label="Projection trending up">↑</span> : a.projectionTrend === "down" ? <span className="projection-trend down" aria-label="Projection trending down">↓</span> : null}{a.projectionAverage != null ? money(a.projectionAverage) : "—"}</small></div>
              <div className="versus">vs</div>
              <div className={b.score >= a.score ? "team winning" : "team"}><span className="matchup-team-name"><TeamLogo src={teamLogos[b.teamId]} />{b.team}</span><strong className="score-value"><span className={projectedMedianEdgeTeams.has(b.teamId) ? "projection-dot yellow" : (Number.isFinite(Number(b.projectionAverage)) && Number.isFinite(projectedMedian) ? (Number(b.projectionAverage) >= projectedMedian ? "projection-dot green" : "projection-dot red") : "")} aria-hidden="true"></span>{money(b.score)}</strong><small>PROJ {b.projectionTrend === "up" ? <span className="projection-trend up" aria-label="Projection trending up">↑</span> : b.projectionTrend === "down" ? <span className="projection-trend down" aria-label="Projection trending down">↓</span> : null}{b.projectionAverage != null ? money(b.projectionAverage) : "—"}</small></div>
            </article>;
          })}
        </div>
      </section>

      <section id="standings" className="section">
        <div className="section-heading"><div><span className="section-kicker">MEDIAN SCORING</span><h2>Week {scoreboard.week} Scoreboard</h2></div></div>
        <div className="score-list">
          <div className="score-sort-controls" role="group" aria-label="Sort scoreboard">
          <button className={scoreSort === "current" ? "active" : ""} onClick={() => setScoreSort("current")}>CURRENT SCORE</button>
          <button className={scoreSort === "projected" ? "active" : ""} onClick={() => setScoreSort("projected")}>PROJECTED SCORE</button>
        </div>
        {displayScores.map((s, i) => <React.Fragment key={s.teamId}>
            {i === Math.floor(displayScores.length / 2) && <div className="median-line"><span>MEDIAN {preGame ? "—" : money(median)}</span><span>PROJECTED MEDIAN {scoreboard.projectedMedian != null ? money(scoreboard.projectedMedian) : "—"}</span></div>}
            <div className="score-row"><span className="rank">{i + 1}</span><span className="score-team"><TeamLogo src={teamLogos[s.teamId]} />{s.team}{i === 0 && !preGame ? <em className="raffle-badge">🎟️ {currentWeekComplete ? "RAFFLE SPOT" : "CURRENT LEADER"}</em> : null}</span><span className="score-opponent">vs {s.opponent}</span><span className="score-projection">PROJ {s.projectionTrend === "up" ? <span className="projection-trend up" aria-hidden="true">↑</span> : s.projectionTrend === "down" ? <span className="projection-trend down" aria-hidden="true">↓</span> : null}{s.projectionAverage != null ? money(s.projectionAverage) : "—"}</span><strong>{money(s.score)}</strong></div>
          </React.Fragment>)}
        </div>
        <p className="median-note">{preGame ? "Current scores will appear once scoring begins. The projected median is based on ESPN’s projected final scores." : "The current median uses live scores. The projected median uses ESPN’s projected final scores."}</p>
      </section>

      <section id="history" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE SEASON SO FAR</span><h2>Weekly History</h2></div>
          <span className="record-count">{completedHistoryWeeks.length} WEEKS COMPLETE</span>
        </div>
        <div className="history-week-tabs" role="tablist" aria-label="Select completed week">
          {completedHistoryWeeks.map(w => <button key={w.week} className={historyWeek === w.week ? "active" : ""} type="button" onClick={() => setHistoryWeek(w.week)}>WEEK {w.week}</button>)}
        </div>
        {history ? <>
          <div className="history-summary">
            <div><small>LEAGUE AVERAGE</small><strong>{money(historyAverage)}</strong></div>
            <div><small>LEAGUE MEDIAN</small><strong>{money(historyMedian)}</strong></div>
            <div><small>HIGH SCORE</small><strong>{history.highestScore ? money(history.highestScore.score) + " · " + history.highestScore.team : "—"}</strong></div>
            <div><small>LARGEST BLOWOUT</small><strong>{history.largestBlowout ? money(history.largestBlowout.margin) + " pts" : "—"}</strong></div>
          </div>
          <div className="history-matchups">
            {historyMatchups.map(m => {
              const homeWon = m.winner === "HOME";
              const awayWon = m.winner === "AWAY";
              return <article className="history-matchup" key={m.id}>
                <div className={homeWon ? "history-team winner" : "history-team"}><span><TeamLogo src={teamLogos[m.homeTeamId]} />{historyTeamNames[m.homeTeamId] || "Unknown team"}</span><strong className={Number(m.homeScore) >= Number(historyMedian) ? "history-score above-median" : "history-score"}>{money(m.homeScore)}</strong>{Number(m.homeScore) >= Number(historyMedian) ? <em className="median-badge">ABOVE MEDIAN</em> : null}</div>
                <span className="history-vs">FINAL</span>
                <div className={awayWon ? "history-team winner" : "history-team"}><span><TeamLogo src={teamLogos[m.awayTeamId]} />{historyTeamNames[m.awayTeamId] || "Unknown team"}</span><strong className={Number(m.awayScore) >= Number(historyMedian) ? "history-score above-median" : "history-score"}>{money(m.awayScore)}</strong>{Number(m.awayScore) >= Number(historyMedian) ? <em className="median-badge">ABOVE MEDIAN</em> : null}</div>
              </article>;
            })}
          </div>
        </> : <p className="median-note">No completed weeks yet.</p>}
      </section>

      <section id="playoffs" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">ROAD TO THE TITLE</span><h2>2026 Playoffs</h2></div>
          <span className="record-count">{playoffs.status === "ACTIVE" ? "PLAYOFFS ACTIVE" : "PROJECTED FROM CURRENT STANDINGS"}</span>
        </div>
        <p className="playoff-intro">Six teams qualify. Seeding is based on total points scored, with the top two seeds receiving first-round byes. ESPN's playoff reseeding is reflected in the semifinal placeholders.</p>
        <div className="bracket">
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 15 · QUARTERFINALS</div>
            {playoffs.schedule.filter(g=>g.round==="Quarterfinal").map(g => {
              const home = playoffs.seeds.find(s=>s.seed===g.homeSeed);
              const away = playoffs.seeds.find(s=>s.seed===g.awaySeed);
              return <div className="bracket-game" key={g.id}>
                <div><small>{home ? "#" + home.seed : "TBD"}</small><strong>{home?.team || "TBD"}</strong></div>
                <span>vs</span>
                <div><small>{away ? "#" + away.seed : "TBD"}</small><strong>{away?.team || "TBD"}</strong></div>
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
          <div className="bracket-round championship-round">
            <div className="bracket-round-title championship-week-title">CHAMPIONSHIP WEEK</div>
            <div className="championship-payouts">
              <strong>1st: $375</strong>
              <strong>2nd: $225</strong>
              <strong>3rd: $100</strong>
            </div>
            <div className="bracket-round-title championship-match-title">WEEK 17 · CHAMPIONSHIP MATCH</div>
            <div className="bracket-game championship-game">
              <div><small>FINAL</small><strong>Semifinal Winner</strong></div>
              <span>vs</span>
              <div><small>FINAL</small><strong>Semifinal Winner</strong></div>
            </div>
            <div className="bracket-round-title third-place-title">WEEK 17 · THIRD PLACE</div>
            <div className="bracket-game third-place-game">
              <div><small>3RD PLACE</small><strong>Semifinal Loser</strong></div>
              <span>vs</span>
              <div><small>3RD PLACE</small><strong>Semifinal Loser</strong></div>
            </div>
          </div>
        </div>
        <div className="seed-board">
          {playoffs.seeds.map(s => <div className="seed-row" key={s.seed}><span>#{s.seed}</span><strong>{s.team}</strong><span>{s.wins}-{s.losses}</span><span>{money(s.pointsFor)} PF</span>{s.seed<=2 ? <em>BYE</em> : null}</div>)}
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

      <section id="teams" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE ROSTER ROOM</span><h2>Team Cards</h2></div>
          <span className="record-count">12 TEAMS · 2026</span>
        </div>
        <p className="team-cards-intro">Every manager gets a baseball-card-style snapshot of the season. Click a card to open the full team profile.</p>
        <TeamCards teams={teamsData.teams || []} />
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
        <p className="raffle-intro">Each week's highest-scoring team earns one entry into the end-of-season raffle for the $100 prize!</p>
        <div className="raffle-board">
          {raffle.tickets?.map((t, i) => <div className="raffle-row" key={t.teamId}>
            <span className="rank">{i + 1}</span>
            <span className="score-team">{t.team}</span>
            <span className="raffle-weeks">{t.winningWeeks?.length ? ("Won Week" + (t.winningWeeks.length > 1 ? "s " : " ") + t.winningWeeks.join(", ")) : "No tickets yet"}</span>
            <strong>{t.tickets} {t.tickets === 1 ? "ticket" : "tickets"}{totalRaffleTickets > 0 ? <em className="raffle-odds">{((Number(t.tickets) / totalRaffleTickets) * 100).toFixed(1)}% odds</em> : null}</strong>
          </div>)}
        </div>
      </section>

      <section className="section">
        <div className="section-heading"><div><span className="section-kicker">RECORD BOOK</span><h2>Standings</h2></div></div>
        <div className="standings-table">
          {standingsData.standings.map((t, i) => <div className="standing-row" key={t.id}><span>{i+1}</span><strong><TeamLogo src={teamLogos[t.id]} />{t.name}</strong><span>{t.wins}-{t.losses}</span><span>{money(t.pointsFor)} PF</span></div>)}
        </div>
      </section>
      <footer>On Thursdays We Fantasy · 2026 · Officially unofficial.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);