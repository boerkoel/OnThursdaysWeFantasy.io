import { clockNow, currentScores, currentWeek, fit, guillotineData, nflGames } from "./context.js";
import { rateGames } from "../lib/game-drama.js";
import { lineOfGame } from "./lines.js";
import { survivorPicks } from "./survivor.js";

// League Wire: MUST-WATCH (Jim, 2026-10-31). The NFL game with the most 🔥 drama for the league (the Games
// tab's index, scripts/lib/game-drama.js): before a slate, the top game kicking off in the next 30 hours;
// during games, a live game at 65+ drama. Opens the Games tab.
const AHEAD_MS = 30 * 60 * 60 * 1000;
const LIVE_MIN = 65;
const when = iso => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";

export function addMustWatchStory(add) {
  if (!nflGames.length) return;
  const guillotineTeams = Number(guillotineData?.week) === currentWeek ? guillotineData.teams || [] : [];
  const rated = rateGames({ games: nflGames, scores: currentScores, guillotineTeams, svPicks: survivorPicks(), lineOf: lineOfGame });
  const live = rated.filter(r => r.g.state === "in" && r.drama >= LIVE_MIN).sort((a, b) => b.drama - a.drama)[0];
  const r = live || rated.filter(r => r.g.state === "pre" && Date.parse(r.g.kickoff) - clockNow() <= AHEAD_MS).sort((a, b) => b.drama - a.drama)[0];
  if (!r) return;
  const game = `${r.away.abbrev} @ ${r.home.abbrev}`;
  const head = live ? `🔥 MUST-WATCH NOW: ${game} (${r.away.score}-${r.home.score}, ${r.g.detail})` : `🔥 MUST-WATCH: ${game}, ${when(r.g.kickoff)}`;
  const [a, b] = r.reasons;
  add("MUST-WATCH", fit(
    `${head}. ${[a, b].filter(Boolean).join(". ")}.`,
    `${head}. ${a || ""}${a ? "." : ""}`,
    `${head}: drama ${r.drama}/100.`
  ), live ? Math.min(90, 70 + Math.round((r.drama - LIVE_MIN) / 2)) : 72);
}
