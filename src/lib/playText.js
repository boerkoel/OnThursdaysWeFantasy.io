// Short play text for key plays (Jim, 2026-11-02): ESPN's play-by-play line boiled down to what happened to
// the fantasy player, e.g. "40-yd TD run", "18-yd catch", "24-yd TD pass to M.Golden", "INT", "48-yd FG".
// The full line stays available as a tooltip.
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
const lastName = name => String(name || "").split(/\s+/).filter(w => !SUFFIX.test(w)).pop() || "";
const yds = text => { const m = text.match(/for (-?\d+) yards?|for no gain|(\d+) Yd/i); return m ? Number(m[1] ?? m[2] ?? 0) : null; };

export function shortPlay(play) {
  const full = String(play?.text || "");
  if (!full || play.news) return full;
  const last = lastName(play.player);
  // The play itself: no formation tags, eligibility reports, injury notes, extra point, two-point try, replay or penalty.
  const clean = full.replace(/^\((Shotgun|No Huddle[^)]*|Pistol)\)\s*/i, "").replace(/^.*?reported in as eligible\.\s*/i, "").replace(/^Direct snap to [^.]+\.\s*/i, "");
  const text = clean.split(/\s*(?:TWO-POINT CONVERSION|The Replay Official|\*\*|\b[A-Z]\.\s?\S+ extra point|\.?\s*PENALTY on|\.?Penalty on|[A-Z][a-z]+(?: [A-Z][a-z]+)* challenged)/)[0];
  const noPlay = /No Play|NULLIFIED/i.test(full) ? " (no play)" : "";
  const td = /TOUCHDOWN|\bYd (pass|run|rush|return)\b/i.test(text) && !noPlay;
  const n = yds(text);
  const yd = n == null ? "" : n === 0 ? "no-gain " : `${n}-yd `;
  const tryPart = full.match(/TWO-POINT CONVERSION ATTEMPT\.(.*?ATTEMPT (SUCCEEDS|FAILS))/i);
  const twoPt = tryPart && /SUCCEEDS/i.test(tryPart[2]) ? " +2" : "";
  // Scored only the two-point try (a catch or run on the conversion, not the touchdown).
  if (tryPart && last && tryPart[1].includes(last) && !text.includes(last)) return /SUCCEEDS/i.test(tryPart[2]) ? "2-pt conversion" : "2-pt try failed";
  const isDefense = /D\/ST/.test(play.player || "");

  if (/field goal/i.test(text)) { const m = text.match(/(\d+) yard field goal is (GOOD|No Good|BLOCKED)/i); return m ? `${m[1]}-yd FG${/good/i.test(m[2]) && !/no good/i.test(m[2]) ? "" : " missed"}` : "FG"; }
  if (/extra point/i.test(text) && !td && !/pass|rush|left end|right end|up the middle|guard|tackle/i.test(text)) return /GOOD/i.test(text) ? "XP" : "XP missed";
  if (isDefense) {
    if (/INTERCEPTED/i.test(text)) return `INT${td ? " TD" : ""}${noPlay}`;
    if (/sacked/i.test(text)) return `sack${noPlay}`;
    if (/FUMBLE/i.test(text)) return `fumble recovery${td ? " TD" : ""}`;
    if (td) return "TD allowed";
    return `${yd}${/punt|kick/i.test(text) ? "return" : "play"}`.trim();
  }
  if (/Yd pass from/i.test(text)) return `${yd}TD catch`;
  const passer = !!last && (text.match(/^([A-Z][a-z]?\.\s?\S+) pass/)?.[1] || "").includes(last);
  if (/INTERCEPTED/i.test(text)) return (passer ? "INT thrown" : "targeted, INT") + noPlay;
  if (/sacked/i.test(text)) return `sacked${n != null && n < 0 ? ` (${n})` : ""}${noPlay}`;
  if (/FUMBLES/i.test(text)) return `${yd}fumble${/RECOVERED by/i.test(text) ? "" : ""}`.trim() + noPlay;
  if (/pass/i.test(text)) {
    if (/incomplete/i.test(text)) return "incomplete" + noPlay;
    if (passer) { const to = text.match(/ to ([A-Z][a-z]?\.\s?[A-Za-z'-]+(?:\.\s[A-Z][a-z]+)?)/)?.[1]; return `${yd}${td ? "TD " : ""}pass${to ? ` to ${to.replace(/\s/, "")}` : ""}${twoPt}${noPlay}`; }
    return `${yd}${td ? "TD " : ""}catch${twoPt}${noPlay}`;
  }
  if (/kneels/i.test(text)) return "kneel";
  if (/punt|kicks/i.test(text) && /return/i.test(text)) return `${yd}${td ? "TD " : ""}return`;
  if (n != null) return `${yd}${td ? "TD " : ""}run${twoPt}${noPlay}`;
  if (/TWO-POINT/i.test(text)) return /SUCCEEDS/i.test(text) ? "2-pt conversion" : "2-pt try failed";
  // Fallback: the first sentence without tacklers, capped.
  const first = text.split(/\.\s/)[0].replace(/\s*\(.*?\)/g, "");
  return first.length > 60 ? first.slice(0, 57) + "…" : first;
}

// "45→53%": a play's odds move, from the share after the play and the shift it caused.
export const oddsMove = (now, shift) => `${Math.round(now - shift)}→${Math.round(now)}%`;
