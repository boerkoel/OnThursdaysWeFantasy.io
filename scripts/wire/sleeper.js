import { clockNow, fit, name, nflGameByProTeam, pickLine, possessive, rosterByPlayer, sleeperData } from "./context.js";

// League Wire stories from Sleeper's data (fetch-sleeper.js): PRACTICE REPORT
// (a rostered player who missed or was limited at practice) and TRENDING (the
// most-added player across Sleeper who's on our waiver wire), plus the next
// man up on a depth chart for RULED OUT.
const players = sleeperData?.players || {};
const etDay = () => new Date(clockNow()).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });

// The player behind this one on his team's depth chart (same spot, next
// order down): { id, name, roster: rosterByPlayer entry or undefined }.
export function nextManUp(espnId) {
  const me = players[espnId];
  if (!me?.depthPos || !Number.isFinite(me.depth)) return null;
  const [id, backup] = Object.entries(players)
    .filter(([, p]) => p.team === me.team && p.depthPos === me.depthPos && p.depth > me.depth)
    .sort((a, b) => a[1].depth - b[1].depth)[0] || [];
  return backup ? { id: Number(id), name: backup.name, roster: rosterByPlayer.get(Number(id)) } : null;
}

// "His backup X is on Y's bench" / "Next man up X is on waivers", for a
// player on fantasy team ownerId.
export function backupLine(espnId, ownerId) {
  const b = nextManUp(espnId);
  if (!b) return null;
  if (!b.roster) return `Next man up ${b.name} is on waivers`;
  if (b.roster.teamId === ownerId) return b.roster.starter ? `His backup ${b.name} is already in the lineup` : `His backup ${b.name} is on their own bench`;
  return b.roster.starter ? `His backup ${b.name} starts for ${name(b.roster.teamId)}` : `His backup ${b.name} is on ${possessive(name(b.roster.teamId))} bench`;
}

// "DNP" / "limited" / null from Sleeper's practice participation.
// (the participation field first, else its description).
const practiceLevel = p => /^(dnp|did not|out)/i.test(p.practice || "") || /did not participate|\bDNP\b/i.test(p.practiceNote || "") ? "DNP"
  : /^(lp|limited)/i.test(p.practice || "") || /\blimited\b/i.test(p.practiceNote || "") ? "limited" : null;

// PRACTICE REPORT: Wednesday through Saturday, before the player's game.
export function addPracticeReportStory(add) {
  if (!["Wed", "Thu", "Fri", "Sat"].includes(etDay())) return;
  const report = [...rosterByPlayer].map(([id, r]) => ({ id, r, p: players[id] }))
    .filter(({ r, p }) => p && nflGameByProTeam.get(Number(r.player.proTeamId))?.state === "pre")
    .map(x => ({ ...x, level: practiceLevel(x.p) }))
    .filter(x => x.level)
    .map(x => ({ ...x, weight: (x.level === "DNP" ? 2 : 1) + (x.r.starter ? 2 : 0) }))
    .sort((a, b) => b.weight - a.weight || a.id - b.id)[0];
  if (!report) return;
  const { r, p, level } = report;
  const who = r.player.fullName + (p.body ? ` (${p.body.toLowerCase()})` : "");
  const team = name(r.teamId);
  const did = level === "DNP" ? "didn't practice" : "was limited at practice";
  const where = r.starter ? `he's in ${possessive(team)} starting lineup` : `he's on ${possessive(team)} bench`;
  const quip = pickLine("practice:" + report.id, ["Keep a backup plan handy", "Watch the final injury report", "Sweat accordingly", "Nobody panic. Yet"]);
  add("PRACTICE REPORT", fit(
    `🩹 PRACTICE REPORT: ${who} ${did}, and ${where}. ${quip}.`,
    `🩹 PRACTICE REPORT: ${who} ${did}, and ${where}.`,
    `🩹 PRACTICE REPORT: ${r.player.fullName} ${did} (${team}).`
  ), 48 + report.weight * 7);
}

// TRENDING: Tuesday through Saturday, before Sunday's games. The wording
// never names the data source (most of the league wouldn't know it).
export function addTrendingStory(add) {
  if (!["Tue", "Wed", "Thu", "Fri", "Sat"].includes(etDay())) return;
  const hot = (sleeperData?.trending?.add || []).filter(t => players[t.id] && !rosterByPlayer.has(Number(t.id)))
    .sort((a, b) => b.count - a.count)[0];
  if (!hot) return;
  const p = players[hot.id];
  const dst = p.pos === "DEF";
  // A defense is "the Jaguars D/ST", and "they".
  const who = dst ? `the ${p.name.split(" ").slice(-1)[0]} D/ST` : `${p.name} (${p.pos}, ${p.team})`;
  const Who = who[0].toUpperCase() + who.slice(1);
  const [hes, him] = dst ? ["They're", "them"] : ["He's", "him"];
  add("TRENDING", fit(
    "📈 TRENDING: " + pickLine("trending:" + hot.id, [
      `The whole internet is adding ${who}. ${hes} on our waiver wire.`,
      `${Who} is one of the most-added players in fantasy this week. Nobody here has ${him}.`,
      `Every other league is scrambling for ${who}. Ours has ${him} sitting on waivers.`
    ]),
    `📈 TRENDING: Everyone's adding ${dst ? who : p.name}. ${hes} on our waiver wire.`
  ), 44);
}
