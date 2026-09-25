import { mkdir, writeFile } from "node:fs/promises";

const teamData = JSON.parse(await readFile("data/current/mTeam.json", "utf8"));
await mkdir("public/team-logos", { recursive: true });

const logoMap = {};

for (const team of teamData.teams || []) {
  if (!team.logo) continue;

  try {
    const response = await fetch(team.logo, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "OnThursdaysWeFantasy/1.0",
        Referer: "https://fantasy.espn.com/"
      }
    });

    if (!response.ok) {
      console.warn(`Could not cache logo for team ${team.id}: ${response.status}`);
      continue;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const ext = contentType.includes("svg") ? "svg"
      : contentType.includes("webp") ? "webp"
      : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
      : "png";

    const path = `public/team-logos/team-${team.id}.${ext}`;
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    logoMap[String(team.id)] = `/OnThursdaysWeFantasy.io/team-logos/team-${team.id}.${ext}`;
    console.log(`Cached logo for ${team.name} -> ${path}`);
  } catch (error) {
    console.warn(`Could not cache logo for team ${team.id}: ${error.message}`);
  }
}

await writeFile("data/current/logo-map.json", JSON.stringify(logoMap, null, 2) + "\n");
console.log(`Cached ${Object.keys(logoMap).length} team logos.`);

async function readFile(path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}
