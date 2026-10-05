import { round } from "../lib/simulation.js";
import { BENCH_SLOT } from "../lib/lineup.js";
import { clockNow, currentWeek, fit, listNames, name, nflGameByProTeam, pts, rosterData } from "./context.js";
import { shrewdSwaps } from "./swaps.js";

// League Wire: waiver-wire pickups (HOT PICKUP, FRESH OFF THE WIRE).
// Waiver-wire news: players added in the last week. Hot pickups when they're
// already producing; otherwise the freshest adds and their projections, which
// keeps the League Wire lively between games.
export const PICKUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
export function addPickupStories(add) {
  const pickups = (rosterData.teams || []).flatMap(t => (t.roster?.entries || [])
    .filter(e => e.acquisitionType === "ADD" && clockNow() - Number(e.acquisitionDate) <= PICKUP_WINDOW_MS && e.playerPoolEntry?.player)
    .map(e => {
      const player = e.playerPoolEntry.player;
      const stat = source => Number((player.stats || []).find(s => Number(s.scoringPeriodId) === currentWeek && Number(s.statSourceId) === source && Number(s.statSplitTypeId) === 1)?.appliedTotal);
      const game = nflGameByProTeam.get(Number(player.proTeamId));
      return {
        name: player.fullName,
        position: POSITIONS[Number(player.defaultPositionId)] || "",
        team: name(Number(t.id)),
        addedOn: Number(e.acquisitionDate),
        bench: Number(e.lineupSlotId) === BENCH_SLOT,
        points: Number.isFinite(stat(0)) ? round(stat(0)) : 0,
        projection: Number.isFinite(stat(1)) ? round(stat(1)) : null,
        played: Boolean(game && game.state !== "pre")
      };
    }));
  const day = ms => new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

  let shrewd = [];
  try { shrewd = shrewdSwaps().slice(0, 1).map(d => d.added.player); } catch {}
  const hot = pickups.filter(p => p.points >= 10 && !shrewd.includes(p.name)).sort((a, b) => b.points - a.points)[0];
  if (hot) {
    add("HOT PICKUP","🛒 HOT PICKUP: " + hot.team + " grabbed " + hot.name + " (" + hot.position + ") off the wire on " + day(hot.addedOn) + ", and it's paying off — " + pts(hot.points) + " this week" + (hot.bench ? " (from the bench!)" : "") + ".",30 + hot.points);
  }
  const fresh = pickups.filter(p => !p.played && p !== hot).sort((a, b) => b.addedOn - a.addedOn).slice(0, 3);
  if (fresh.length) {
    const describe = p => p.team + " added " + p.name + " (" + p.position + (p.projection != null ? ", projected " + pts(p.projection) : "") + ")";
    const versions = fresh.map((_, i) => {
      const more = fresh.length - (i + 1);
      return "🗞️ Fresh off the wire: " + listNames(fresh.slice(0, i + 1).map(describe)) + (more ? ", plus " + more + " more pickup" + (more === 1 ? "" : "s") : "") + ".";
    }).reverse();
    add("FRESH OFF THE WIRE",fit(...versions),24 + fresh.length);
  }
}
