import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import metadata from "../data/current/metadata.json";
import standingsData from "../data/current/standings.json";
import awards from "../data/current/awards.json";
import raffle from "../data/current/raffle.json";
import playoffs from "../data/current/playoffs.json";
import teamsData from "../data/current/teams.json";
import weekly from "../data/current/weekly.json";
import { fetchData, gameState, money, useLiveData } from "./lib/data.js";
import { TeamLogo, UpdatedAgo, useChangedScores } from "./components/LiveBits.jsx";
import LeagueWire from "./components/LeagueWire.jsx";
import TeamCards from "./components/TeamCards.jsx";
import { DeathWatch } from "./components/DeathWatch.jsx";

// One matchup box in a bracket.
function BracketGame({ top, bottom, className = "" }) {
  return (
    <div className={("bracket-game " + className).trim()}>
      <div><small>{top.label}</small><strong>{top.team}</strong></div>
      <div><small>{bottom.label}</small><strong>{bottom.team}</strong></div>
    </div>
  );
}
const pairs = list => list.reduce((out, item, i) => (i % 2 ? out[out.length - 1].push(item) : out.push([item]), out), []);

// One side of a live matchup card.
function MatchupTeam({ team, opponent, logo, projected, flashing, dotClass }) {
  const trend = team.projectionTrend === "up" ? <span className="projection-trend up" aria-label="Projection trending up">↑</span>
    : team.projectionTrend === "down" ? <span className="projection-trend down" aria-label="Projection trending down">↓</span> : null;
  return (
    <div className={team.score >= opponent.score ? "team winning" : "team"}>
      <span className="matchup-team-name"><TeamLogo src={logo} />{team.team}</span>
      <strong className={["score-value", projected ? "projected-score" : "", flashing ? "score-flash" : ""].join(" ").trim()}>
        <span className={dotClass} aria-hidden="true"></span>{money(projected ? team.projectionAverage : team.score)}
      </strong>
      {projected ? <span className="actual-score-muted">{money(team.score)} ACT</span> : null}
      <small>PROJ {trend}{team.projectionAverage != null ? money(team.projectionAverage) : "—"}{team.winProbability != null ? <em className="matchup-probability">WIN {money(team.winProbability)}%</em> : null}</small>
    </div>
  );
}

function App() {
  const live = useLiveData();
  const { scoreboard, guillotine } = live;
  const livePlayFeed = live.livePlays;
  const scores = scoreboard.scores || [];
  const [scoreSort, setScoreSort] = useState("current");
  const status = gameState(scoreboard);
  const flashingScores = useChangedScores(scores);
  // A matchup shows its 5 most recent 4+ point swings from the last 5 hours.
  const KEY_PLAY_MAX_AGE_MS = 5 * 60 * 60 * 1000;
  const keyPlaysFor = matchupId => (livePlayFeed.plays || [])
    .filter(p => Number(p.matchupId) === Number(matchupId) && Math.abs(Number(p.points)) >= 4)
    .filter(p => p.wallclock && Date.now() - Date.parse(p.wallclock) <= KEY_PLAY_MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.wallclock) - Date.parse(a.wallclock))
    .slice(0, 5);

  // Standings, teams, awards, etc. are bundled and only change with the daily
  // ESPN update, so reload the page when that update's timestamp changes.
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const latest = await fetchData("metadata.json");
        if (metadata.fetchedAt && latest.fetchedAt && latest.fetchedAt !== metadata.fetchedAt) {
          try { sessionStorage.setItem("preserveScrollY", String(window.scrollY)); } catch {}
          window.location.reload();
        }
      } catch {}
    };
    const timer = setInterval(checkForUpdates, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const y = sessionStorage.getItem("preserveScrollY");
    if (y != null) {
      sessionStorage.removeItem("preserveScrollY");
      requestAnimationFrame(() => window.scrollTo(0, Number(y)));
    }
  }, []);
  const sortedScores = [...scores].sort((a, b) => Number(b.score) - Number(a.score));
  const projectedSortScores = [...scores].sort((a, b) => {
    const aProjection = Number(a.projectionAverage);
    const bProjection = Number(b.projectionAverage);
    if (Number.isFinite(aProjection) && Number.isFinite(bProjection)) return bProjection - aProjection;
    if (Number.isFinite(aProjection)) return -1;
    if (Number.isFinite(bProjection)) return 1;
    return Number(b.score) - Number(a.score);
  });
  const oddsSortScores = [...scores].sort((a, b) => Number(b.aboveMedianProbability ?? -1) - Number(a.aboveMedianProbability ?? -1) || Number(b.score) - Number(a.score));
  const displayScores = scoreSort === "projected" ? projectedSortScores : scoreSort === "odds" ? oddsSortScores : sortedScores;
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

  // "Near median" comes from the scoreboard data: the teams just above and just
  // below the projected median, plus any with 30-70% odds of finishing above it.
  const NEAR_MEDIAN_MIN = 30;
  const NEAR_MEDIAN_MAX = 70;
  const aboveMedianOdds = s => s.aboveMedianProbability == null ? null : Number(s.aboveMedianProbability);
  // Older snapshots predate the nearMedian flag; fall back to the odds band.
  const hasNearMedianFlag = scores.some(s => "nearMedian" in s);
  const projectedMedianEdgeTeams = new Set(scores
    .filter(s => hasNearMedianFlag ? s.nearMedian : aboveMedianOdds(s) >= NEAR_MEDIAN_MIN && aboveMedianOdds(s) <= NEAR_MEDIAN_MAX)
    .map(s => s.teamId));
  const medianDotClass = s => {
    const odds = aboveMedianOdds(s);
    if (odds == null) return "";
    if (projectedMedianEdgeTeams.has(s.teamId)) return "projection-dot yellow";
    return odds > 50 ? "projection-dot green" : "projection-dot red";
  };

  return (
    <main className="site">
      <header className="topbar">
        <div>
          <p className="eyebrow">ON THURSDAYS WE WATCH FOOTBALL</p>
          <h1>On Thursdays We Fantasy</h1>
          <p className="subtitle">The Officially Unofficial League Record Book</p>
        </div>
        <nav><a href="#scores">Scores</a><a href="#history">History</a><a href="#death-watch">Death Watch</a><a href="#playoffs">Playoffs</a><a href="#ultimate-loser">Ultimate Loser</a><a href="#raffle">Raffle</a><a href="#standings">Standings</a><a href="#awards">Awards</a></nav>
      </header>

      <div className="data-timestamp">LAST REFRESHED <strong>{scoreboard.lastUpdated ? new Date(scoreboard.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</strong> <UpdatedAgo iso={scoreboard.lastUpdated} /></div>


      <section className="hero-strip">
        <div className="hero-main"><span className="section-kicker">2026 SEASON</span><h2>Week {scoreboard.week}</h2><p>{status === "NOT STARTED" ? "The week is set. Scores will appear here once the games begin."
          : status === "LIVE" ? "The league is live. Here’s how everyone is doing."
          : status === "FINAL" ? "Every game is final. Here’s how the week shook out."
          : "Between games. Here’s where everyone stands."}</p></div>
        <div className="hero-stat"><strong>{scoreboard.projectedMedian != null ? money(scoreboard.projectedMedian) : "—"}</strong><span>Projected median</span></div>
      </section>

      <LeagueWire stories={live.marquee.stories || []} status={status} />

      <section id="scores" className="section">
        <div className="section-heading"><div><span className="section-kicker">RIGHT NOW</span><h2>Week {scoreboard.week} Scores</h2></div><span className={status === "LIVE" ? "live-pill is-live" : "live-pill"}>● {status}</span></div>
        <div className="matchups">
          {[...new Set(scores.map(s => s.matchupId))].map(matchupId => {
            const teams = scores.filter(s => s.matchupId === matchupId);
            const a = teams[0], b = teams[1];
            if (!a || !b) return null;
            return <article className="matchup" key={matchupId}>
              <MatchupTeam team={a} opponent={b} logo={teamLogos[a.teamId]} projected={scoreSort === "projected"} flashing={flashingScores.has(a.teamId)} dotClass={medianDotClass(a)} />
              <div className="versus">vs</div>
              <MatchupTeam team={b} opponent={a} logo={teamLogos[b.teamId]} projected={scoreSort === "projected"} flashing={flashingScores.has(b.teamId)} dotClass={medianDotClass(b)} />
              {keyPlaysFor(matchupId).length ? (
                <div className="key-plays" aria-label="Key plays">
                  <div className="key-plays-heading"><span>KEY PLAYS</span><em>4+ PT SWINGS</em></div>
                  <div className="key-play-list">
                    {keyPlaysFor(matchupId).map(play => (
                      <div className="key-play" key={play.id}>
                        <strong className={play.points < 0 ? "negative" : ""}>{play.points > 0 ? "+" : ""}{money(play.points)}</strong>
                        <span><b>{play.player}</b> {play.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
          <button className={scoreSort === "odds" ? "active" : ""} onClick={() => setScoreSort("odds")}>ODDS</button>
        </div>
        {displayScores.map((s, i) => <React.Fragment key={s.teamId}>
            {i === Math.floor(displayScores.length / 2) && <div className="median-line"><span>PROJECTED MEDIAN {scoreboard.projectedMedian != null ? money(scoreboard.projectedMedian) : "—"}</span></div>}
            <div className={projectedMedianEdgeTeams.has(s.teamId) ? "score-row median-near" : "score-row"}><span className="rank">{i + 1}</span><span className="score-team"><TeamLogo src={teamLogos[s.teamId]} />{s.team}{projectedMedianEdgeTeams.has(s.teamId) ? <em className="median-near-label">NEAR MEDIAN</em> : null}{i === 0 && !preGame ? <em className="raffle-badge">🎟️ {currentWeekComplete ? "RAFFLE SPOT" : "CURRENT LEADER"}</em> : null}</span><span className="score-opponent">vs {s.opponent}</span><strong className={["score-primary", scoreSort === "projected" ? "projected-score" : "", flashingScores.has(s.teamId) ? "score-flash" : ""].join(" ").trim()}>{money(scoreSort === "projected" ? s.projectionAverage : s.score)}</strong><span className="score-projection">{scoreSort === "projected" ? "ACT " + money(s.score) : "PROJ "}{scoreSort === "projected" ? "" : (s.projectionTrend === "up" ? "↑ " : s.projectionTrend === "down" ? "↓ " : "")}{scoreSort === "projected" ? "" : (s.projectionAverage != null ? money(s.projectionAverage) : "—")}<em className="score-probability">ABOVE MEDIAN {s.aboveMedianProbability != null ? money(s.aboveMedianProbability) : "—"}%</em></span></div>
          </React.Fragment>)}
        </div>
        <p className="median-note">The projected median is based on ESPN’s projected final scores. Odds of finishing above the median come from simulating the rest of the week, where the league median moves with every team’s result. Highlighted in yellow: the teams projected just above and just below the median, plus any team with a {NEAR_MEDIAN_MIN}–{NEAR_MEDIAN_MAX}% chance.</p>
      </section>


      <DeathWatch guillotine={guillotine} />

      <section id="history" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE SEASON SO FAR</span><h2>Weekly History</h2></div>
          <span className="record-count">{completedHistoryWeeks.length} WEEKS COMPLETE</span>
        </div>
        <div className="history-week-tabs" role="tablist" aria-label="Select completed week">
          {completedHistoryWeeks.map(w => <button key={w.week} className={historyWeek === w.week ? "active" : ""} type="button" onClick={() => setHistoryWeek(w.week)}>WEEK {w.week}</button>)}
        </div>
        {history ? <>
          {history.recap?.length ? <div className="weekly-recap">
            <div className="weekly-recap-heading"><span className="section-kicker">WEEKLY RECAP</span><strong>The stories that mattered</strong></div>
            <div className="weekly-recap-grid">
              {history.recap.map((story, i) => <article className="weekly-recap-tile" key={story.type + i}>
                <small>{story.type}</small>
                <p>{story.text}</p>
              </article>)}
            </div>
          </div> : null}
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
              const homeScore = Number(m.homeScore);
              const awayScore = Number(m.awayScore);
              const homeMedianClass = homeScore > Number(historyMedian) ? "above-median" : homeScore < Number(historyMedian) ? "below-median" : "at-median";
              const awayMedianClass = awayScore > Number(historyMedian) ? "above-median" : awayScore < Number(historyMedian) ? "below-median" : "at-median";
              return <article className="history-matchup" key={m.id}>
                <div className={homeWon ? "history-team winner" : "history-team"}>
                  <span className="history-team-name"><TeamLogo src={teamLogos[m.homeTeamId]} />{historyTeamNames[m.homeTeamId] || "Unknown team"}</span>
                  <div className="history-score-block"><strong className={`history-score ${homeMedianClass}`}>{money(m.homeScore)}</strong><em className="median-badge">{homeMedianClass === "above-median" ? "ABOVE MEDIAN" : homeMedianClass === "below-median" ? "BELOW MEDIAN" : "AT MEDIAN"}</em>{homeWon ? <em className="winner-badge">WINNER</em> : null}</div>
                </div>
                <span className="history-vs">FINAL</span>
                <div className={awayWon ? "history-team winner" : "history-team"}>
                  <span className="history-team-name"><TeamLogo src={teamLogos[m.awayTeamId]} />{historyTeamNames[m.awayTeamId] || "Unknown team"}</span>
                  <div className="history-score-block"><strong className={`history-score ${awayMedianClass}`}>{money(m.awayScore)}</strong><em className="median-badge">{awayMedianClass === "above-median" ? "ABOVE MEDIAN" : awayMedianClass === "below-median" ? "BELOW MEDIAN" : "AT MEDIAN"}</em>{awayWon ? <em className="winner-badge">WINNER</em> : null}</div>
                </div>
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
        <p className="playoff-intro">Six teams qualify. Seeding is based on total points scored, with the top two seeds receiving first-round byes. Teams are reseeded after the quarterfinals: the #1 seed plays the lowest remaining seed (dashed lines).</p>
        <div className="bracket">
          <div className="bracket-round reseed-next">
            <div className="bracket-round-title">WEEK 15 · QUARTERFINALS</div>
            <div className="bracket-games">
              {playoffs.schedule.filter(g => g.round === "Quarterfinal").map(g => {
                const home = playoffs.seeds.find(s => s.seed === g.homeSeed);
                const away = playoffs.seeds.find(s => s.seed === g.awaySeed);
                return <BracketGame key={g.id}
                  top={{ label: home ? "#" + home.seed : "TBD", team: home?.team || "TBD" }}
                  bottom={{ label: away ? "#" + away.seed : "TBD", team: away?.team || "TBD" }} />;
              })}
            </div>
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 16 · SEMIFINALS</div>
            <div className="bracket-games">
              <div className="bracket-pair">
                {playoffs.schedule.filter(g => g.round === "Semifinal").map(g => <BracketGame key={g.id}
                  top={{ label: "#" + g.homeSeed + " · BYE", team: g.homeTeam || "TBD" }}
                  bottom={g.awayTeam
                    ? { label: "#" + g.awaySeed, team: g.awayTeam }
                    : { label: "RESEED", team: g.homeSeed === 1 ? "Lowest remaining seed" : "Highest remaining seed" }} />)}
              </div>
            </div>
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 17 · CHAMPIONSHIP</div>
            <div className="bracket-games">
              <BracketGame className="championship-game" top={{ label: "SF WINNER", team: "Semifinal winner" }} bottom={{ label: "SF WINNER", team: "Semifinal winner" }} />
            </div>
          </div>
        </div>
        <div className="bracket-footer">
          <div>
            <div className="bracket-round-title">WEEK 17 · THIRD PLACE</div>
            <BracketGame top={{ label: "SF LOSER", team: "Semifinal loser" }} bottom={{ label: "SF LOSER", team: "Semifinal loser" }} />
          </div>
          <div className="championship-payouts">
            <strong>1st: $375</strong>
            <strong>2nd: $225</strong>
            <strong>3rd: $100</strong>
          </div>
        </div>
        <div className="seed-board">
          {playoffs.seeds.map(s => <div className="seed-row" key={s.seed}><span>{"#" + s.seed}</span><strong>{s.team}</strong><span>{s.wins}-{s.losses}</span><span>{money(s.pointsFor)} PF</span>{s.seed<=2 ? <em>BYE</em> : null}</div>)}
        </div>
      </section>

      <section id="ultimate-loser" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE OTHER ROAD</span><h2>Ultimate Loser</h2></div>
          <span className="record-count">WEEKS 16–18 · 8 TEAMS</span>
        </div>
        <p className="playoff-intro">Three weeks. Eight-team single elimination. The lower-scoring team advances, and teams are reseeded after the quarterfinals (dashed lines). The six regular-season non-playoff teams are seeded 1–6, followed by the lower-ranked Week 15 playoff loser at #7 and the higher-ranked Week 15 playoff loser at #8.</p>
        <div className="bracket">
          <div className="bracket-round reseed-next">
            <div className="bracket-round-title">WEEK 16 · QUARTERFINALS · LOSER ADVANCES</div>
            <div className="bracket-games">
              {pairs((playoffs.ultimateLoser?.schedule || []).filter(g => g.round === "Quarterfinal")).map((pair, p) => <div className="bracket-pair" key={p}>
                {pair.map(g => {
                  const home = playoffs.ultimateLoser.entrants.find(s => s.seed === g.homeSeed);
                  const away = playoffs.ultimateLoser.entrants.find(s => s.seed === g.awaySeed);
                  return <BracketGame key={g.id} top={{ label: "#" + g.homeSeed, team: home?.team || "TBD" }} bottom={{ label: "#" + g.awaySeed, team: away?.team || "TBD" }} />;
                })}
              </div>)}
            </div>
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 17 · SEMIFINALS · LOSER ADVANCES</div>
            <div className="bracket-games">
              <div className="bracket-pair">
                {(playoffs.ultimateLoser?.schedule || []).filter(g => g.round === "Semifinal").length
                  ? playoffs.ultimateLoser.schedule.filter(g => g.round === "Semifinal").map(g => <BracketGame key={g.id}
                      top={{ label: g.reseeded ? "RESEEDED" : "QF", team: g.homeTeam || "QF loser" }}
                      bottom={{ label: g.reseeded ? "RESEEDED" : "QF", team: g.awayTeam || "QF loser" }} />)
                  : [1, 2].map(i => <BracketGame key={i} top={{ label: "RESEED", team: "QF loser" }} bottom={{ label: "RESEED", team: "QF loser" }} />)}
              </div>
            </div>
          </div>
          <div className="bracket-round">
            <div className="bracket-round-title">WEEK 18 · ULTIMATE LOSER</div>
            <div className="bracket-games">
              <div className="bracket-final">
                <BracketGame className="championship-game" top={{ label: "FINALIST", team: "SF loser" }} bottom={{ label: "FINALIST", team: "SF loser" }} />
                <small className="bracket-final-label">LOWER SCORE IS THE ULTIMATE LOSER</small>
              </div>
            </div>
          </div>
        </div>
        <div className="seed-board">
          {(playoffs.ultimateLoser?.entrants || []).map(s => <div className="seed-row" key={s.seed}>
            <span>{"#" + s.seed}</span>
            <strong>{s.team}</strong>
            <span>{s.source==="REGULAR_SEASON" ? "REG SEED #" + s.regularSeasonSeed : s.seed === 7 ? "W15 (LOWER RANKED) LOSER" : "W15 (HIGHER RANKED) LOSER"}</span>
            <span>{s.pointsFor != null ? money(s.pointsFor) + " PF" : "TBD"}</span>
          </div>)}
        </div>
      </section>

      <section id="teams" className="section">
        <div className="section-heading">
          <div><span className="section-kicker">THE ROSTER ROOM</span><h2>Team Cards</h2></div>
          <span className="record-count">{(teamsData.teams || []).length} TEAMS · 2026</span>
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
          <article className="award-card"><span>🪑</span><small>BENCH WARMER CHAMPION</small><strong>{awards.awards?.benchWarmerChampion?.team || "—"}</strong><p>{awards.awards?.benchWarmerChampion ? `${money(awards.awards.benchWarmerChampion.points)} points on the bench · Season total` : "—"}</p></article>
          <article className="award-card"><span>🔥</span><small>HIGHEST SCORE</small><strong>{awards.awards?.highestScore?.team || "—"}</strong><p>{awards.awards?.highestScore ? `${money(awards.awards.highestScore.score)} points · Week ${awards.awards.highestScore.week}` : "—"}</p></article>
          <article className="award-card"><span>🫠</span><small>LOWEST SCORE</small><strong>{awards.awards?.lowestScore?.team || "—"}</strong><p>{awards.awards?.lowestScore ? `${money(awards.awards.lowestScore.score)} points · Week ${awards.awards.lowestScore.week}` : "—"}</p></article>
          <article className="award-card"><span>🥴</span><small>BAD BEAT</small><strong>{awards.awards?.highestScoringLoser?.team || "—"}</strong><p>{awards.awards?.highestScoringLoser ? `${money(awards.awards.highestScoringLoser.score)} points in a loss · Week ${awards.awards.highestScoringLoser.week}` : "—"}</p></article>
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
          {standingsData.standings.map((t, i) => <div className="standing-row" key={t.id}><span>{i+1}</span><strong><TeamLogo src={teamLogos[t.id]} />{t.name}</strong><span>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ""}</span><span>{money(t.pointsFor)} PF</span></div>)}
        </div>
      </section>
      <footer>On Thursdays We Fantasy · 2026 · Officially unofficial.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);