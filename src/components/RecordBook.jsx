import React, { useState } from "react";
import { money } from "../lib/data.js";
import { managerLabel, recordBook, rivalryBetween } from "../lib/recordBook.js";

const possessive = name => name + (name.endsWith("s") ? "'" : "'s");

// Pick any two managers to see their all-time series; plus the most
// lopsided and closest rivalries (3+ meetings).
function Rivalries() {
  const rivalries = recordBook?.rivalries || [];
  const managers = Object.keys(recordBook?.managerLabels || {}).sort((x, y) => managerLabel(x).localeCompare(managerLabel(y)));
  const mostPlayed = [...rivalries].sort((x, y) => y.games - x.games)[0];
  const [pick, setPick] = useState(mostPlayed ? [mostPlayed.a, mostPlayed.b] : [managers[0], managers[1]]);
  if (!rivalries.length) return null;
  const series = rivalryBetween(pick[0], pick[1]);
  const regular = rivalries.filter(r => r.games >= 3);
  const lopsided = [...regular].sort((x, y) => Math.abs(y.aWins - y.bWins) / y.games - Math.abs(x.aWins - x.bWins) / x.games || y.games - x.games).slice(0, 3);
  const closest = [...regular].sort((x, y) => Math.abs(x.aWins - x.bWins) - Math.abs(y.aWins - y.bWins) || Math.abs(x.aPoints - x.bPoints) - Math.abs(y.aPoints - y.bPoints)).slice(0, 3);
  const leaderLine = r => {
    const [lead, trail, lw, tw] = r.aWins >= r.bWins ? [r.a, r.b, r.aWins, r.bWins] : [r.b, r.a, r.bWins, r.aWins];
    return lw === tw ? `${managerLabel(r.a)} vs ${managerLabel(r.b)}: tied ${lw}–${tw}` : `${managerLabel(lead)} over ${managerLabel(trail)}, ${lw}–${tw}`;
  };
  const choose = (i, value) => setPick(p => (i === 0 ? [value, p[1]] : [p[0], value]));
  return (
    <details className="collapsible" id="rivalries">
      <summary>Head-to-head rivalries <span>{rivalries.length} matchups</span></summary>
      <div className="rivalry-panel">
        <div className="rivalry-picker">
          <select value={pick[0]} onChange={e => choose(0, e.target.value)} aria-label="First manager">
            {managers.map(m => <option key={m} value={m}>{managerLabel(m)}</option>)}
          </select>
          <span>vs</span>
          <select value={pick[1]} onChange={e => choose(1, e.target.value)} aria-label="Second manager">
            {managers.map(m => <option key={m} value={m}>{managerLabel(m)}</option>)}
          </select>
        </div>
        {series ? <div className="rivalry-summary">
          <div className="rivalry-score">
            <div><strong>{series.aWins}</strong><span>{managerLabel(series.a)}</span></div>
            <em>{series.ties ? `${series.ties} tie${series.ties > 1 ? "s" : ""}` : "wins"}</em>
            <div><strong>{series.bWins}</strong><span>{managerLabel(series.b)}</span></div>
          </div>
          <p>{series.games} meetings{series.playoffMeetings ? ` (${series.playoffMeetings} in the playoffs)` : ""} · average score {money(series.aPoints / series.games)}–{money(series.bPoints / series.games)}</p>
          <p>Last met {series.lastMeeting.season} Week {series.lastMeeting.week}: {money(series.lastMeeting.aScore)}–{money(series.lastMeeting.bScore)}{series.streak?.length >= 2 ? ` · ${managerLabel(series.streak.manager)} has won ${series.streak.length} straight` : ""}</p>
          <p>{[series.biggestWin.a && `${possessive(managerLabel(series.a))} biggest win: by ${money(series.biggestWin.a.margin)} (${series.biggestWin.a.season} W${series.biggestWin.a.week})`, series.biggestWin.b && `${possessive(managerLabel(series.b))}: by ${money(series.biggestWin.b.margin)} (${series.biggestWin.b.season} W${series.biggestWin.b.week})`].filter(Boolean).join(" · ")}</p>
        </div> : <p className="median-note">{pick[0] === pick[1] ? "Pick two different managers." : "These two have never played each other."}</p>}
        {regular.length ? <div className="rivalry-lists">
          <div><small>MOST LOPSIDED</small><ol>{lopsided.map(r => <li key={r.a + r.b}>{leaderLine(r)}</li>)}</ol></div>
          <div><small>CLOSEST RIVALRIES</small><ol>{closest.map(r => <li key={r.a + r.b}>{leaderLine(r)}</li>)}</ol></div>
        </div> : null}
      </div>
    </details>
  );
}

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

      <Rivalries />

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
