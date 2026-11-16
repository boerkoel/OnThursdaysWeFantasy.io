import React from "react";

// The guillotine's last team standing, unmasked (Jim, 2026-11-15: "a cartoon of Uriel as an executioner who
// reveals himself by lifting the hood, like The Traitors"): a hooded executioner with an axe; on a loop the hood
// lifts to show the champion's grin, then drops again. A plain drawing (dark swept-back hair, beard, big smile),
// not traced from photos: the site is public. champion: the surviving team; manager: the name to reveal.
export default function ChampionReveal({ champion, manager = "Uriel", season }) {
  if (!champion) return null;
  return (
    <div className="reveal" role="img" aria-label={`A hooded executioner lifts the hood: it was ${manager} all along. ${champion.team} is the last team standing.`}>
      <svg viewBox="0 0 360 400" className="reveal-art" aria-hidden="true">
        <defs>
          <radialGradient id="rv-spot" cx="50%" cy="30%" r="70%">
            <stop offset="0" stopColor="#3b3226" />
            <stop offset="1" stopColor="#0f0e0c" />
          </radialGradient>
          <linearGradient id="rv-blade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f2f2ee" />
            <stop offset="1" stopColor="#8d9097" />
          </linearGradient>
          <linearGradient id="rv-cloak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2622" />
            <stop offset="1" stopColor="#100f0d" />
          </linearGradient>
        </defs>
        <rect width="360" height="400" fill="url(#rv-spot)" />
        <ellipse cx="180" cy="384" rx="150" ry="14" fill="#000" opacity=".5" />

        {/* axe over the shoulder */}
        <g className="reveal-axe">
          <rect x="246" y="96" width="10" height="250" rx="4" fill="#6b4527" transform="rotate(14 251 220)" />
          <path d="M 262 78 C 312 70 330 108 318 146 C 300 128 282 122 262 124 Z" fill="url(#rv-blade)" stroke="#5c5f66" strokeWidth="2" transform="rotate(14 251 220)" />
        </g>

        {/* cloak and shoulders */}
        <path d="M 70 400 C 74 300 104 236 180 222 C 256 236 286 300 290 400 Z" fill="url(#rv-cloak)" />
        <path d="M 180 230 L 180 400" stroke="#3a342d" strokeWidth="2" />
        {/* hand on the axe */}
        <circle cx="262" cy="262" r="15" fill="#b9825a" />

        {/* the face under the hood */}
        <g className="reveal-face">
          <rect x="164" y="198" width="32" height="30" fill="#b9825a" />
          <ellipse cx="180" cy="160" rx="50" ry="58" fill="#c48d63" />
          <ellipse cx="129" cy="164" rx="8" ry="12" fill="#b9825a" />
          <ellipse cx="231" cy="164" rx="8" ry="12" fill="#b9825a" />
          {/* beard and goatee */}
          <path d="M 132 170 C 136 206 156 226 180 228 C 204 226 224 206 228 170 C 222 196 206 206 180 206 C 154 206 138 196 132 170 Z" fill="#241a14" />
          <path d="M 160 214 C 166 222 194 222 200 214" stroke="#6d6660" strokeWidth="3" fill="none" opacity=".7" />
          <path d="M 156 186 C 166 180 194 180 204 186" stroke="#241a14" strokeWidth="6" fill="none" strokeLinecap="round" />
          {/* big grin */}
          <path d="M 158 192 C 166 206 194 206 202 192 Z" fill="#fff" stroke="#3a2418" strokeWidth="2" />
          {/* eyes and brows */}
          <ellipse cx="162" cy="150" rx="6" ry="7" fill="#2a1a12" />
          <ellipse cx="198" cy="150" rx="6" ry="7" fill="#2a1a12" />
          <circle cx="164" cy="148" r="2" fill="#fff" />
          <circle cx="200" cy="148" r="2" fill="#fff" />
          <path d="M 150 136 C 158 130 168 130 174 134 M 186 134 C 192 130 202 130 210 136" stroke="#1d140f" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M 180 156 C 176 168 176 172 182 174" stroke="#9a6a48" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* dark hair, swept back and up */}
          <path d="M 128 142 C 122 96 150 80 184 80 C 212 80 236 92 234 132 C 226 112 212 104 190 106 C 170 100 150 104 140 116 C 134 124 130 132 128 142 Z" fill="#1f1712" />
          <path d="M 150 92 C 170 76 206 78 222 96" stroke="#3a2c22" strokeWidth="3" fill="none" />
        </g>

        {/* the hood: drawn over the face, lifts back on the loop */}
        <g className="reveal-hood">
          <path d="M 108 230 C 96 150 116 70 180 62 C 244 70 264 150 252 230 C 236 214 218 206 180 206 C 142 206 124 214 108 230 Z" fill="#191714" />
          <path d="M 132 214 C 128 150 146 104 180 100 C 214 104 232 150 228 214 C 214 204 200 200 180 200 C 160 200 146 204 132 214 Z" fill="#050505" />
          <path d="M 180 62 C 200 64 226 78 238 104" stroke="#2f2b26" strokeWidth="4" fill="none" />
        </g>
      </svg>
      <div className="reveal-copy">
        <small>THE LAST EXECUTIONER{season ? ` · ${season}` : ""}</small>
        <strong>It was <span>{manager}</span> all along.</strong>
        <p>{champion.team}: last team standing.</p>
      </div>
    </div>
  );
}
