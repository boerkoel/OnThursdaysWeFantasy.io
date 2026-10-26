// Report cards (Jim, 2026-10-25): a letter grade for every manager, graded on
// a curve against the league.
// - Season: scoring (points per week) 35%, start/sit (actual vs best possible
//   lineup) 20%, draft (points started from drafted players) 15%, waivers
//   (points started from pickups) 15%, record (win %, H2H + median) 15%.
//   Trades (points started from players acquired by trade) are graded among
//   the teams that traded, shown but not weighted. Luck (actual minus all-play
//   expected wins) is shown, not graded.
// - Weekly: each finished week, score rank 60% + lineup efficiency 40%.
// - All-time: from the record book, win % 60%, playoff rate 25%, titles 15%.
// Reads teams.json (calculate-stats.js) and record-book.json; writes
// report-cards.json for the Teams tab and the League Wire.
import { readFile, writeFile } from "node:fs/promises";
import { letter, percentiles } from "./lib/grades.js";
import { BENCH_SLOT, IR_SLOT } from "./lib/lineup.js";

const read = async p => JSON.parse(await readFile(p, "utf8"));
const teamsData = await read("data/current/teams.json");
const book = await read("data/current/record-book.json").catch(() => null);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const teams = teamsData.teams || [];

// Where each team's started points came from, week by week: drafted players,
// pickups, or players acquired by trade (mRoster-week-N; trades marked on
// the current roster, as in the League Wire's WAIVER WIRE MVP).
const draft = await read("data/current/mDraftDetail.json").catch(() => null);
const roster = await read("data/current/mRoster.json").catch(() => ({ teams: [] }));
const drafted = new Set((draft?.draftDetail?.picks || []).map(p => `${p.teamId}:${p.playerId}`));
const traded = new Set((roster.teams || []).flatMap(t => (t.roster?.entries || [])
  .filter(e => String(e.acquisitionType || "").toUpperCase() === "TRADE").map(e => `${t.id}:${e.playerId}`)));
const sources = new Map(teams.map(t => [t.id, { drafted: 0, pickups: 0, trades: 0, weeks: 0, top: { drafted: new Map(), pickups: new Map(), trades: new Map() } }]));
for (let w = 1; w <= 18; w++) {
  const r = await read(`data/current/mRoster-week-${w}.json`).catch(() => null);
  if (!r) continue;
  for (const t of r.teams || []) {
    const rec = sources.get(t.id);
    if (!rec) continue;
    rec.weeks++;
    for (const e of t.roster?.entries || []) {
      const slot = Number(e.lineupSlotId), p = e.playerPoolEntry?.player;
      if (!p || slot === BENCH_SLOT || slot === IR_SLOT) continue;
      const points = Number((p.stats || []).find(s => Number(s.scoringPeriodId) === w && Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1)?.appliedTotal);
      if (!Number.isFinite(points)) continue;
      const key = `${t.id}:${e.playerId}`;
      const kind = traded.has(key) ? "trades" : drafted.has(key) ? "drafted" : "pickups";
      rec[kind] += points;
      rec.top[kind].set(p.fullName, (rec.top[kind].get(p.fullName) || 0) + points);
    }
  }
}
const best = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => ({ player: n, points: round(v, 2) }));

// Weekly: every finished week the team has start/sit data for.
const weeks = [...new Set(teams.flatMap(t => (t.startSit?.weeks || []).map(w => w.week)))].sort((a, b) => a - b);
const weekly = {};
for (const week of weeks) {
  const rows = teams.map(t => ({ id: t.id, w: (t.startSit?.weeks || []).find(x => x.week === week) })).filter(r => r.w);
  const score = percentiles(rows.map(r => r.w.actualPoints));
  const iq = percentiles(rows.map(r => r.w.efficiency));
  rows.forEach((r, i) => {
    const total = 0.6 * score[i] + 0.4 * iq[i];
    (weekly[r.id] ||= []).push({ week, grade: letter(total), score: round(total), points: r.w.actualPoints,
      efficiency: r.w.efficiency, pointsLeft: r.w.pointsLeft, lostToMistake: Boolean(r.w.winLostToMistake) });
  });
}

// Season.
const games = t => Math.max(1, (t.startSit?.weeks || []).length);
const scoring = percentiles(teams.map(t => (t.startSit?.actualPoints || 0) / games(t)));
const iq = percentiles(teams.map(t => t.startSit?.score ?? t.profileAnalytics?.optimalLineup?.efficiency ?? 0));
const record = percentiles(teams.map(t => {
  const s = t.standings || {};
  return (s.wins || 0) / Math.max(1, (s.wins || 0) + (s.losses || 0));
}));
const per = (t, k) => { const r = sources.get(t.id); return r && r.weeks ? r[k] / r.weeks : 0; };
const haveRosters = [...sources.values()].some(r => r.weeks);
const draftP = percentiles(teams.map(t => per(t, "drafted")));
const waiverP = percentiles(teams.map(t => per(t, "pickups")));
// Trades: teams that traded are curved among themselves (C+ to A+). Teams that
// never traded while win-win trades existed for them (the Trades card's
// hindsight swaps) are marked down by the wins they passed up (Jim, 2026-10-25),
// scaled by need (Jim, 2026-10-25: contenders didn't have to make moves): need =
// 1 − playoff odds, so a lock stays at a neutral C+ and a team out of it drops to
// D/F (25 − 8 per win passed up). No helpful trade available = no grade.
const traders = teams.filter(t => per(t, "trades") > 0);
const tradersP = percentiles(traders.map(x => per(x, "trades")));
const tradeScore = new Map(traders.map((t, i) => [t.id, 45 + 0.55 * tradersP[i]]));
const missedWins = t => Math.max(0, ...(t.profileAnalytics?.winWinTrades || []).filter(x => x.perspective === "A" || x.yourWinsAdded != null)
  .map(x => Number(x.yourWinsAdded) || 0));
const seasonOdds = await read("data/current/season-odds.json").catch(() => null);
const NEUTRAL = 46;   // C+ (with room): stood pat, didn't need to move
const need = t => { const o = (seasonOdds?.teams || []).find(x => Number(x.teamId) === Number(t.id)); return o?.playoffOdds == null ? 1 : 1 - o.playoffOdds / 100; };
for (const t of teams) if (!tradeScore.has(t.id) && missedWins(t) > 0)
  tradeScore.set(t.id, NEUTRAL - (NEUTRAL - Math.max(0, 25 - 8 * missedWins(t))) * need(t));
const season = teams.map((t, i) => {
  const total = haveRosters
    ? 0.35 * scoring[i] + 0.2 * iq[i] + 0.15 * draftP[i] + 0.15 * waiverP[i] + 0.15 * record[i]
    : 0.5 * scoring[i] + 0.3 * iq[i] + 0.2 * record[i];
  const src = sources.get(t.id);
  const luck = t.profileAnalytics?.luck;
  return {
    teamId: t.id, team: t.name, grade: letter(total), score: round(total),
    parts: {
      scoring: { grade: letter(scoring[i]), value: round((t.startSit?.actualPoints || 0) / games(t), 2), label: "pts / week" },
      startSit: { grade: letter(iq[i]), value: round(t.startSit?.score ?? 0), label: "% of the best lineup", pointsLeft: round(t.startSit ? t.startSit.optimalPoints - t.startSit.actualPoints : 0, 2) },
      ...(haveRosters ? {
        draft: { grade: letter(draftP[i]), value: round(per(t, "drafted"), 2), label: "pts / week started from draft picks", top: best(src.top.drafted) },
        waivers: { grade: letter(waiverP[i]), value: round(per(t, "pickups"), 2), label: "pts / week started from pickups", top: best(src.top.pickups) },
        trades: per(t, "trades") > 0
          ? { grade: letter(tradeScore.get(t.id)), value: round(per(t, "trades"), 2), label: "pts / week started from trade acquisitions", top: best(src.top.trades) }
          : tradeScore.has(t.id)
            ? { grade: letter(tradeScore.get(t.id)), value: 0, label: `no trades, but passed up a swap worth +${missedWins(t)} win${missedWins(t) === 1 ? "" : "s"}${need(t) < 0.25 ? " (a contender: little need to deal)" : need(t) > 0.75 ? " (and needed the help)" : ""}`, missedWins: missedWins(t), need: round(need(t) * 100) }
            : { grade: null, label: "no trades (none would have helped)" }
      } : {}),
      record: { grade: letter(record[i]), value: `${t.standings?.wins ?? 0}-${t.standings?.losses ?? 0}` }
    },
    luck: luck ? round(luck.difference, 2) : null,
    weekly: weekly[t.id] || []
  };
}).sort((a, b) => b.score - a.score);

// All-time, by manager (record book), for the current teams.
let allTime = [];
if (book?.managers?.length) {
  const labels = book.managerLabels || {};
  const managers = book.managers.filter(m => m.seasons > 0);
  const wp = percentiles(managers.map(m => m.winPct));
  const po = percentiles(managers.map(m => (m.playoffAppearances || 0) / m.seasons));
  const ti = percentiles(managers.map(m => (m.titles || 0) / m.seasons));
  const byLabel = new Map(managers.map((m, i) => [m.manager, { m, total: 0.6 * wp[i] + 0.25 * po[i] + 0.15 * ti[i] }]));
  allTime = Object.entries(book.currentTeamManagers || {}).map(([teamId, key]) => {
    const hit = byLabel.get(labels[key]) || byLabel.get(teams.find(t => String(t.id) === teamId)?.name);
    return hit && { teamId: Number(teamId), manager: hit.m.manager, grade: letter(hit.total), score: round(hit.total),
      seasons: hit.m.seasons, winPct: hit.m.winPct, titles: hit.m.titles || 0, playoffs: hit.m.playoffAppearances || 0 };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

await writeFile("data/current/report-cards.json", JSON.stringify({
  updatedAt: new Date().toISOString(), throughWeek: weeks[weeks.length - 1] ?? null,
  weights: { season: haveRosters ? "scoring 35%, start/sit 20%, draft 15%, waivers 15%, record 15% (trades shown, not weighted)" : "scoring 50%, start/sit 30%, record 20%", weekly: "score rank 60%, lineup efficiency 40%", allTime: "win % 60%, playoff rate 25%, titles 15%" },
  season, allTime
}, null, 2) + "\n");
console.log(`Report cards through Week ${weeks[weeks.length - 1]}: ${season.map(s => `${s.team.split(" ")[0]} ${s.grade}`).join(", ")}.`);
