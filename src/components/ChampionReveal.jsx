import React from "react";

// The guillotine's last team standing, unmasked (Jim, 2026-11-15: "a cartoon of Uriel as an executioner who
// reveals himself by lifting the hood, like The Traitors", then "higher fidelity, more like him, comic book
// style"): a hooded executioner with a reaper's scythe over a halftone burst; on a loop the hood lifts to show the
// champion's grin and a SURPRISE! burst, he raises a trophy, then it all resets. Drawn from scratch in comic style (ink outlines, cel shading), not
// traced from photos: the site is public. champion: the surviving team; manager: the name to reveal.
const INK = "#0b0b0b";
// mini: just the looping art, for a link card (the League tab's guillotine card; Jim, 2026-11-17).
export default function ChampionReveal({ champion, manager = "Uriel", season, mini = false }) {
  if (!champion) return null;
  const art = (
      <svg viewBox="0 0 360 400" className="reveal-art" aria-hidden="true">
        <defs>
          <radialGradient id="rv-burst" cx="50%" cy="38%" r="70%">
            <stop offset="0" stopColor="#ffd25a" />
            <stop offset=".45" stopColor="#f08a24" />
            <stop offset="1" stopColor="#7d1d12" />
          </radialGradient>
          <pattern id="rv-dots" width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="4.5" cy="4.5" r="1.9" fill="#7d1d12" opacity=".35" />
          </pattern>
          <pattern id="rv-dotsDark" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.2" fill="#000" opacity=".28" />
          </pattern>
          <linearGradient id="rv-blade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset=".5" stopColor="#c9ced6" />
            <stop offset="1" stopColor="#6f7580" />
          </linearGradient>
        </defs>

        {/* comic background: burst, rays, halftone */}
        <rect width="360" height="400" fill="url(#rv-burst)" />
        <g fill="#ffe8a3" opacity=".35">
          <path d="M 180 150 L 0 40 L 0 90 Z" /><path d="M 180 150 L 60 0 L 110 0 Z" /><path d="M 180 150 L 200 0 L 250 0 Z" />
          <path d="M 180 150 L 340 0 L 360 30 Z" /><path d="M 180 150 L 360 140 L 360 190 Z" /><path d="M 180 150 L 0 200 L 0 250 Z" />
        </g>
        <rect width="360" height="400" fill="url(#rv-dots)" />
        <ellipse cx="180" cy="388" rx="150" ry="12" fill="#000" opacity=".45" />

        {/* a reaper's scythe (Jim, 2026-11-15: "hold a staff like the grim reaper") */}
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M 246 400 L 292 40" stroke={INK} strokeWidth="13" />
          <path d="M 246 400 L 292 40" stroke="#6b4527" strokeWidth="8" />
          <path d="M 252 380 L 290 70" stroke="#9a6a3e" strokeWidth="2.5" />
          <path d="M 292 44 C 250 18 196 24 160 62 C 204 42 250 46 288 64 Z" fill="url(#rv-blade)" stroke={INK} strokeWidth="4" />
          <path d="M 270 40 C 240 32 210 36 186 50" stroke="#fff" strokeWidth="2.5" fill="none" />
          <path d="M 196 40 L 199 47 L 206 50 L 199 53 L 196 60 L 193 53 L 186 50 L 193 47 Z" fill="#fff" />
        </g>

        {/* cloak, with comic rim light */}
        <path d="M 66 400 C 70 298 102 234 180 220 C 258 234 290 298 294 400 Z" fill="#141416" stroke={INK} strokeWidth="4" />
        <path d="M 88 392 C 92 314 116 262 162 240" stroke="#3d5a80" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".9" />
        <path d="M 272 392 C 268 330 252 286 226 258" stroke="#3d5a80" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7" />
        <path d="M 180 228 L 180 400" stroke="#2a2a30" strokeWidth="3" />
        {/* hand on the axe */}
        <path d="M 252 238 C 264 230 282 236 280 252 C 278 266 258 268 250 258 Z" fill="#c08a5f" stroke={INK} strokeWidth="3.5" />
        <path d="M 258 248 L 274 246 M 258 256 L 272 256" stroke="#7e5232" strokeWidth="2" />

        {/* after the reveal he raises a trophy (Jim, 2026-11-15) */}
        <g className="reveal-trophy" strokeLinejoin="round" strokeLinecap="round">
          <path d="M 108 262 C 94 222 84 172 84 134 L 112 130 C 114 170 122 214 136 248 Z" fill="#141416" stroke={INK} strokeWidth="4" />
          <path d="M 92 240 C 86 206 82 170 86 140" stroke="#3d5a80" strokeWidth="3" fill="none" />
          <path d="M 74 54 L 126 54 C 126 80 114 96 100 98 C 86 96 74 80 74 54 Z" fill="#e8b93a" stroke={INK} strokeWidth="3.5" />
          <path d="M 74 60 C 60 60 60 80 76 82 M 126 60 C 140 60 140 80 124 82" stroke={INK} strokeWidth="3.5" fill="none" />
          <path d="M 82 60 C 82 76 88 88 96 92" stroke="#fff4cf" strokeWidth="3" fill="none" />
          <path d="M 96 98 L 104 98 L 106 112 L 94 112 Z" fill="#c8961f" stroke={INK} strokeWidth="3" />
          <rect x="86" y="110" width="28" height="8" rx="2" fill="#7a4a24" stroke={INK} strokeWidth="3" />
          <path d="M 84 118 C 86 132 112 132 114 118 C 110 128 90 128 84 118 Z" fill="#c08a5f" stroke={INK} strokeWidth="3" />
          <path d="M 100 26 L 104 38 L 116 42 L 104 46 L 100 58 L 96 46 L 84 42 L 96 38 Z" fill="#fffbe8" stroke={INK} strokeWidth="1.5" />
        </g>

        {/* the face under the hood: Uriel's look in comic ink */}
        <g className="reveal-face" strokeLinejoin="round" strokeLinecap="round">
          {/* neck */}
          <path d="M 160 196 L 200 196 L 202 232 L 158 232 Z" fill="#a8734c" stroke={INK} strokeWidth="3.5" />
          {/* ears */}
          <path d="M 132 146 C 118 142 116 170 132 178" fill="#c08a5f" stroke={INK} strokeWidth="3.5" />
          <path d="M 228 146 C 242 142 244 170 228 178" fill="#b07a52" stroke={INK} strokeWidth="3.5" />
          <path d="M 128 154 C 124 160 126 166 130 168 M 232 154 C 236 160 234 166 230 168" stroke="#7e5232" strokeWidth="2" fill="none" />
          {/* head, squarer jaw */}
          <path d="M 130 136 C 130 104 152 90 180 90 C 208 90 230 104 230 136 L 230 172 C 228 200 210 222 180 226 C 150 222 132 200 130 172 Z" fill="#c48d62" stroke={INK} strokeWidth="4" />
          {/* cel shadow on the right side */}
          <path d="M 206 96 C 222 104 230 118 230 136 L 230 172 C 228 196 214 214 196 222 C 210 196 214 160 206 96 Z" fill="#a46f48" />
          <path d="M 206 96 C 222 104 230 118 230 136 L 230 172 C 228 196 214 214 196 222 C 210 196 214 160 206 96 Z" fill="url(#rv-dotsDark)" />
          {/* full short beard into the mustache, hatched, gray at the chin */}
          <path d="M 132 160 C 134 200 154 226 180 228 C 206 226 226 200 228 160 C 224 180 214 190 204 194 C 196 184 164 184 156 194 C 146 190 136 180 132 160 Z" fill="#1d1510" stroke={INK} strokeWidth="3" />
          <path d="M 140 186 L 146 194 M 148 198 L 154 206 M 206 198 L 212 190 M 214 204 L 220 196 M 160 212 L 164 218 M 196 212 L 200 218" stroke="#4a3a2e" strokeWidth="2" />
          <path d="M 166 214 C 170 226 190 226 194 214 C 186 220 174 220 166 214 Z" fill="#9d9892" stroke={INK} strokeWidth="2" />
          <path d="M 172 218 L 174 223 M 180 219 L 180 224 M 188 218 L 186 223" stroke="#e8e5e0" strokeWidth="1.5" />
          <path d="M 150 184 C 160 172 200 172 210 184 C 200 180 192 178 180 182 C 168 178 160 180 150 184 Z" fill="#1d1510" stroke={INK} strokeWidth="2.5" />
          {/* big open grin */}
          <path d="M 150 188 C 158 214 202 214 210 188 C 196 194 164 194 150 188 Z" fill="#5a1d14" stroke={INK} strokeWidth="3" />
          <path d="M 152 190 C 164 195 196 195 208 190 L 206 197 C 194 201 166 201 154 197 Z" fill="#fff" stroke={INK} strokeWidth="1.5" />
          <path d="M 164 194 L 164 199 M 172 195 L 172 200 M 180 195 L 180 201 M 188 195 L 188 200 M 196 194 L 196 199" stroke="#9aa0a8" strokeWidth="1.3" />
          <path d="M 166 206 C 174 210 186 210 194 206" stroke="#c0574a" strokeWidth="3" fill="none" />
          {/* smile lines and cheeks */}
          <path d="M 144 164 C 140 174 142 184 148 190 M 216 164 C 220 174 218 184 212 190" stroke="#7e5232" strokeWidth="2.5" fill="none" />
          <ellipse cx="150" cy="164" rx="9" ry="5" fill="#d99a70" opacity=".7" />
          {/* nose */}
          <path d="M 180 148 C 176 160 172 168 174 172 C 178 176 186 176 190 172" stroke={INK} strokeWidth="3" fill="none" />
          <path d="M 175 170 C 177 173 179 173 180 171 M 186 171 C 187 173 189 173 190 170" stroke={INK} strokeWidth="2" fill="none" />
          <path d="M 178 152 C 176 160 175 164 176 166" stroke="#e3b08a" strokeWidth="2.5" fill="none" />
          {/* smiling eyes with crow's feet */}
          <path d="M 150 148 C 155 140 169 140 173 148 C 168 152 156 152 150 148 Z" fill="#fff" stroke={INK} strokeWidth="2.5" />
          <path d="M 187 148 C 192 140 206 140 210 148 C 205 152 193 152 187 148 Z" fill="#fff" stroke={INK} strokeWidth="2.5" />
          <circle cx="162" cy="147" r="4.5" fill="#2a170d" /><circle cx="198" cy="147" r="4.5" fill="#2a170d" />
          <circle cx="163.5" cy="145.5" r="1.5" fill="#fff" /><circle cx="199.5" cy="145.5" r="1.5" fill="#fff" />
          <path d="M 150 152 C 156 157 168 157 174 152 M 186 152 C 192 157 204 157 210 152" stroke="#7e5232" strokeWidth="2" fill="none" />
          <path d="M 144 146 L 138 144 M 144 150 L 138 152 M 216 146 L 222 144 M 216 150 L 222 152" stroke="#7e5232" strokeWidth="2" />
          {/* thick dark brows, raised */}
          <path d="M 146 134 C 154 124 168 124 176 130 L 174 136 C 166 131 156 131 148 139 Z" fill="#140e0a" stroke={INK} strokeWidth="2" />
          <path d="M 184 130 C 192 124 206 124 214 134 L 212 139 C 204 131 194 131 186 136 Z" fill="#140e0a" stroke={INK} strokeWidth="2" />
          {/* tall swept-up pompadour, faded sides */}
          <path d="M 130 112 C 128 98 132 90 140 86 L 142 108 C 136 108 132 110 130 112 Z" fill="#33281f" stroke={INK} strokeWidth="2.5" />
          <path d="M 230 112 C 232 98 228 90 220 86 L 218 108 C 224 108 228 110 230 112 Z" fill="#2b2119" stroke={INK} strokeWidth="2.5" />
          <path d="M 133 100 L 137 98 M 133 106 L 138 104 M 227 100 L 223 98 M 227 106 L 222 104" stroke="#5a4a3c" strokeWidth="1.5" />
          <path d="M 140 108 C 130 76 148 46 186 42 C 224 42 240 68 220 108 C 212 96 198 90 182 92 C 164 88 148 94 140 108 Z" fill="#17110d" stroke={INK} strokeWidth="4" />
          <path d="M 152 74 C 170 52 208 52 222 70" stroke="#5b4636" strokeWidth="4" fill="none" />
          <path d="M 146 92 C 164 70 200 70 214 86" stroke="#3e3027" strokeWidth="3.5" fill="none" />
          <path d="M 160 58 C 178 48 200 50 212 58" stroke="#7a604c" strokeWidth="2.5" fill="none" />
        </g>

        {/* the hood: over the face, lifts back on the loop */}
        <g className="reveal-hood" strokeLinejoin="round">
          <path d="M 102 232 C 88 140 110 44 180 34 C 250 44 272 140 258 232 C 240 214 220 206 180 206 C 140 206 120 214 102 232 Z" fill="#17171a" stroke={INK} strokeWidth="4" />
          <path d="M 128 216 C 122 140 142 84 180 78 C 218 84 238 140 232 216 C 216 204 200 200 180 200 C 160 200 144 204 128 216 Z" fill="#050505" />
          <path d="M 122 214 C 110 150 126 70 176 44" stroke="#3d5a80" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 180 34 C 204 38 232 56 246 90" stroke="#2f2f36" strokeWidth="4" fill="none" />
          <circle cx="164" cy="150" r="3" fill="#e6c85c" opacity=".9" />
          <circle cx="196" cy="150" r="3" fill="#e6c85c" opacity=".9" />
        </g>

        {/* SURPRISE! burst, with the reveal */}
        <g className="reveal-pow">
          <path d="M 44 70 L 62 52 L 70 70 L 92 56 L 92 78 L 114 80 L 98 94 L 112 110 L 88 108 L 84 128 L 68 112 L 52 126 L 52 104 L 30 102 L 44 90 L 28 76 Z" fill="#fff4a8" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <text x="71" y="96" textAnchor="middle" fontFamily="Bangers, Impact, sans-serif" fontSize="17" fill="#c8241a" stroke={INK} strokeWidth=".8" transform="rotate(-10 71 92)">SURPRISE!</text>
        </g>
      </svg>
  );
  if (mini) return <span className="reveal-mini" role="img" aria-label={`${manager} unmasked as the executioner`}>{art}</span>;
  return (
    <div className="reveal" role="img" aria-label={`A hooded executioner lifts the hood: it was ${manager} all along. ${champion.team} is the last team standing.`}>
      {art}
      <div className="reveal-copy">
        <small>THE LAST EXECUTIONER{season ? ` · ${season}` : ""}</small>
        <strong>It was <span>{manager}</span> all along.</strong>
        <p>{champion.team}: last team standing.</p>
      </div>
    </div>
  );
}
