import { readFile, writeFile } from "node:fs/promises";

// FantasyPros "Are They Playing?": a free model that turns each injured
// player's practice reports into a chance to play this week. The page embeds
// the list as JSON (injuredPlayers: [...]); we keep name, team, status,
// practices and the chance. The weekly simulation uses it to fade starters who
// probably won't suit up. Live runs call this too, so it skips the download
// when the saved copy is under MAX_AGE_MS old (FORCE=1 to override).
const URL = "https://www.fantasypros.com/nfl/myplaybook/are-they-playing.php";
const FILE = "data/current/play-chance.json";
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

const previous = await readFile(FILE, "utf8").then(JSON.parse).catch(() => null);
if (previous && !process.env.FORCE && Date.now() - Date.parse(previous.fetchedAt) < MAX_AGE_MS) {
  console.log(`Play chances are fresh (${previous.fetchedAt}); skipping.`);
  process.exit(0);
}

try {
  const response = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const html = await response.text();
  const at = html.indexOf("injuredPlayers:");
  if (at < 0) throw new Error("injuredPlayers list not found on the page");
  const start = html.indexOf("[", at);
  // Walk to the matching bracket (strings may contain brackets).
  let depth = 0, inString = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) { if (ch === "\\") i++; else if (ch === "\"") inString = false; continue; }
    if (ch === "\"") inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const list = JSON.parse(html.slice(start, end));
  const players = list.map(p => ({
    name: p.name, team: p.teamId, position: p.position, status: p.statusShort || p.status || "",
    chance: p.playChance == null ? null : Number(p.playChance),
    practices: (p.practices || []).map(x => x.status || null)
  })).filter(p => p.name && p.team);
  if (players.length < 20) throw new Error(`only ${players.length} players parsed; keeping the previous file`);
  await writeFile(FILE, JSON.stringify({ source: "FantasyPros Are They Playing?", url: URL, fetchedAt: new Date().toISOString(), players }, null, 1) + "\n");
  console.log(`Play chances: ${players.length} injured players, ${players.filter(p => p.chance != null).length} with a chance to play.`);
} catch (error) {
  console.warn(`Play-chance fetch skipped: ${error.message}${previous ? " (keeping the previous file)" : ""}`);
}
