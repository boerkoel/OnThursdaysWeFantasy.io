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
        {/* Uriel's look (Jim, 2026-11-15: "make it clear it looks like him"): warm brown skin, a tall swept-up
            pompadour with short sides, thick dark brows, smiling eyes, a big toothy grin, a short full beard with a
            gray patch at the chin, and his orange striped headband. */}
        <g className="reveal-face">
          <rect x="162" y="198" width="36" height="30" fill="#b07a52" />
          <path d="M 128 150 C 128 108 150 92 180 92 C 210 92 232 108 232 150 C 232 196 208 222 180 224 C 152 222 128 196 128 150 Z" fill="#c08a5f" />
          <ellipse cx="128" cy="160" rx="8" ry="13" fill="#b07a52" />
          <ellipse cx="232" cy="160" rx="8" ry="13" fill="#b07a52" />
          {/* short full beard joined to the mustache, gray at the chin */}
          <path d="M 130 162 C 132 202 154 228 180 230 C 206 228 228 202 230 162 C 224 182 214 192 204 196 C 196 186 164 186 156 196 C 146 192 136 182 130 162 Z" fill="#231913" />
          <path d="M 168 216 C 172 226 188 226 192 216 C 186 220 174 220 168 216 Z" fill="#8f8a84" />
          <path d="M 152 186 C 162 176 198 176 208 186 C 198 182 162 182 152 186 Z" fill="#231913" />
          {/* big toothy grin */}
          <path d="M 152 190 C 160 210 200 210 208 190 C 196 196 164 196 152 190 Z" fill="#fff" stroke="#3a2418" strokeWidth="2" strokeLinejoin="round" />
          <path d="M 160 194 L 200 194" stroke="#d9d4cc" strokeWidth="1.5" />
          {/* smiling eyes, smile lines */}
          <path d="M 152 150 C 156 143 168 143 172 150" stroke="#2a1a12" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 188 150 C 192 143 204 143 208 150" stroke="#2a1a12" strokeWidth="4" fill="none" strokeLinecap="round" />
          <ellipse cx="162" cy="151" rx="5" ry="3.5" fill="#2a1a12" />
          <ellipse cx="198" cy="151" rx="5" ry="3.5" fill="#2a1a12" />
          <path d="M 146 166 C 144 176 146 184 150 190 M 214 166 C 216 176 214 184 210 190" stroke="#9a6a48" strokeWidth="2" fill="none" opacity=".8" />
          {/* thick dark brows */}
          <path d="M 148 136 C 156 128 168 128 175 133" stroke="#1a120d" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M 185 133 C 192 128 204 128 212 136" stroke="#1a120d" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M 180 152 C 176 166 175 172 183 174" stroke="#94643f" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* orange striped headband */}
          <path d="M 129 118 C 150 108 210 108 231 118 L 232 132 C 210 122 150 122 128 132 Z" fill="#e0772a" />
          <path d="M 150 113 L 158 125 M 160 112 L 168 124 M 170 111 L 178 123" stroke="#3f6474" strokeWidth="5" />
          <path d="M 180 111 L 188 123 M 190 112 L 198 124" stroke="#e9e6df" strokeWidth="4" />
          {/* tall pompadour, short darker sides */}
          <path d="M 130 118 C 128 104 132 96 140 92 L 140 112 C 136 112 132 114 130 118 Z" fill="#2d241e" />
          <path d="M 230 118 C 232 104 228 96 220 92 L 220 112 C 224 112 228 114 230 118 Z" fill="#2d241e" />
          <path d="M 138 112 C 132 82 150 54 186 52 C 220 52 236 74 222 112 C 214 100 200 94 184 96 C 166 92 148 98 138 112 Z" fill="#17110d" />
          <path d="M 156 70 C 176 56 206 58 220 76 M 150 86 C 170 70 200 72 214 86" stroke="#3a2c22" strokeWidth="3" fill="none" />
        </g>

        {/* the hood: drawn over the face, lifts back on the loop */}
        <g className="reveal-hood">
          <path d="M 102 232 C 88 140 110 44 180 34 C 250 44 272 140 258 232 C 240 214 220 206 180 206 C 140 206 120 214 102 232 Z" fill="#191714" />
          <path d="M 128 216 C 122 140 142 84 180 78 C 218 84 238 140 232 216 C 216 204 200 200 180 200 C 160 200 144 204 128 216 Z" fill="#050505" />
          <path d="M 180 34 C 204 38 232 56 246 90" stroke="#2f2b26" strokeWidth="4" fill="none" />
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
