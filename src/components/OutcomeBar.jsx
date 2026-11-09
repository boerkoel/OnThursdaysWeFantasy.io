import React from "react";
import { money } from "../lib/data.js";
import { Explain } from "./LiveBits.jsx";

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

// A final-score distribution from a projection and its spread (normal), never below the points already scored.
const Z = { p10: -1.2816, p25: -0.6745, p50: 0, p75: 0.6745, p90: 1.2816 };
export function normalDist(score, projected, sd) {
  if (!Number.isFinite(Number(projected))) return null;
  const d = { mean: Number(projected) };
  for (const [k, z] of Object.entries(Z)) d[k] = Math.max(Number(score) || 0, Number(projected) + z * (Number(sd) || 0));
  return d;
}

// A race at a glance (Jim, 2026-11-02): each team's likely final score on one shared scale, phone-sized. Per row:
// name and odds, then a full-width bar: the solid stretch is points already banked, the band the middle half of
// outcomes, the thin line 80%, the tick the projection. line: an optional bar to clear (the projected median).
// rows: [{ key, name, score, dist, odds, hot, espn }] (espn: ESPN's projection, a small ◆); oddsLabel: "chop", "to win", "above".
// Two teams also get a betting-style line (Jim, 2026-11-02): the projected margin as a spread, to the half point
// ("Line: Mel's −4.5"), plus the over/under with total; against a line (the median), each row shows its margin.
const half = v => (Math.round(Math.abs(v) * 2) / 2).toFixed(1);
export function RaceChart({ rows, oddsLabel, line = null, total = false }) {
  const ok = rows.filter(r => r.dist);
  if (ok.length < 2) return null;
  const vals = ok.flatMap(r => [r.dist.p10, r.dist.p90, Number(r.score) || 0]).concat(line ? [line.value] : []).filter(Number.isFinite);
  const span = Math.max(...vals) - Math.min(...vals), pad = Math.max(2, span * 0.05);
  const lo = Math.max(0, Math.min(...vals) - pad), hi = Math.max(...vals) + pad;
  const x = v => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const w = (a, b) => `${Math.max(0.6, ((Math.min(b, hi) - Math.max(a, lo)) / (hi - lo)) * 100)}%`;
  return (
    <div className="race-chart">
      {ok.map(r => <div className={"race-row" + (r.hot ? " hot" : "")} key={r.key}
        title={`${r.name}: ${money(r.score)} so far · projected ${money(r.dist.mean)} · middle half ${money(r.dist.p25)}–${money(r.dist.p75)} · 80% ${money(r.dist.p10)}–${money(r.dist.p90)}${Number.isFinite(r.espn) ? ` · ◆ ESPN ${money(r.espn)}` : ""}`}>
        <div className="race-head"><span>{r.name}</span><b>{line ? <em>{r.dist.mean >= line.value ? "+" : "−"}{half(r.dist.mean - line.value)} </em> : null}{r.odds != null ? `${Math.round(r.odds)}% ${oddsLabel}` : ""}</b></div>
        <div className="race-track">
          <i className="race-banked" style={{ left: 0, width: x(Number(r.score) || 0) }} />
          <i className="race-range" style={{ left: x(r.dist.p10), width: w(r.dist.p10, r.dist.p90) }} />
          <i className="race-iqr" style={{ left: x(r.dist.p25), width: w(r.dist.p25, r.dist.p75) }} />
          <i className="race-mean" style={{ left: x(r.dist.mean) }} />
          {Number.isFinite(r.espn) ? <i className="race-espn" style={{ left: x(r.espn) }} /> : null}
          {line ? <i className="race-line" style={{ left: x(line.value) }} /> : null}
        </div>
      </div>)}
      {ok.length === 2 && !line ? (() => {
        const [fav, dog] = ok[0].dist.mean >= ok[1].dist.mean ? ok : [ok[1], ok[0]], m = fav.dist.mean - dog.dist.mean;
        return <p className="race-spread">Line: {m < 0.25 ? "pick'em" : `${fav.name} −${half(m)}`}{total ? ` · O/U ${half(fav.dist.mean + dog.dist.mean)}` : ""}</p>;
      })() : null}
      <div className="race-axis"><span>{Math.round(lo)} pts</span>{line ? <span className="race-line-label" style={{ left: x(line.value) }}>{line.label} {money(line.value)}</span> : null}<span>{Math.round(hi)} pts</span></div>
    </div>
  );
}

// How our numbers have done against ESPN's (scoreboard.scorecard).
export function AccuracyScorecard({ scorecard }) {
  if (!scorecard) return null;
  const cols = [["thu", "At Thursday kickoff"], ["sun", "Once Sunday starts"]];
  const graded = cols.some(([k]) => scorecard[k]?.teams);
  // Bias: closer to 0 is better.
  const bias = (ours, espn) => ours == null ? <td className="num">—</td> :
    <td className="num"><b className={Math.abs(ours) <= Math.abs(espn) ? "up" : "down"}>{ours > 0 ? "+" : ""}{ours.toFixed(1)} pts</b> <small>vs {espn > 0 ? "+" : ""}{espn.toFixed(1)}</small></td>;
  const cell = (ours, espn, unit, digits) => ours == null ? <td className="num">—</td> :
    <td className="num"><b className={ours <= espn ? "up" : "down"}>{ours.toFixed(digits)}{unit}</b> <small>vs {espn.toFixed(digits)}{unit}</small></td>;
  return (
    <section id="accuracy" className="section">
      <div className="section-heading"><div><span className="section-kicker">KEEPING OURSELVES HONEST</span><h2>Projection scorecard</h2></div></div>
      {graded ? <div className="scorecard-table"><table>
        <thead><tr><th></th>{cols.map(([k, l]) => <th key={k} className="num">{l}<small> · {scorecard[k]?.weeks || 0} wk</small></th>)}</tr></thead>
        <tbody>
          <tr><td>Projection, average miss</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.missOurs, scorecard[k]?.missEspn, " pts", 1)}</React.Fragment>)}</tr>
          <tr><td>Projection, average bias <small>(+ = too high)</small></td>{cols.map(([k]) => <React.Fragment key={k}>{bias(scorecard[k]?.biasOurs, scorecard[k]?.biasEspn)}</React.Fragment>)}</tr>
          <tr><td>Head-to-head odds (Brier)</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.brierWin, scorecard[k]?.brierWinEspn, "", 3)}</React.Fragment>)}</tr>
          <tr><td>Above-median odds (Brier)</td>{cols.map(([k]) => <React.Fragment key={k}>{cell(scorecard[k]?.brierAbove, scorecard[k]?.brierAboveEspn, "", 3)}</React.Fragment>)}</tr>
          <tr><td>Favorites <small>(70%+ to win)</small></td>{cols.map(([k]) => { const f = scorecard[k]?.favorites;
            return <td key={k} className="num">{f ? <><b>won {Math.round(f.won)}%</b> <small>· said {Math.round(f.said)}% · {f.n}</small></> : "—"}</td>; })}</tr>
        </tbody></table></div>
        : <p className="median-note">Grading starts with Week {scorecard.since}: the first results land after Monday night.</p>}
      <Explain lead="Ours vs ESPN's, lower is better (green = we did better).">Projections are graded on each team's final score; odds by Brier score (the average squared miss on a 0–1 scale; 0.25 is a coin flip). ESPN doesn't publish odds, so its column uses the odds its projections imply with the same spread. Projections have run high, so ours are scaled by how the league's finals have compared with them lately (each older week counts less){scorecard.scale ? `: ×${scorecard.scale.scale} this week` : ""}. Favorites: how often teams we gave 70%+ actually won.</Explain>
    </section>
  );
}
