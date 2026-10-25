import { letter, percentiles } from "../lib/grades.js";
import { DATA, clockNow, currentScores, fit, liveTeams, listNames, name, nflGames, pickLine, pts, readJson } from "./context.js";

// League Wire: report cards (scripts/report-cards.js; Jim, 2026-10-25).
// - REPORT CARD (Tue-Thu, before Thursday's kickoff): the season's top and
//   bottom grades, with what earned them.
// - REPORT CARD WATCH (while games are on): a team trending toward a D or
//   worse this week, and the bench points behind it: the week's grade so
//   far = projected score rank 60% + lineup efficiency on settled decisions 40%.
const cards = await readJson(`${DATA}/report-cards.json`).catch(() => null);
const etDay = ms => new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
const PART_LABEL = { scoring: "scoring", startSit: "start/sit", draft: "draft", waivers: "waivers", trades: "trades", record: "record" };

export function addReportCardStory(add) {
  const season = cards?.season || [];
  if (season.length < 2 || !["Tue", "Wed", "Thu"].includes(etDay(clockNow()))) return;
  if (nflGames.some(g => g.state !== "pre")) return;   // the week has started: the live watch takes over
  const best = season[0], worst = season[season.length - 1];
  const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
  const strengths = s => Object.entries(s.parts).filter(([, p]) => p.grade).sort((a, b) => ORDER.indexOf(a[1].grade) - ORDER.indexOf(b[1].grade));
  const top2 = s => strengths(s).slice(0, 2).map(([k, p]) => `${PART_LABEL[k]} ${p.grade}`).join(", ");
  const low2 = s => strengths(s).reverse().slice(0, 2).map(([k, p]) => `${PART_LABEL[k]} ${p.grade}`).join(", ");
  const lead = pickLine("rc" + cards.throughWeek, ["📝 REPORT CARD", "📝 REPORT CARDS ARE OUT", "📝 HONOR ROLL"]);
  add("REPORT CARD", fit(
    `${lead}: Through Week ${cards.throughWeek}, ${best.team} earns an ${best.grade} (${top2(best)}); ${worst.team} gets a ${worst.grade} (${low2(worst)}). See the League tab.`,
    `${lead}: ${best.team} ${best.grade} (${top2(best)}); ${worst.team} ${worst.grade} (${low2(worst)}).`,
    `${lead}: ${best.team} ${best.grade}, ${worst.team} ${worst.grade}.`
  ), 66);
}

export function addReportCardWatchStory(add, regrets) {
  if (!currentScores.length || !nflGames.some(g => g.state !== "pre")) return;
  const rows = currentScores.map(s => {
    const r = regrets.find(x => x.teamId === s.teamId) || {};
    const started = (liveTeams.get(s.teamId)?.players || []).filter(p => p.finished && !p.bench).reduce((a, p) => a + p.actual, 0);
    const eff = started + (r.pointsLeft || 0) > 0 ? started / (started + (r.pointsLeft || 0)) * 100 : 100;
    return { s, r, eff, proj: Number(s.projectionAverage ?? s.score) };
  });
  const score = percentiles(rows.map(x => x.proj)), iq = percentiles(rows.map(x => x.eff));
  const graded = rows.map((x, i) => ({ ...x, grade: letter(0.6 * score[i] + 0.4 * iq[i]) }));
  const bad = graded.filter(x => /^[DF]/.test(x.grade) && (x.r.pointsLeft || 0) >= 8 && x.r.regretBench?.length)
    .sort((a, b) => b.r.pointsLeft - a.r.pointsLeft)[0];
  if (!bad) return;
  const bench = bad.r.regretBench.slice(0, 2).map(p => `${p.name} (${p.actual.toFixed(1)})`);
  add("REPORT CARD WATCH", fit(
    `📝 REPORT CARD WATCH: ${name(bad.s.teamId)} is trending toward a ${bad.grade} this week. Benching ${listNames(bench)} has cost ${pts(bad.r.pointsLeft)} so far.`,
    `📝 REPORT CARD WATCH: ${name(bad.s.teamId)} trending toward a ${bad.grade}: ${pts(bad.r.pointsLeft)} left on the bench.`
  ), 72);
}
