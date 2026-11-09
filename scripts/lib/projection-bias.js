// Projection bias correction (Jim, 2026-11-09): player projections (ESPN's and the second opinion alike) have run
// high, 5–11 points per team a week. Each week's projections are scaled by how the league's finals have compared
// with its pregame projections: a moving average where each older week counts 40% less, shrunk toward 1 (no
// change) by a prior worth one week, and kept within 0.85–1.05.
//
// weeks: week-archive.json's weeks; each graded week has forecasts.thu (at the first kickoff: teams[id].ours, and
// the scale used then, if any) and finals[id].score. ESPN's own projection is never scaled, so the scorecard still
// compares against it.
export const BIAS_DECAY = 0.6, BIAS_PRIOR_WEEKS = 1, BIAS_MIN = 0.85, BIAS_MAX = 1.05;

export function projectionScale(weeks, currentWeek) {
  const graded = Object.entries(weeks || {})
    .filter(([k, w]) => Number(k) < currentWeek && w.forecasts?.thu?.teams && w.finals)
    .map(([k, w]) => {
      let projected = 0, scored = 0;
      for (const [id, t] of Object.entries(w.forecasts.thu.teams)) {
        const fin = w.finals[id];
        if (!fin || !Number.isFinite(Number(t.ours)) || !Number.isFinite(Number(fin.score))) continue;
        // Undo the scale used that week, so the ratio is against the unscaled projections.
        projected += Number(t.ours) / (Number(w.forecasts.thu.scale) || 1);
        scored += Number(fin.score);
      }
      return { week: Number(k), ratio: projected > 0 ? scored / projected : null };
    })
    .filter(x => x.ratio != null)
    .sort((a, b) => b.week - a.week);
  let weight = BIAS_PRIOR_WEEKS, sum = BIAS_PRIOR_WEEKS;   // the prior: ratio 1
  graded.forEach((x, i) => { const w = BIAS_DECAY ** i; weight += w; sum += w * x.ratio; });
  const scale = Math.min(BIAS_MAX, Math.max(BIAS_MIN, sum / weight));
  return { scale: Math.round(scale * 1000) / 1000, weeks: graded.length, ratios: graded.map(x => ({ week: x.week, ratio: Math.round(x.ratio * 1000) / 1000 })) };
}
