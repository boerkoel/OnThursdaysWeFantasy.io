import { BENCH_SLOT, IR_SLOT } from "../lib/lineup.js";
import { OUT, clockNow, currentWeek, fit, guillotineData, liveTeams, money, name, nflGameByProTeam, nflGames, pct, pickLine, possessive, pts, rosterData } from "./context.js";
import { kickoffLabel } from "./what-to-watch.js";

// League Wire: zombie starters and lineup alerts.
// ---- Zombie starters ---------------------------------------------------------
// A starter who's OUT, on IR, suspended or on a bye. Before kickoff: LINEUP
// ALERT (there's still time), only in the last 24 hours (earlier, injury
// tags are still settling). After: ZOMBIE STARTER, with whoever was on the
// bench. A bye only counts once Sunday's games start (until then managers
// can still swap; BYE BYE BYE covers the week's byes). Both leagues; at most
// one story each.
export const ZOMBIE_STATUS = { OUT: ["OUT", "listed OUT"], INJURY_RESERVE: ["on IR", "on injured reserve"], SUSPENSION: ["suspended", "suspended"], O: ["OUT", "listed OUT"], IR: ["on IR", "on injured reserve"], SSPD: ["suspended", "suspended"] };
export const BYE = ["on a bye", "on a bye this week"];
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
export function addZombieStories(add) {
  const whenOf = game => kickoffLabel(game.kickoff);
  const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const sundayStarted = nflGames.some(g => g.kickoff && etDay(g.kickoff) === "Sun" && g.state !== "pre");
  const zombieOf = (proTeamId, status, actual) => {
    if (actual > 0) return null;
    const game = nflGameByProTeam.get(Number(proTeamId));
    if (!game && nflGames.length) return sundayStarted ? { why: BYE, game: null, started: true } : null;
    if (game && ZOMBIE_STATUS[status]) {
      const started = game.state !== "pre";
      if (!started && Date.parse(game.kickoff) - clockNow() > ALERT_WINDOW_MS) return null;
      return { why: ZOMBIE_STATUS[status], game, started };
    }
    return null;
  };

  // Main league: starters from the roster (injury status lives there).
  const main = [];
  for (const t of rosterData.teams || []) {
    const teamId = Number(t.id);
    for (const e of t.roster?.entries || []) {
      const slot = Number(e.lineupSlotId), player = e.playerPoolEntry?.player;
      if (!player || slot === BENCH_SLOT || slot === IR_SLOT) continue;
      const live = (liveTeams.get(teamId)?.players || []).find(p => p.playerId === Number(e.playerId));
      const z = zombieOf(player.proTeamId, player.injuryStatus, live?.actual ?? 0);
      if (!z) continue;
      // Best bench option for that slot, by points if he's played, else projection.
      const bench = (liveTeams.get(teamId)?.players || []).filter(p => p.bench && p.eligibleSlots.includes(slot))
        .map(p => ({...p, value: p.game && p.game.state !== "pre" ? p.actual : (p.projection ?? 0), played: p.game && p.game.state !== "pre"}))
        .sort((a, b) => b.value - a.value)[0];
      main.push({teamId, team:name(teamId), player:player.fullName, z, bench});
    }
  }
  const m = main.sort((a, b) => Number(a.z.started) - Number(b.z.started))[0];
  if (m) {
    const [why, whyLong] = m.z.why;
    const benchNote = m.bench && m.bench.value > 0 ? (m.bench.played
      ? ", while " + m.bench.name + " put up " + pts(m.bench.actual) + " on the bench"
      : " with " + m.bench.name + " (projected " + pts(m.bench.projection ?? 0) + ") on the bench") : "";
    const key = m.team + m.player;
    if (!m.z.started) {
      add("LINEUP ALERT",fit(...pickLine(key, [
        ["🧟 LINEUP ALERT: " + m.team + " is starting " + m.player + " (" + why + "). Kickoff's " + whenOf(m.z.game) + " — plenty of time to fix it. Or don't. We'll be watching.",
         "🧟 LINEUP ALERT: " + m.team + " is starting " + m.player + " (" + why + "). Kickoff's " + whenOf(m.z.game) + ". We'll be watching."],
        ["🧟 LINEUP ALERT: " + m.player + " is " + whyLong + ", and yet there he is in " + possessive(m.team) + " starting lineup. You have until " + whenOf(m.z.game) + ".",
         "🧟 LINEUP ALERT: " + m.player + " (" + why + ") is in " + possessive(m.team) + " starting lineup. Clock's ticking."],
        ["🧟 LINEUP ALERT: Somebody wake up " + m.team + " — " + m.player + " (" + why + ") is in the lineup and kicks off " + whenOf(m.z.game) + ".",
         "🧟 LINEUP ALERT: Somebody wake up " + m.team + " — " + m.player + " (" + why + ") is in the lineup."]
      ])),88);
    } else {
      add("ZOMBIE STARTER",fit(...pickLine(key, [
        ["🧟 ZOMBIE STARTER: " + m.team + " started " + m.player + " (" + why + "). That's a 0.00 in the lineup" + benchNote + ". Bold strategy.",
         "🧟 ZOMBIE STARTER: " + m.team + " started " + m.player + " (" + why + "). That's a 0.00 in the lineup. Bold strategy."],
        ["🧟 ZOMBIE STARTER: " + m.player + " was " + whyLong + ". " + m.team + " started him anyway" + benchNote + ". Inspiring commitment.",
         "🧟 ZOMBIE STARTER: " + m.player + " was " + whyLong + ". " + m.team + " started him anyway. Inspiring commitment."],
        ["🧟 ZOMBIE STARTER: Breaking: " + m.player + " did not score for " + m.team + ". Sources say it's because he was " + whyLong + ".",
         "🧟 ZOMBIE STARTER: " + m.player + " did not score for " + m.team + ". Sources say he was " + whyLong + "."]
      ])),80);
    }
  }

  // Guillotine league: its lineups carry the injury tag.
  if (Number(guillotineData?.week) !== currentWeek) return;
  const g = (guillotineData.teams || []).flatMap(t => (t.lineup || []).map(p => ({t, p, z: zombieOf(p.proTeamId, p.injury, p.actual)})).filter(x => x.z))
    .sort((a, b) => Number(a.z.started) - Number(b.z.started) || b.t.chopProbability - a.t.chopProbability)[0];
  if (g) {
    const [why] = g.z.why;
    const player = g.p.name;
    add(g.z.started ? "DEATH WATCH ZOMBIE" : "DEATH WATCH ALERT", g.z.started
      ? pickLine(g.t.team + player, [
          "🪓🧟 " + g.t.team + " started " + player + " (" + why + ") — a 0.00 in a league where the lowest score gets chopped. " + (g.t.chopProbability <= 0 ? "Survived anyway. Somehow." : g.t.chopProbability >= 100 ? "The guillotine says thanks." : "Chop odds: " + pct(g.t.chopProbability) + "."),
          "🪓🧟 " + g.t.team + " is playing a man down with " + player + " (" + why + ") in the lineup. " + (g.t.chopProbability <= 0 ? "Lived to tell about it, somehow." : "The guillotine has noticed (" + pct(g.t.chopProbability) + ").")
        ])
      : pickLine(g.t.team + player, [
          "🪓🧟 " + g.t.team + " is starting " + player + " (" + why + ") in a league where the lowest score gets chopped. Fix it by " + whenOf(g.z.game) + ", or the guillotine thanks you for your service.",
          "🪓🧟 Bold move: " + g.t.team + " has " + player + " (" + why + ") in the lineup with " + pct(g.t.chopProbability) + " chop odds. Kickoff's " + whenOf(g.z.game) + "."
        ]), g.z.started ? 78 : 86);
  }
}
