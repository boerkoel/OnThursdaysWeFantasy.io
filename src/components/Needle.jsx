import React, { useEffect, useState } from "react";
import { money } from "../lib/data.js";
import { normalCdf, normalQuantile } from "../../scripts/lib/simulation.js";

// The Primetime needle (Jim, 2026-11-02, after the NYT election needle): a matchup's win odds on a half dial,
// team a's side on the left, b's on the right, shaded from lean to very likely. The needle swings across the
// middle half of what's still possible (Jim: for nerves and drama), and under it the projected margin reads
// like a betting line.
const CX = 120, CY = 118, R_OUT = 104, R_IN = 66;
// Zone edges in b's win chance, and how strong each zone's shade is.
const ZONES = [[0, 5, 0.9], [5, 25, 0.6], [25, 50, 0.32], [50, 75, 0.32], [75, 95, 0.6], [95, 100, 0.9]];
const A_COLOR = "#7aa6d8", B_COLOR = "#e0a64a";
const point = (pB, r) => { const t = Math.PI * (1 - pB / 100); return [CX + r * Math.cos(t), CY - r * Math.sin(t)]; };
const wedge = (from, to) => {
  const [x1, y1] = point(from, R_OUT), [x2, y2] = point(to, R_OUT), [x3, y3] = point(to, R_IN), [x4, y4] = point(from, R_IN);
  return `M ${x1} ${y1} A ${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${R_IN} ${R_IN} 0 0 0 ${x4} ${y4} Z`;
};
const sdOf = d => d ? Math.max(0, (d.p75 - d.p25) / 1.349) : 0;
const half = v => (Math.round(Math.abs(v) * 2) / 2).toFixed(1);
const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export function Needle({ a, b }) {
  const pB = Math.min(99.9, Math.max(0.1, Number(b.winProbability)));
  const da = a.projection?.dist, db = b.projection?.dist;
  const sd = Math.hypot(sdOf(da), sdOf(db));
  // Swing: a random walk in z around the odds, out to the middle half of the remaining margin (±0.67 SD of it,
  // the "likely" range printed below): a coin flip with a lot left sweeps about 25–75%. Odds' z is roughly
  // margin ÷ SD, so that's ±0.67 in z, easing off over the last few points left and still once all have played.
  const amp = 0.6745 * Math.min(1, sd / 3);
  const [wobble, setWobble] = useState(0);
  useEffect(() => {
    if (!(amp > 0.01) || reducedMotion()) { setWobble(0); return; }
    let w = 0;
    const id = setInterval(() => { w = Math.max(-1, Math.min(1, 0.6 * w + 0.8 * (Math.random() * 2 - 1))); setWobble(w); }, 220);
    return () => clearInterval(id);
  }, [amp]);
  if (!Number.isFinite(pB)) return null;
  const shown = 100 * normalCdf(normalQuantile(pB / 100) + amp * wobble);
  const deg = (shown / 100 - 0.5) * 180;
  const margin = da && db ? da.mean - db.mean : null;
  const lead = margin == null ? null : Math.abs(margin) < 0.25 ? "Dead even" : `${(margin > 0 ? a : b).team} by ${half(margin)}`;
  const lo = margin == null ? null : margin - 0.6745 * sd, hi = margin == null ? null : margin + 0.6745 * sd;
  // The middle half of outcomes, from the projected winner's side: "likely 3.5–17.5", or "either way" if it spans both.
  const sign = margin >= 0 ? 1 : -1;
  const range = lo == null ? null : lo * hi <= 0 ? "either way" : `likely ${half(Math.min(sign * lo, sign * hi))}–${half(Math.max(sign * lo, sign * hi))}`;
  return (
    <div className="needle" role="img" aria-label={`${a.team} ${Math.round(100 - pB)}%, ${b.team} ${Math.round(pB)}% to win`}>
      <svg viewBox="0 0 240 128" className="needle-dial">
        {ZONES.map(([from, to, o]) => <path key={from} d={wedge(from, to)} fill={to <= 50 ? A_COLOR : B_COLOR} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform .22s linear" }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUT - 4} className="needle-hand" />
        </g>
        <circle cx={CX} cy={CY} r={5} className="needle-hub" />
      </svg>
      <div className="needle-odds">
        <span style={{ color: A_COLOR }}><b>{Math.round(100 - pB)}%</b>{a.team}</span>
        <span style={{ color: B_COLOR }}><b>{Math.round(pB)}%</b>{b.team}</span>
      </div>
      {lead ? <p className="needle-line" title={`Projected ${money(da.mean)} – ${money(db.mean)}; middle half of outcomes: ${a.team} ${lo >= 0 ? "+" : "−"}${half(lo)} to ${hi >= 0 ? "+" : "−"}${half(hi)}`}>
        Projected: <b>{lead}</b> ({range})</p> : null}
    </div>
  );
}
