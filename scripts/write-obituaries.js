import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

// Writes a short, affectionate obituary for each team chopped from the
// guillotine side league, once. Runs in the daily ESPN update; obituaries are
// committed to data/current/obituaries.json and never regenerated. Needs the
// ANTHROPIC_API_KEY repository secret; without it, this does nothing.
const OBITUARIES_PATH = "data/current/obituaries.json";
const MODEL = "claude-opus-5";

const season = process.env.ESPN_SEASON || "2026";
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const guillotine = JSON.parse(await readFile("data/current/guillotine.json", "utf8"));
const existing = await readFile(OBITUARIES_PATH, "utf8").then(JSON.parse).catch(() => ({ obituaries: [] }));
const written = new Set(existing.obituaries.map(o => `${o.teamId}-${o.week}`));
const pending = (guillotine.chopped || []).filter(c => !written.has(`${c.teamId}-${c.week}`));

if (!pending.length) {
  console.log("No new obituaries to write.");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(`Skipping ${pending.length} obituaries: ANTHROPIC_API_KEY is not set.`);
  process.exit(0);
}

const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${guillotine.leagueId}`;

// The team's lineup in its final week (the league is public on ESPN).
async function finalLineup(teamId, week) {
  const url = new URL(base);
  url.searchParams.set("view", "mRoster");
  url.searchParams.set("scoringPeriodId", String(week));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } });
  if (!response.ok) return [];
  const data = await response.json();
  const entries = (data.teams || []).find(t => Number(t.id) === Number(teamId))?.roster?.entries || [];
  const stat = (player, source) => Number((player?.stats || []).find(s =>
    Number(s.scoringPeriodId) === Number(week) && Number(s.statSourceId) === source && Number(s.statSplitTypeId) === 1
  )?.appliedTotal);
  return entries
    .filter(e => e.playerPoolEntry?.player && Number(e.lineupSlotId) !== 21)
    .map(e => {
      const player = e.playerPoolEntry.player;
      return {
        name: player.fullName,
        bench: Number(e.lineupSlotId) === 20,
        points: round(Number.isFinite(stat(player, 0)) ? stat(player, 0) : 0),
        projected: Number.isFinite(stat(player, 1)) ? round(stat(player, 1)) : null
      };
    });
}

function factsFor(chop, lineup) {
  const starters = lineup.filter(p => !p.bench);
  const bench = lineup.filter(p => p.bench);
  const byPoints = list => [...list].sort((a, b) => b.points - a.points);
  const busts = starters.filter(p => p.projected != null).sort((a, b) => (a.points - a.projected) - (b.points - b.projected));
  return {
    team: chop.team,
    league: guillotine.leagueName,
    bornOn: guillotine.draftDate ? guillotine.draftDate.slice(0, 10) : null,
    diedOn: chop.diedOn ? chop.diedOn.slice(0, 10) : null,
    choppedInWeek: chop.week,
    finalScore: chop.finalScore,
    fellShortOf: chop.survivedBy ? `${chop.survivedBy.team} (${chop.survivedBy.score})` : null,
    marginOfDefeat: chop.margin,
    topStarter: byPoints(starters)[0] || null,
    biggestDisappointment: busts[0] || null,
    bestBenchPlayer: byPoints(bench)[0] || null,
    starters: byPoints(starters)
  };
}

const SYSTEM = `You write obituaries for fantasy football teams eliminated from a guillotine league, where the lowest-scoring team each week is chopped. The league is a group of friends and the obituaries run on their league website.

Write in the voice of a small-town newspaper obituary: warm, wry and affectionate, a gentle roast of the team's fantasy decisions and bad luck. Use the facts provided (birth and death dates, final score, who it fell short of, standout and disappointing players, points left on the bench) and don't invent statistics. Players are real NFL players: joke only about their fantasy output, never their personal lives, injuries or health. Keep it PG-13 and free of real-world tragedy.

Length: 90 to 140 words, one or two paragraphs of plain text, no headline, no markdown. End with a short line in the style of "In lieu of flowers, ..." or "Services will be held ...".`;

const client = new Anthropic();
for (const chop of pending) {
  const facts = factsFor(chop, await finalLineup(chop.teamId, chop.week));
  try {
    // Server-side fallback retries on Anthropic's recommended model if the
    // request is declined by a safety classifier.
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `Write the obituary for this team.\n\n${JSON.stringify(facts, null, 2)}` }]
    });
    if (response.stop_reason === "refusal") {
      console.warn(`Obituary for ${chop.team} was declined; will retry next run.`);
      continue;
    }
    const text = response.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
    if (!text) continue;
    existing.obituaries.push({
      teamId: chop.teamId,
      team: chop.team,
      week: chop.week,
      text,
      model: response.model,
      generatedAt: new Date().toISOString()
    });
    console.log(`Wrote obituary for ${chop.team} (week ${chop.week}).`);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.warn("Obituaries skipped: the Anthropic API key was rejected.");
      break;
    } else if (error instanceof Anthropic.RateLimitError) {
      console.warn("Obituaries paused: rate limited; will retry next run.");
      break;
    } else if (error instanceof Anthropic.APIError) {
      console.warn(`Obituary for ${chop.team} failed (${error.status}): ${error.message}`);
    } else {
      throw error;
    }
  }
}

await writeFile(OBITUARIES_PATH, JSON.stringify(existing, null, 2) + "\n");
