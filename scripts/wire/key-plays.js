import { round } from "../lib/simulation.js";
import { DATA, readJson } from "./context.js";

// League Wire: each matchup's key plays (key-plays.json).
export async function buildKeyPlays() {
  const plays = await readJson(`${DATA}/live-plays.json`).catch(() => ({ plays: [] }));
  return (plays.plays || [])
    .filter(play => Math.abs(Number(play.points)) >= 4)
    .sort((a, b) => {
      const aTime = a.wallclock ? new Date(a.wallclock).getTime() : 0;
      const bTime = b.wallclock ? new Date(b.wallclock).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 60)
    .map(play => ({
      id: play.id,
      matchupId: play.matchupId,
      teamId: play.fantasyTeamId,
      playerId: play.playerId,
      points: round(play.points),
      player: play.player,
      text: play.text,
      wallclock: play.wallclock || null
    }));
}
