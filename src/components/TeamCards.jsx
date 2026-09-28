import React, { useEffect, useState } from "react";
import { money } from "../lib/data.js";

function TeamProfile({ team, onClose }) {
  return (
    <article className="team-profile">
      <div className="profile-header">
        <div className="profile-identity">
          <div className="profile-logo-wrap"><img src={team.logo} alt="" className="profile-logo" /></div>
          <div>
            <span className="section-kicker">2026 TEAM PROFILE</span>
            <h3>{team.name.trim()}</h3>
            <p>{team.abbrev} · {team.standings.wins}-{team.standings.losses}{team.standings.ties ? `-${team.standings.ties}` : ""} · {team.standings.streak?.length ? (team.standings.streak.type === "W" ? "Win" : "Loss") + " streak: " + team.standings.streak.length : "No streak"}</p>
          </div>
        </div>
        <button className="profile-close" type="button" onClick={onClose}>×</button>
      </div>

      <div className="profile-metrics">
        <div><small>POINTS FOR</small><strong>{money(team.standings.pointsFor)}</strong></div>
        <div><small>POINTS AGAINST</small><strong>{money(team.standings.pointsAgainst)}</strong></div>
        <div><small>AVERAGE</small><strong>{money(team.standings.games ? team.standings.pointsFor / team.standings.games : 0)}</strong></div>
        <div><small>WIN %</small><strong>{money((team.standings.winPct || 0) * 100)}%</strong></div>
      </div>

      {team.startSit?.score != null ? (<div className="profile-startsit">
        <div className="profile-startsit-heading">
          <div><span className="section-kicker">LINEUP EFFICIENCY</span><strong>{money(team.startSit.score)}%</strong></div>
          <span>{money(team.startSit.pointsLeft)} pts left on bench</span>
        </div>
        <div className="profile-startsit-bar"><span style={{width: Math.max(0, Math.min(100, Number(team.startSit.score))) + "%"}}></span></div>
        <div className="profile-startsit-summary"><span>Actual <strong>{money(team.startSit.actualPoints)}</strong></span><span>Optimal <strong>{money(team.startSit.optimalPoints)}</strong></span><span>Wins lost to mistakes <strong>{team.startSit.winsLost ?? 0}</strong></span></div>
        <div className="profile-startsit-weeks">
          {team.startSit.weeks.map(w => <span key={w.week}>W{w.week} <strong>{money(w.efficiency)}%</strong></span>)}
        </div>
      </div>) : null}

      {team.profileAnalytics?.positionFit ? (<div className="profile-roster-fit">
        <div className="profile-roster-fit-heading"><span className="section-kicker">ROSTER COMPOSITION</span><strong>Strengths & Weaknesses</strong></div>
        <div className="position-fit-grid">
          <div><small>STRENGTHS</small><div className="position-fit-list">
            {team.profileAnalytics.positionFit.strengths.length
              ? team.profileAnalytics.positionFit.strengths.map(p => <span className="position-fit strength" key={p.position}><b>{p.position}</b><strong>{Math.abs(p.percent)}% more pts than league avg.</strong></span>)
              : <span className="position-fit-empty">No standout strength</span>}
          </div></div>
          <div><small>WEAKNESSES</small><div className="position-fit-list">
            {team.profileAnalytics.positionFit.needs.length
              ? team.profileAnalytics.positionFit.needs.map(p => <span className="position-fit weakness" key={p.position}><b>{p.position}</b><strong>{Math.abs(p.percent)}% fewer pts than league avg.</strong></span>)
              : <span className="position-fit-empty">No obvious need</span>}
          </div></div>
        </div>
        <p className="profile-fit-note">Based on average scoring through completed weeks. League average is calculated across all teams.</p>
      </div>) : null}

      {team.profileAnalytics?.rosterFit ? (<div className="trade-section">
        <div className="trade-section-heading"><span>🤝</span><div><small>TRADE DESK</small><strong>Potential Trade Partners</strong><em>Teams with complementary strengths and weaknesses</em></div></div>
        <div className="trade-partner-list">
          {team.profileAnalytics.rosterFit.partners?.length
            ? team.profileAnalytics.rosterFit.partners.map(p => <div className="trade-partner" key={p.teamId}>
                <strong>{p.team}</strong>
                <span>They need {p.give?.map(x => x.position).join(" / ")} · You need {p.get?.map(x => x.position).join(" / ")}</span>
              </div>)
            : <span className="position-fit-empty">No obvious complementary trade partner yet.</span>}
        </div>
        {team.profileAnalytics.rosterFit.targets?.length ? <>
          <div className="trade-section-heading trade-target-heading"><span>🎯</span><div><small>PLAYERS TO TARGET</small><strong>Potential Trade Targets</strong><em>League-wide: players currently riding another team's bench who would have helped your lineup</em></div></div>
          <div className="trade-target-list">
            {team.profileAnalytics.rosterFit.targets.map(p => <div className="trade-target" key={p.teamId + "-" + p.playerId}>
              <div className="trade-target-info">
                <strong>{p.player}{p.position ? `, ${p.position}` : ""}</strong>
                <span>{p.team} has only started {p.startRate}% of the time</span>
                <span>Needs: {p.otherNeeds?.length ? p.otherNeeds.map(x => x.position).join(" / ") : "None"}</span>
              </div>
              <div className="trade-target-impact">
                <b>+{money(p.boost)} pts</b>
                <em>Optimal lineup improvement</em>
                <em>{(p.winsAdded ?? 0)} total wins added ({p.h2hWinsAdded ?? 0} H2H + {p.medianWinsAdded ?? 0} median)</em>{p.mutualTrade ? <em className="trade-mutual">↔ {p.mutualTrade.player} has been on your bench {p.mutualTrade.startRate != null ? (100 - p.mutualTrade.startRate) : 0}% of the time and would improve their optimal lineup by {money(p.mutualTrade.boost)} pts and {p.mutualTrade.winsAdded ?? 0} wins</em> : null}
              </div>
            </div>)}
          </div>
        </> : null}
        {team.profileAnalytics.winWinTrades?.length ? <>
          <div className="trade-section-heading trade-target-heading"><span>🤝</span><div><small>1-FOR-1 WIN-WIN TRADES</small><strong>Trades That Help Both Teams</strong><em>Historical simulation through completed weeks · each side gains a win, or 5+ optimal-lineup pts per week without losing one</em></div></div>
          <div className="trade-target-list">
            {team.profileAnalytics.winWinTrades.map((t, i) => <div className="trade-target win-win-trade" key={t.otherTeamId + "-" + t.givePlayerId + "-" + t.getPlayerId + "-" + i}>
              <div className="trade-target-info">
                <strong>Give {t.givePlayer}{t.givePosition ? `, ${t.givePosition}` : ""} <small>ROS #{t.giveRosRank}</small></strong>
                <span>Get {t.getPlayer}{t.getPosition ? `, ${t.getPosition}` : ""} <small>ROS #{t.getRosRank}</small> from {t.otherTeam}</span>
              </div>
              <div className="trade-target-impact">
                <b>Your historical optimal lineup: +{money(t.yourBoost)} pts</b>
                <em>With {t.getPlayer} in your lineup all season, you would have gained {t.yourWinsAdded} wins ({t.yourH2hWinsAdded} H2H + {t.yourMedianWinsAdded} median)</em>
                <em>{t.otherTeam}: +{money(t.theirBoost)} historical optimal-lineup pts · {t.theirWinsAdded} wins ({t.theirH2hWinsAdded} H2H + {t.theirMedianWinsAdded} median)</em>
              </div>
            </div>)}
          </div>
        </> : null}
      </div>) : null}

      {team.profileAnalytics?.waiverTargets ? (<div className="trade-section">
        <div className="trade-section-heading"><span>📋</span><div><small>WAIVER WIRE</small><strong>Waiver Targets</strong><em>Available players who would have added wins · best possible lineup with vs. without them, weeks they were unrostered</em></div></div>
        {team.profileAnalytics.waiverTargets.length ? <div className="trade-target-list">
          {team.profileAnalytics.waiverTargets.map(p => <div className="trade-target" key={p.playerId}>
            <div className="trade-target-info">
              <strong>{p.player}{p.position ? `, ${p.position}` : ""}</strong>
              <span>{p.weeks.map(w => `W${w.week}: ${money(w.points)} pts`).join(" · ")}</span>
            </div>
            <div className="trade-target-impact">
              <b>+{money(p.boost)} pts</b>
              <em>{p.winsAdded} {p.winsAdded === 1 ? "win" : "wins"} added ({p.h2hWinsAdded} H2H + {p.medianWinsAdded} median)</em>
            </div>
          </div>)}
        </div> : <span className="position-fit-empty">No available player would have added a win so far.</span>}
      </div>) : null}

      {team.profileAnalytics ? (<div className="profile-insights">
        <div className="profile-insights-heading"><span className="section-kicker">TEAM PULSE</span><strong>Season So Far</strong></div>
        <div className="profile-insight-grid">
          <div className="profile-insight">
            <span className="profile-insight-icon">🎯</span>
            <div><small>OPTIMAL LINEUP</small><strong>{team.profileAnalytics.optimalLineup ? `${money(team.profileAnalytics.optimalLineup.pointsLeft)} pts left on bench` : "—"}</strong><em>{team.profileAnalytics.optimalLineup ? `${money(team.profileAnalytics.optimalLineup.efficiency)}% lineup efficiency · ${money(team.profileAnalytics.optimalLineup.optimalPoints)} optimal pts` : "No completed weeks yet."}</em></div>
          </div>
          <div className="profile-insight">
            <span className="profile-insight-icon">{team.profileAnalytics.trend?.direction === "up" ? "🔥" : team.profileAnalytics.trend?.direction === "down" ? "❄️" : "➡️"}</span>
            <div><small>{team.profileAnalytics.trend?.direction === "up" ? "HEATING UP" : team.profileAnalytics.trend?.direction === "down" ? "COOLING OFF" : "TRENDING STEADY"}</small><strong>{team.profileAnalytics.trend ? `${team.profileAnalytics.trend.slope > 0 ? "+" : ""}${money(team.profileAnalytics.trend.slope)} pts/week` : "—"}</strong><em>{team.profileAnalytics.trend ? `Last ${team.profileAnalytics.trend.weeks.length} weeks · ${team.profileAnalytics.trend.scores.map(s => money(s)).join(" → ")}` : "No completed weeks yet."}</em></div>
          </div>
          <div className="profile-insight">
            <span className="profile-insight-icon">{(team.profileAnalytics.luck?.difference || 0) > 0.2 ? "🍀" : (team.profileAnalytics.luck?.difference || 0) < -0.2 ? "💀" : "⚖️"}</span>
            <div><small>LUCK METER</small><strong>{team.profileAnalytics.luck ? `${team.profileAnalytics.luck.difference >= 0 ? "+" : ""}${money(team.profileAnalytics.luck.difference)} wins` : "—"}</strong><em>{team.profileAnalytics.luck ? `${money(team.profileAnalytics.luck.actualWins)} actual · ${money(team.profileAnalytics.luck.expectedWins)} expected` : "No completed weeks yet."}</em></div>
          </div>
        </div>
      </div>) : null}

      {team.playerAwards && (<div className="profile-awards">
        <div className="profile-awards-heading"><span className="section-kicker">PLAYER AWARDS</span><strong>Season So Far</strong></div>
        <div className="profile-award-grid">
          {team.playerAwards.mvp ? <div className="profile-award"><span>🏆</span><div><small>MVP</small><strong>{team.playerAwards.mvp.player}</strong><em>{money(team.playerAwards.mvp.points)} starter pts · #{team.playerAwards.mvp.seasonRank} on team</em></div></div> : null}
          {team.playerAwards.bestDraftValue ? <div className="profile-award"><span>💰</span><div><small>BEST DRAFT VALUE</small><strong>{team.playerAwards.bestDraftValue.player}</strong><em>Drafted #{team.playerAwards.bestDraftValue.draftPick} → ROS #{team.playerAwards.bestDraftValue.rosRank} · +{team.playerAwards.bestDraftValue.valueGap} spots</em></div></div> : null}
          {team.playerAwards.worstDraftValue ? <div className="profile-award"><span>📉</span><div><small>WORST DRAFT VALUE</small><strong>{team.playerAwards.worstDraftValue.player}</strong><em>Drafted #{team.playerAwards.worstDraftValue.draftPick} → ROS #{team.playerAwards.worstDraftValue.rosRank} · {team.playerAwards.worstDraftValue.valueGap} spots</em></div></div> : null}
          {team.playerAwards.boomMachine ? <div className="profile-award"><span>💥</span><div><small>BOOM MACHINE</small><strong>{team.playerAwards.boomMachine.player}</strong><em>{money(team.playerAwards.boomMachine.score)} pts · Week {team.playerAwards.boomMachine.week}</em></div></div> : null}
          {team.playerAwards.mostConsistent ? <div className="profile-award"><span>🎯</span><div><small>MOST CONSISTENT</small><strong>{team.playerAwards.mostConsistent.player}</strong><em>{money(team.playerAwards.mostConsistent.variance)} pt weekly SD</em></div></div> : null}
          {team.playerAwards.lateRoundWizard ? <div className="profile-award"><span>🧙</span><div><small>LATE-ROUND WIZARD</small><strong>{team.playerAwards.lateRoundWizard.player}</strong><em>Round {team.playerAwards.lateRoundWizard.round} · Drafted #{team.playerAwards.lateRoundWizard.draftPick} → ROS #{team.playerAwards.lateRoundWizard.rosRank} · +{team.playerAwards.lateRoundWizard.valueGap}</em></div></div> : null}
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
}

// Columns match the .team-card-grid breakpoints in styles.css, so the open
// profile can sit directly beneath the row that holds its card.
const COLUMN_BREAKPOINTS = [[520, 1], [800, 2], [1000, 3]];
function columnsFor(width) {
  return COLUMN_BREAKPOINTS.find(([max]) => width <= max)?.[1] ?? 4;
}
function useColumns() {
  const [columns, setColumns] = useState(() => columnsFor(window.innerWidth));
  useEffect(() => {
    const update = () => setColumns(columnsFor(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return columns;
}

export default function TeamCards({ teams }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = teams.find(t => t.id === selectedId);
  const columns = useColumns();

  const renderCard = (team, i) => {
    const s = team.standings || {};
    const avg = s.games ? s.pointsFor / s.games : 0;
    return (
      <div className="team-card-item" key={team.id}>
        <button className={selectedId === team.id ? "team-card selected" : "team-card"} type="button" aria-expanded={selectedId === team.id} onClick={() => setSelectedId(selectedId === team.id ? null : team.id)}>
          <div className="card-top"><span className="card-rank">#{i + 1}</span><span className="card-season">2026</span></div>
          <div className="card-logo-wrap"><img src={team.logo} alt="" className="team-logo" /></div>
          <h3>{team.name.trim()}</h3>
          <div className="card-record">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""} <span>·</span> {money(avg)} PPG</div>
          <div className="card-stats">
            <span><small>PF</small><strong>{money(s.pointsFor)}</strong></span>
            <span><small>PA</small><strong>{money(s.pointsAgainst)}</strong></span>
            <span><small>STREAK</small><strong>{s.streak?.length ? s.streak.type + s.streak.length : "—"}</strong></span>
          </div>
          <div className="card-signals" aria-label="Team pulse">
            {team.profileAnalytics?.trend?.direction === "up" ? <span title="Heating up">🔥</span> : team.profileAnalytics?.trend?.direction === "down" ? <span title="Cooling off">❄️</span> : null}
            {team.profileAnalytics?.luck?.difference > 0.2 ? <span title="Lucky">🍀</span> : team.profileAnalytics?.luck?.difference < -0.2 ? <span title="Unlucky">💀</span> : null}
          </div>
          <div className="card-footer"><span>{selectedId === team.id ? "CLOSE PROFILE" : "VIEW PROFILE"}</span><span>↗</span></div>
        </button>
      </div>
    );
  };

  const rows = [];
  for (let i = 0; i < teams.length; i += columns) {
    const rowTeams = teams.slice(i, i + columns);
    rows.push(
      <div className="team-card-row" key={i}>
        <div className="team-card-grid">
          {rowTeams.map((team, offset) => renderCard(team, i + offset))}
        </div>
        {selected && rowTeams.some(team => team.id === selectedId) ? <TeamProfile team={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>
    );
  }
  return <>{rows}</>;
}
