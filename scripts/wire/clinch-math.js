import { DATA, currentScores, currentWeek, currentWeekMatchups, fit, name, readJson, standingsData } from "./context.js";
import { mathStatus } from "../lib/clinch.js";

// League Wire: the math (Jim, 2026-11-09: "which teams could be officially mathematically eliminated", "magic
// numbers is a nice touch"). Sure things from lib/clinch.js, for a playoff spot and a first-round bye:
// - ✅ CLINCHED / ❌ ELIMINATED: it happened this week (locked results count; open ones could go either way);
// - 🔢 MAGIC NUMBER: the wins that clinch no matter what anyone else does, when it's 4 or fewer;
// - ⚠️ ELIMINATION WATCH: a team that could be officially out of the playoff race as soon as next week.
const settings = (await readJson(`${DATA}/mSettings.json`).catch(() => null))?.settings?.scheduleSettings;
const REGULAR_WEEKS = Number(settings?.matchupPeriodCount) || 14;
const SPOTS = Number(settings?.playoffTeamCount) || 6, BYES = 2;
const MAGIC_SHOWN = 4;

const opponentOf = id => {
  const m = currentWeekMatchups.find(g => [g.homeTeamId, g.awayTeamId].map(Number).includes(Number(id)));
  return m ? name(Number(Number(m.homeTeamId) === Number(id) ? m.awayTeamId : m.homeTeamId)) : null;
};

export function addMathStory(add) {
  const standings = standingsData?.standings || [];
  if (!standings.length || currentWeek > REGULAR_WEEKS) return;
  const played = Math.max(...standings.map(t => Number(t.games) || 0));
  const inWeek = played < currentWeek;   // this week isn't in the standings yet
  const results = id => { const s = currentScores.find(x => x.teamId === Number(id)); return s ? [Number(s.winProbability), Number(s.aboveMedianProbability)] : null; };
  const before = standings.map(t => ({ teamId: t.id, wins: Number(t.wins), open: inWeek ? 2 : 0 }));
  const now = standings.map(t => {
    const r = inWeek ? results(t.id) : null;
    return r ? { teamId: t.id, wins: Number(t.wins) + r.filter(p => p >= 99.5).length, open: r.filter(p => p > 0.5 && p < 99.5).length } : before.find(b => b.teamId === t.id);
  });
  const gamesLeft = 2 * (REGULAR_WEEKS - Math.max(played, inWeek ? currentWeek : played));
  const out = [];
  for (const [spots, what, weight] of [[SPOTS, "a playoff spot", 1], [BYES, "a first-round bye", 0.85]]) {
    const was = mathStatus({ teams: before, gamesLeft, spots }), is = mathStatus({ teams: now, gamesLeft, spots });
    for (const t of now) {
      const r = is.get(t.teamId), w = was.get(t.teamId), team = name(t.teamId);
      if (r.clinched && !w.clinched) {
        out.push({ type: "CLINCHED", score: 95 * weight, text: `✅ CLINCHED: ${team} has officially clinched ${what}. No one can catch them now.` });
      } else if (r.eliminated && !w.eliminated) {
        out.push({ type: "ELIMINATED", score: 92 * weight, text: `❌ ELIMINATED: ${team} is officially out of the race for ${what}. The math has spoken.` });
      } else if (!r.clinched && r.magic != null && r.magic <= MAGIC_SHOWN) {
        const opp = opponentOf(t.teamId);
        const plural = r.magic === 1 ? "win" : "wins";
        const thisWeek = r.magic <= t.open
          ? (r.magic === 2 ? ` A sweep this week${opp ? ` (beat ${opp} and the median)` : ""} does it.` : ` One more win this week${opp ? ` (over ${opp} or the median)` : ""} does it.`)
          : "";
        out.push({ type: "MAGIC NUMBER", score: (thisWeek ? 88 : 66) * weight,
          text: fit(`🔢 MAGIC NUMBER: ${team} clinches ${what} with ${r.magic} more ${plural}, no matter what anyone else does.${thisWeek}`,
            `🔢 MAGIC NUMBER: ${team} clinches ${what} with ${r.magic} more ${plural}.${thisWeek}`) });
      } else if (spots === SPOTS && !r.eliminated && r.soonest === 1) {   // the bye race has its own watch (stock.js)
        out.push({ type: "ELIMINATION WATCH", score: 72 * weight,
          text: fit(`⚠️ ELIMINATION WATCH: ${team} could be officially out of the race for ${what} as soon as next week, with two more losses and the teams above them winning.`,
            `⚠️ ELIMINATION WATCH: ${team} could be officially out of the race for ${what} as soon as next week.`) });
      }
    }
  }
  out.sort((a, b) => b.score - a.score).slice(0, 3).forEach(x => add(x.type, x.text, Math.round(x.score)));
}
