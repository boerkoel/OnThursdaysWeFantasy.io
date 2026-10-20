import { readFile } from "node:fs/promises";
import { clockNow, fit, guillotineData, money, nflGames, pickLine } from "./context.js";

// League Wire: FRESH OBITUARY. Once this week's chopped team has its
// handwritten obituary in content/obituaries.md, the wire says so from the
// Tuesday after the chop until Thursday night's kickoff. A team whose chop is
// already locked (exactly 100%, like the Death Watch page) counts as soon as
// it's locked, Monday night included, before ESPN records the chop.
const OBITS_PATH = process.env.OBITUARIES_PATH || "content/obituaries.md";
const SHOW_FOR_MS = 4 * 24 * 60 * 60 * 1000;
const etDay = ms => new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });

export async function addObituaryStory(add) {
  const past = guillotineData?.chopped || [];
  const teams = guillotineData?.teams || [];
  const locked = teams.find(t => t.chopProbability >= 100 && !past.some(c => c.teamId === t.teamId));
  const now = clockNow();
  let chop;
  if (locked) {
    // Margin only once everyone is final; until then the gap can still change.
    const above = teams.filter(t => t !== locked).sort((a, b) => a.score - b.score)[0];
    const final = teams.every(t => !t.playersLeft);
    chop = { teamId: locked.teamId, team: locked.team, margin: final && above ? above.score - locked.score : null };
  } else {
    chop = [...past].sort((a, b) => Number(b.week) - Number(a.week))[0];
    if (!chop?.diedOn) return;
    if (now - Date.parse(chop.diedOn) > SHOW_FOR_MS || !["Tue", "Wed", "Thu"].includes(etDay(now))) return;
  }
  // Thursday night's game has started: the new week has the floor. (A locked
  // chop is this week's news, after this week's Thursday game.)
  if (!locked && nflGames.some(g => g.kickoff && etDay(Date.parse(g.kickoff)) === "Thu" && g.state !== "pre")) return;
  const markdown = await readFile(OBITS_PATH, "utf8").catch(() => "");
  const written = new Set([...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1].toLowerCase()));
  if (!written.has(String(chop.team).trim().toLowerCase())) return;
  const margin = chop.margin == null ? NaN : Number(chop.margin);
  const lead = pickLine("obit:" + chop.teamId, [
    `🪦 FRESH OBITUARY: ${chop.team} has been laid to rest`,
    `🪦 The eulogy is in: ${chop.team} gets its send-off`,
    `🪦 Gather 'round: ${chop.team}'s obituary has been posted`
  ]);
  const how = Number.isFinite(margin) ? ` (${money(margin)} pts short)` : "";
  add("FRESH OBITUARY", fit(
    `${lead}${how}. Read it on the Death Watch tab, and bring tissues.`,
    `${lead}${how}. Read it on the Death Watch tab.`,
    `${lead}. Read it on the Death Watch tab.`
  ), 92);   // high enough to always make the wire's top 8
}
