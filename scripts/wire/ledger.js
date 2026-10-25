import { BENCH_SLOT, IR_SLOT } from "../lib/lineup.js";
import { DATA, currentWeek, fit, name, pts, readJson, rosterData, surname, teamNames } from "./context.js";
import { draftData } from "./roster.js";
import { RECENT_DROP_WEEKS, dropHistory, recentDrop } from "./swaps.js";

// League Wire: season ledgers of roster moves.
// - POINTS ABANDONED: the team whose players cut in the last few weeks have
//   scored the most since (drop-history.json, fetch-drops.js).
// - WAIVER WIRE MVP: the team whose pickups (waiver claims and free agents)
//   have scored the most while in its starting lineup, week by week
//   (mRoster-week-N.json from fetch-espn.js). Past weeks' rosters don't say
//   how a player was acquired, so a pickup is a starter the team didn't
//   draft, minus anyone its current roster marks as a trade.
const ABANDONED_MIN = 40;   // over the last few weeks of cuts
const WAIVER_MVP_MIN = 40;
const drafted = new Set((draftData?.draftDetail?.picks || []).map(p => `${p.teamId}:${p.playerId}`));
const traded = new Set((rosterData.teams || []).flatMap(t => (t.roster?.entries || [])
  .filter(e => String(e.acquisitionType || "").toUpperCase() === "TRADE").map(e => `${t.id}:${e.playerId}`)));

export function addAbandonedStory(add) {
  const byTeam = new Map();
  for (const d of dropHistory?.drops || []) {
    if (!teamNames.has(d.fromTeamId) || d.nowOnTeamId === d.fromTeamId || !(d.pointsSince > 0) || !recentDrop(d)) continue;
    const t = byTeam.get(d.fromTeamId) || { total: 0, players: [] };
    t.total += d.pointsSince; t.players.push(d);
    byTeam.set(d.fromTeamId, t);
  }
  const [teamId, top] = [...byTeam].sort((a, b) => b[1].total - a[1].total)[0] || [];
  if (!top || top.total < ABANDONED_MIN) return;
  const best = top.players.sort((a, b) => b.pointsSince - a.pointsSince).slice(0, 2);
  add("POINTS ABANDONED", fit(
    "🚮 POINTS ABANDONED: Players " + name(teamId) + " has cut in the last " + RECENT_DROP_WEEKS + " weeks have scored " + pts(top.total) + " since, led by " + best.map(d => surname(d.player) + " (" + pts(d.pointsSince) + ")").join(" and ") + ".",
    "🚮 POINTS ABANDONED: " + name(teamId) + "'s castoffs have scored " + pts(top.total) + " since being cut, led by " + surname(best[0].player) + ".",
    "🚮 POINTS ABANDONED: " + name(teamId) + "'s castoffs: " + pts(top.total) + " since."
  ), 58 + Math.min(12, (top.total - ABANDONED_MIN) / 10));
}

export async function addWaiverMvpStory(add) {
  const byTeam = new Map();
  for (let w = 1; w < currentWeek; w++) {
    const roster = await readJson(`${DATA}/mRoster-week-${w}.json`).catch(() => null);
    for (const t of roster?.teams || []) {
      for (const e of t.roster?.entries || []) {
        const slot = Number(e.lineupSlotId), p = e.playerPoolEntry?.player;
        const key = `${t.id}:${e.playerId}`;
        if (!p || slot === BENCH_SLOT || slot === IR_SLOT || drafted.has(key) || traded.has(key)) continue;
        const pts_ = Number((p.stats || []).find(s => Number(s.scoringPeriodId) === w && Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1)?.appliedTotal);
        if (!Number.isFinite(pts_)) continue;
        const rec = byTeam.get(Number(t.id)) || { total: 0, players: new Map() };
        rec.total += pts_;
        rec.players.set(p.fullName, (rec.players.get(p.fullName) || 0) + pts_);
        byTeam.set(Number(t.id), rec);
      }
    }
  }
  const ranked = [...byTeam].filter(([id]) => teamNames.has(id)).sort((a, b) => b[1].total - a[1].total);
  console.log("League Wire: pickup points started by team:", ranked.map(([id, r]) => `${name(id)} ${Math.round(r.total)}`).join(", ") || "none (no weekly rosters?)");
  const [teamId, top] = ranked[0] || [];
  if (!top || top.total < WAIVER_MVP_MIN) return;
  const best = [...top.players].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const runnerUp = ranked[1]?.[1]?.total || 0;
  add("WAIVER WIRE MVP", fit(
    "🛒 WAIVER WIRE MVP: " + name(teamId) + "'s pickups have put " + pts(top.total) + " into its starting lineup this season, led by " + best.map(([n, v]) => surname(n) + " (" + pts(v) + ")").join(" and ") + ".",
    "🛒 WAIVER WIRE MVP: " + name(teamId) + " has started " + pts(top.total) + " of waiver-wire points, led by " + surname(best[0][0]) + ".",
    "🛒 WAIVER WIRE MVP: " + name(teamId) + ": " + pts(top.total) + " started from pickups."
  ), 58 + Math.min(12, (top.total - runnerUp) / 5));
}
