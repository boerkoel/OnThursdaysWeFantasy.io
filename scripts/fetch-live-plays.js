import { readFile, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const includeCompleted = process.env.ESPN_INCLUDE_COMPLETED === "true";

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" }
  });
  if (!response.ok) throw new Error(`ESPN request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

const matchup = await readJson("data/current/mMatchup.json");
const boxscore = await readJson("data/current/mBoxscore.json");
const settings = await readJson("data/current/mSettings.json");
const currentWeek = Number(matchup?.scoringPeriodId || 1);

const previous = await readJson("data/current/live-plays.json", { week: currentWeek, updatedAt: null, plays: [] });

try {
  const playerMap = new Map();
  const matchupByTeam = new Map();

  for (const game of (boxscore?.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek)) {
    const matchupId = Number(game.id);
    for (const side of [game.home, game.away]) {
      if (!side?.teamId) continue;
      matchupByTeam.set(Number(side.teamId), matchupId);
      for (const entry of (side.rosterForCurrentScoringPeriod?.entries || [])) {
        if (Number(entry.lineupSlotId) === 20 || Number(entry.lineupSlotId) === 21) continue;
        const player = entry.playerPoolEntry?.player;
        if (!player?.id || !player?.proTeamId) continue;
        playerMap.set(Number(player.id), {
          playerId: Number(player.id),
          player: player.fullName || `${player.firstName || ""} ${player.lastName || ""}`.trim(),
          proTeamId: Number(player.proTeamId),
          fantasyTeamId: Number(side.teamId),
          matchupId
        });
      }
    }
  }

  if (!playerMap.size) {
    await writeFile("data/current/live-plays.json", JSON.stringify({ week: currentWeek, updatedAt: new Date().toISOString(), plays: [] }, null, 2) + "\n");
    process.exit(0);
  }

  const scoringRules = new Map(
    (settings?.settings?.scoringSettings?.scoringItems || [])
      .map(item => [Number(item.statId), Number(item.points)])
      .filter(([id, points]) => Number.isFinite(id) && Number.isFinite(points) && points !== 0)
  );

  const statIds = {
    passingYards: 3, passingTouchdowns: 4, passing2PtConversions: 19, passingInterceptions: 20,
    rushingYards: 24, rushingTouchdowns: 25, rushing2PtConversions: 26,
    receivingYards: 42, receivingTouchdowns: 43, receiving2PtConversions: 44,
    receivingReceptions: 53, lostFumbles: 72,
    madeFieldGoalsFrom50Plus: 74, madeFieldGoalsFrom40To49: 77,
    madeFieldGoalsFromUnder40: 80, missedFieldGoals: 85,
    madeExtraPoints: 86, missedExtraPoints: 88
  };

  const playerMapByProTeam = new Map();
  for (const player of playerMap.values()) {
    if (!playerMapByProTeam.has(player.proTeamId)) playerMapByProTeam.set(player.proTeamId, []);
    playerMapByProTeam.get(player.proTeamId).push(player);
  }

  const nflScoreboard = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${currentWeek}&seasontype=2&season=${season}`
  );

  const relevantGames = (nflScoreboard.events || []).filter(event => {
    const competition = event.competitions?.[0];
    const state = competition?.status?.type?.state;
    if (!includeCompleted && state !== "in") return false;
    if (includeCompleted && state !== "in" && state !== "post") return false;
    return (competition.competitors || []).some(c => playerMapByProTeam.has(Number(c.id || c.team?.id)));
  });

  async function getPlays(eventId) {
    try {
      const summary = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`
      );
      const summaryPlays = summary?.plays || summary?.gameInfo?.plays || [];
      if (summaryPlays.length) return summaryPlays;
    } catch (error) {
      console.warn(`ESPN summary play feed failed for ${eventId}: ${error.message}`);
    }

    const data = await fetchJson(`https://cdn.espn.com/core/nfl/playbyplay?xhr=1&gameId=${eventId}`);
    return data?.gamepackageJSON?.plays || data?.plays || [];
  }

  const relevant = [];
  for (const event of relevantGames) {
    const plays = await getPlays(event.id);
    const lastStats = new Map();

    for (const play of plays) {
      const participants = Array.isArray(play.participants) ? play.participants : [];
      const matched = [];

      for (const participant of participants) {
        const ref = participant.athlete?.$ref || participant.athlete?.href || "";
        const idMatch = String(ref).match(/athletes\/(\d+)/);
        const playerId = Number(participant.athlete?.id || (idMatch ? idMatch[1] : NaN));
        const fantasyPlayer = playerMap.get(playerId);
        if (!fantasyPlayer) continue;

        const currentStats = {};
        for (const stat of (participant.stats || [])) {
          if (stat?.name && Number.isFinite(Number(stat.value))) currentStats[stat.name] = Number(stat.value);
        }

        const previousStats = lastStats.get(playerId) || {};
        let fantasyPoints = 0;
        for (const [name, value] of Object.entries(currentStats)) {
          const statId = statIds[name];
          if (!statId || !scoringRules.has(statId)) continue;
          const delta = value - Number(previousStats[name] || 0);
          if (Number.isFinite(delta) && delta !== 0) fantasyPoints += delta * scoringRules.get(statId);
        }
        lastStats.set(playerId, currentStats);

        matched.push({ fantasyPlayer, fantasyPoints });
      }

      // Some ESPN CDN play payloads omit participant objects or expose them
      // differently. Fall back to the play text + play type so the feed still
      // works when ESPN gives us a perfectly usable play description.
      if (!matched.length) {
        const text = String(play.shortText || play.text || "").trim();
        const normalizedText = text.toLowerCase();
        const yardage = Number(play.statYardage);
        const typeId = Number(play.type?.id);
        const nameMatches = [...playerMap.values()].filter(p => {
          const full = p.player.toLowerCase();
          const parts = full.split(/\s+/);
          return normalizedText.includes(full) ||
            (parts.length >= 2 && normalizedText.includes(parts.slice(-2).join(" ")));
        });

        for (const fantasyPlayer of nameMatches) {
          let fantasyPoints = 0;
          if (typeId === 5 && Number.isFinite(yardage)) {
            fantasyPoints += yardage * (scoringRules.get(statIds.rushingYards) || 0);
          } else if (typeId === 24 && Number.isFinite(yardage)) {
            fantasyPoints += yardage * (scoringRules.get(statIds.receivingYards) || 0);
            fantasyPoints += scoringRules.get(statIds.receivingReceptions) || 0;
          } else if (typeId === 67 || typeId === 68 || typeId === 36 || /touchdown/i.test(text)) {
            if (typeId === 67) fantasyPoints += scoringRules.get(statIds.passingTouchdowns) || 0;
            else if (typeId === 68) fantasyPoints += scoringRules.get(statIds.rushingTouchdowns) || 0;
            else if (typeId === 36) fantasyPoints += 6;
            else if (/pass/i.test(text) && /touchdown/i.test(text)) fantasyPoints += scoringRules.get(statIds.receivingTouchdowns) || 0;
            else fantasyPoints += scoringRules.get(statIds.rushingTouchdowns) || 0;
          } else if (typeId === 59) {
            const distance = Number(play.statYardage);
            const points = distance >= 50 ? scoringRules.get(statIds.madeFieldGoalsFrom50Plus)
              : distance >= 40 ? scoringRules.get(statIds.madeFieldGoalsFrom40To49)
              : scoringRules.get(statIds.madeFieldGoalsFromUnder40);
            fantasyPoints += points || 0;
          } else if (typeId === 60) {
            fantasyPoints += scoringRules.get(statIds.missedFieldGoals) || 0;
          } else if (typeId === 61) {
            fantasyPoints += scoringRules.get(statIds.madeExtraPoints) || 0;
          }

          if (fantasyPoints !== 0) matched.push({ fantasyPlayer, fantasyPoints });
        }
      }

      if (!matched.length) continue;

      const uniquePlayers = [];
      const seen = new Set();
      for (const item of matched) {
        if (seen.has(item.fantasyPlayer.playerId)) continue;
        seen.add(item.fantasyPlayer.playerId);
        uniquePlayers.push(item);
      }

      for (const { fantasyPlayer, fantasyPoints } of uniquePlayers) {
        if (fantasyPoints === 0) continue;
        const text = String(play.shortText || play.text || "")
          .replace(/^\([^)]*\)\s*/, "")
          .trim();
        if (!text) continue;
        relevant.push({
          id: `${event.id}-${play.id}-${fantasyPlayer.playerId}`,
          eventId: String(event.id),
          matchupId: fantasyPlayer.matchupId,
          fantasyTeamId: fantasyPlayer.fantasyTeamId,
          playerId: fantasyPlayer.playerId,
          player: fantasyPlayer.player,
          points: Math.round(fantasyPoints * 100) / 100,
          text,
          clock: play.clock?.displayValue || "",
          period: Number(play.period?.number || 0),
          wallclock: play.wallclock || play.modified || null
        });
      }
    }
  }

  const plays = relevant
    .sort((a, b) => new Date(b.wallclock || 0) - new Date(a.wallclock || 0))
    .slice(0, 60);

  await writeFile("data/current/live-plays.json", JSON.stringify({
    week: currentWeek,
    updatedAt: new Date().toISOString(),
    plays
  }, null, 2) + "\n");

  console.log(`Updated live plays: ${plays.length} fantasy-relevant plays across ${relevantGames.length} active NFL games.`);
} catch (error) {
  console.warn(`Live play feed unavailable: ${error.message}`);
  // Keep the last good feed so a temporary ESPN public-API hiccup never
  // interferes with the normal fantasy-score update.
  if (!previous || Number(previous.week) !== currentWeek) {
    await writeFile("data/current/live-plays.json", JSON.stringify({ week: currentWeek, updatedAt: null, plays: [] }, null, 2) + "\n");
  }
}
