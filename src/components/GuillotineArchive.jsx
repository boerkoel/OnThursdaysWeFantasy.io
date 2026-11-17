import React from "react";
import ChampionReveal from "./ChampionReveal.jsx";

const INK = "#0b0b0b";

// A comic-book gravestone, "RIP · OBITUARIES" (Jim, 2026-11-17), in the reveal's style: ink outlines, halftone, a
// moonlit night, the axe stuck in the dirt.
export function RipStone() {
  return (
    <svg viewBox="0 0 360 400" className="reveal-art" aria-hidden="true">
      <defs>
        <radialGradient id="rip-night" cx="50%" cy="30%" r="75%">
          <stop offset="0" stopColor="#5d4a8a" />
          <stop offset=".55" stopColor="#2a2148" />
          <stop offset="1" stopColor="#0f0c1c" />
        </radialGradient>
        <pattern id="rip-dots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="1.8" fill="#000" opacity=".3" />
        </pattern>
        <linearGradient id="rip-stone" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b9bdc6" />
          <stop offset=".6" stopColor="#8e939e" />
          <stop offset="1" stopColor="#6c707a" />
        </linearGradient>
      </defs>
      <rect width="360" height="400" fill="url(#rip-night)" />
      <rect width="360" height="400" fill="url(#rip-dots)" />
      <circle cx="292" cy="70" r="34" fill="#f4ecc8" stroke={INK} strokeWidth="4" />
      <circle cx="280" cy="62" r="6" fill="#d9cfa4" /><circle cx="300" cy="82" r="4" fill="#d9cfa4" />
      <g fill="#fff" opacity=".85"><circle cx="50" cy="50" r="2" /><circle cx="120" cy="30" r="1.6" /><circle cx="200" cy="56" r="1.8" /><circle cx="80" cy="110" r="1.4" /></g>
      {/* the stone */}
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M 92 330 L 92 170 C 92 96 268 96 268 170 L 268 330 Z" fill="url(#rip-stone)" stroke={INK} strokeWidth="5" />
        <path d="M 236 140 C 252 160 256 190 256 220 L 256 330 L 268 330 L 268 170 C 268 156 262 146 236 140 Z" fill="#5d616a" opacity=".6" />
        <path d="M 112 170 C 116 130 150 112 180 112" stroke="#e6e8ee" strokeWidth="5" fill="none" />
        <path d="M 246 160 L 238 176 L 246 188 L 236 204" stroke={INK} strokeWidth="3" fill="none" />
        <text x="180" y="214" textAnchor="middle" fontFamily="Bangers, Impact, sans-serif" fontSize="72" fill="#2b2a30" stroke="#e6e8ee" strokeWidth="1.5">RIP</text>
        <path d="M 128 232 L 232 232" stroke="#4a4d55" strokeWidth="3" />
        <text x="180" y="266" textAnchor="middle" fontFamily="Bangers, Impact, sans-serif" fontSize="30" letterSpacing="2" fill="#2b2a30">OBITUARIES</text>
        <text x="180" y="296" textAnchor="middle" fontFamily="Bangers, Impact, sans-serif" fontSize="16" letterSpacing="1" fill="#3d3f46">2026 · ONE SURVIVOR</text>
        {/* the dirt, grass, and the axe stuck in it */}
        <path d="M 30 400 C 60 336 300 336 330 400 Z" fill="#3a2a1a" stroke={INK} strokeWidth="4" />
        <path d="M 60 352 L 66 336 L 72 352 M 286 352 L 292 334 L 298 352 M 120 340 L 124 328 L 128 340 M 238 340 L 242 326 L 246 340" stroke="#4f7d3c" strokeWidth="4" fill="none" />
        <g transform="rotate(-24 300 330)">
          <rect x="296" y="236" width="9" height="104" rx="3" fill="#7a4a24" stroke={INK} strokeWidth="3" />
          <path d="M 305 240 C 336 236 348 262 338 286 C 326 274 316 270 305 270 Z" fill="#c9ced6" stroke={INK} strokeWidth="3.5" />
        </g>
      </g>
    </svg>
  );
}

// The guillotine season's card on the League tab (Jim, 2026-11-17): the champion's reveal, mini and looping, opens
// the Death Watch tab; the gravestone opens the obituaries.
export default function GuillotineArchive({ guillotine }) {
  const teams = guillotine?.teams || [];
  const settled = teams.length === 1 || (teams.length === 2 && teams.some(t => t.chopProbability >= 99.9));
  const champion = settled ? [...teams].sort((a, b) => a.chopProbability - b.chopProbability)[0] : null;
  if (!champion) return null;
  const manager = /^(.+?)'s /.exec(champion.team)?.[1] || champion.team;
  return (
    <section id="guillotine-archive" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">{(guillotine.leagueName || "Guillotine league").toUpperCase()} · {guillotine.season || 2026}</span><h2>The Guillotine</h2></div>
      </div>
      <div className="ga-links">
        <a className="ga-link" href="#death-watch">
          <ChampionReveal champion={champion} manager={manager} mini />
          <span><b>{champion.team}</b> · last team standing</span>
        </a>
        <a className="ga-link" href="#rip">
          <span className="reveal-mini"><RipStone /></span>
          <span><b>RIP</b> · read the obituaries</span>
        </a>
      </div>
    </section>
  );
}
