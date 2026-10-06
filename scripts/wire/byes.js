import { BENCH_SLOT, IR_SLOT } from "../lib/lineup.js";
import { currentWeek, fit, guillotineData, listNames, name, nflGameByProTeam, nflGames, pct, pickLine, possessive, rosterData, surname } from "./context.js";

// League Wire: BYE BYE BYE. The team losing the most starters to byes this
// week (and the guillotine team most hurt by them), from Tuesday until
// Sunday's games start, while there's still time to do something about it.
const short = full => /D\/ST/.test(full) ? full : surname(full);
const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });

export function addByeStories(add) {
  if (!nflGames.length || nflGames.some(g => g.kickoff && etDay(g.kickoff) === "Sun" && g.state !== "pre")) return;
  const onBye = proTeamId => !nflGameByProTeam.get(Number(proTeamId));

  // Main league: current starters on a bye.
  const hit = (rosterData.teams || []).map(t => {
    const players = (t.roster?.entries || []).filter(e => e.playerPoolEntry?.player && Number(e.lineupSlotId) !== IR_SLOT && onBye(e.playerPoolEntry.player.proTeamId));
    const starters = players.filter(e => Number(e.lineupSlotId) !== BENCH_SLOT).map(e => e.playerPoolEntry.player.fullName);
    return { team: name(Number(t.id)), starters, total: players.length };
  }).filter(x => x.starters.length >= 2).sort((a, b) => b.starters.length - a.starters.length || b.total - a.total);
  if (hit.length) {
    const top = hit[0], n = top.starters.length, others = hit.slice(1).map(x => x.team);
    const who = listNames(top.starters.map(short));
    const lead = n >= 3 ? pickLine("byemageddon:" + top.team, ["💥 BYE-MAGEDDON", "🎤 BYE BYE BYE", "💥 BYE-MAGEDDON"]) : "🎤 BYE BYE BYE";
    const quip = pickLine("bye:" + top.team, ["Time to work the waiver wire", "Hope the bench is ready", "Somebody call *NSYNC"]);
    add("BYE BYE BYE", fit(
      `${lead}: ${top.team} has ${n} starters on bye this week (${who}).${others.length ? ` ${listNames(others)} ${others.length === 1 ? "is" : "are"} feeling it too.` : ""} ${quip}.`,
      `${lead}: ${top.team} has ${n} starters on bye this week (${who}). ${quip}.`,
      `${lead}: ${top.team} has ${n} starters on bye this week (${who}).`,
      `${lead}: ${top.team} has ${n} starters on bye this week.`
    ), 50 + 6 * n);
  }

  // Guillotine league: the most-at-risk team with starters on bye.
  if (Number(guillotineData?.week) !== currentWeek) return;
  const g = (guillotineData.teams || []).map(t => ({ t, out: (t.lineup || []).filter(p => onBye(p.proTeamId)).map(p => p.name) }))
    .filter(x => x.out.length >= 2).sort((a, b) => b.t.chopProbability - a.t.chopProbability || b.out.length - a.out.length)[0];
  if (g) {
    add("DEATH WATCH BYE", fit(
      `🪓🎤 Bye bye bye: ${g.t.team} has ${g.out.length} starters on bye (${listNames(g.out.map(short))}) and ${pct(g.t.chopProbability)} chop odds. The guillotine loves a short-handed lineup.`,
      `🪓🎤 Bye bye bye: ${g.t.team} has ${g.out.length} starters on bye and ${pct(g.t.chopProbability)} chop odds.`
    ), 48 + g.out.length * 4);
  }
}
