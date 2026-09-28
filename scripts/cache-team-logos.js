import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

// Copies team logos into the site. Custom-uploaded ESPN logos can't be
// hotlinked (they return 401 outside ESPN), so they're downloaded here, using
// the ESPN session cookies when available. Runs in the daily update for the
// main league and the guillotine side league.
const season = process.env.ESPN_SEASON || "2026";
const guillotineLeagueId = process.env.GUILLOTINE_LEAGUE_ID || "687798070";
const cookie = process.env.ESPN_S2 && process.env.ESPN_SWID
  ? `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`
  : null;

// If a download fails, keep any logo already in the folder (including one
// saved there by hand as team-<id>.png/.jpg/.svg/.webp).
async function existingLogo(folder, teamId) {
  const files = await readdir(`public/${folder}`).catch(() => []);
  const file = files.find(f => new RegExp(`^team-${teamId}\\.(png|jpe?g|svg|webp)$`).test(f));
  return file ? `/OnThursdaysWeFantasy.io/${folder}/${file}` : null;
}

async function cacheLogos(teams, folder, mapFile) {
  await mkdir(`public/${folder}`, { recursive: true });
  const logoMap = {};
  for (const team of teams) {
    if (!team.logo) continue;
    const fallback = await existingLogo(folder, team.id);
    if (fallback) logoMap[String(team.id)] = fallback;
    try {
      const response = await fetch(team.logo, {
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "User-Agent": "OnThursdaysWeFantasy/1.0",
          Referer: "https://fantasy.espn.com/",
          ...(cookie ? { Cookie: cookie } : {})
        }
      });
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok || !contentType.startsWith("image/")) {
        console.warn(`Could not cache logo for ${team.name} (${folder}): ${response.status} ${contentType}`);
        continue;
      }
      const ext = contentType.includes("svg") ? "svg"
        : contentType.includes("webp") ? "webp"
        : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
        : "png";
      await writeFile(`public/${folder}/team-${team.id}.${ext}`, Buffer.from(await response.arrayBuffer()));
      logoMap[String(team.id)] = `/OnThursdaysWeFantasy.io/${folder}/team-${team.id}.${ext}`;
    } catch (error) {
      console.warn(`Could not cache logo for ${team.name} (${folder}): ${error.message}`);
    }
  }
  await writeFile(mapFile, JSON.stringify(logoMap, null, 2) + "\n");
  console.log(`Cached ${Object.keys(logoMap).length} of ${teams.length} logos in public/${folder}.`);
}

const mainTeams = JSON.parse(await readFile("data/current/mTeam.json", "utf8")).teams || [];
await cacheLogos(mainTeams, "team-logos", "data/current/logo-map.json");

// The guillotine league is public, so its team list needs no cookies.
try {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${guillotineLeagueId}?view=mTeam`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const guillotineTeams = (await response.json()).teams || [];
  await cacheLogos(guillotineTeams, "guillotine-logos", "data/current/guillotine-logo-map.json");
} catch (error) {
  console.warn(`Guillotine logos skipped: ${error.message}`);
}
