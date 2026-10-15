import React from "react";
import { money } from "../lib/data.js";

// A team's simulated final score, compactly: the thin line spans the middle 80%
// of outcomes (10th-90th percentile), the band the middle half (25th-75th), the
// bold tick is our projection (the simulated average) and the small diamond is
// ESPN's projection, so a diamond off-center or outside the band shows where
// we disagree. lo/hi set a shared scale so teams can be compared.
export function OutcomeBar({ dist, espn, lo, hi, width = 120, height = 16 }) {
  if (!dist || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const x = v => Math.max(1, Math.min(width - 1, ((v - lo) / (hi - lo)) * width));
  const mid = height / 2;
  const showEspn = Number.isFinite(espn);
  const title = `Our projection ${money(dist.mean)} · middle half ${money(dist.p25)}–${money(dist.p75)} · 80% of outcomes ${money(dist.p10)}–${money(dist.p90)}${showEspn ? ` · ESPN ${money(espn)}` : ""}`;
  return (
    <svg className="outcome-bar" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      <line x1={x(dist.p10)} x2={x(dist.p90)} y1={mid} y2={mid} className="ob-range" />
      <rect x={x(dist.p25)} y={mid - 3.5} width={Math.max(1.5, x(dist.p75) - x(dist.p25))} height={7} rx={2} className="ob-iqr" />
      <line x1={x(dist.mean)} x2={x(dist.mean)} y1={mid - 6} y2={mid + 6} className="ob-mean" />
      {showEspn ? <path d={`M ${x(espn)} ${mid - 7.5} l 3 3 l -3 3 l -3 -3 z`} className="ob-espn" /> : null}
    </svg>
  );
}

// Shared scale for a set of teams: the widest 80% range among them, padded.
export function outcomeScale(teams) {
  const vals = teams.flatMap(t => [t.projection?.dist?.p10, t.projection?.dist?.p90, t.projection?.espn]).map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(2, (hi - lo) * 0.06);
  return { lo: lo - pad, hi: hi + pad };
}

// Both teams of a matchup on one scale, with the numbers spelled out.
export function MatchupOutcomes({ teams }) {
  const scale = outcomeScale(teams);
  if (!scale || !teams.every(t => t.projection?.dist) || teams.every(t => t.projection.dist.p90 <= t.projection.dist.p10)) return null;
  const spread = t => t.projection.dist.p90 - t.projection.dist.p10;
  return (
    <div className="matchup-outcomes">
      {teams.map(t => {
        const d = t.projection.dist, espn = Number(t.projection.espn);
        const gap = Number.isFinite(espn) ? d.mean - espn : null;
        return <div className="mo-row" key={t.teamId}>
          <span className="mo-name">{t.team}</span>
          <OutcomeBar dist={d} espn={espn} lo={scale.lo} hi={scale.hi} width={220} />
          <span className="mo-nums"><b>{money(d.mean)}</b> <small>80%: {money(d.p10)}–{money(d.p90)}{gap != null && Math.abs(gap) >= 3 ? ` · ESPN ${money(espn)}` : ""}</small></span>
        </div>;
      })}
      <p className="mo-legend">Bold tick: our projection (ESPN, Sleeper (RotoWire) and FantasyPros averaged, with injuries and likely lineup moves simulated). Band: middle half of outcomes; line: 80% of outcomes ({teams.map(t => `${t.team} ±${money(spread(t) / 2)}`).join(", ")}). ◆ ESPN's projection.</p>
    </div>
  );
}

// How our numbers have done against ESPN's (scoreboard.scorecard).
export function AccuracyScorecard({ scorecard }) {
  if (!scorecard) return null;
  const cols = [["thu", "At Thursday kickoff"], ["sun", "Once Sunday starts"]];
  const graded = cols.some(([k]) => scorecard[k]?.teams);
  const cell = (ours, espn, unit, digits) => ours == null ? <td className="num">—</td> :
    <td className="num"><b className={ours <= espn ? "up" : "down"}>{ours.toFixed(digits)}{unit}</b> <small>vs {espn.toFixed(digits)}{unit}</small></td>;
  return (
    <section id="accuracy" className="section">
      <div className="section-heading"><div><span className="section-kicker">KEEPING OURSELVES HONEST</span><h2>Projection scorecard</h2></div></div>
      {graded ? <div className="scorecard-table"><table>
        <thead><tr><th></th>{cols.map(([k, l]) => <th key={k} className="num">{l}<small> · {scorecard[k]?.weeks || 0} wk</small></th>)}</tr></thead>
        <tbody>
          <tr><td>Projection, average miss</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.missOurs, scorecard[k]?.missEspn, " pts", 1)}</React.Fragment>)}</tr>
          <tr><td>Head-to-head odds (Brier)</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.brierWin, scorecard[k]?.brierWinEspn, "", 3)}</React.Fragment>)}</tr>
          <tr><td>Above-median odds (Brier)</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.brierAbove, scorecard[k]?.brierAboveEspn, "", 3)}</React.Fragment>)}</tr>
        </tbody></table></div>
        : <p className="median-note">Grading starts with Week {scorecard.since}: the first results land after Monday night.</p>}
      <p className="median-note">Ours vs ESPN's, lower is better (green = we did better). Projections are graded on each team's final score; odds by Brier score (the average squared miss on a 0–1 scale; 0.25 is a coin flip). ESPN doesn't publish odds, so its column uses the odds its projections imply with the same spread.</p>
    </section>
  );
}
