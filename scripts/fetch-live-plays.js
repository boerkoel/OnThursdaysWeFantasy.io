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

const matchupFile = await readJson("data/current/mMatchup.json");
const localBoxscore = await readJson("data/current/mBoxscore.json", {});
const settings = await readJson("data/current/mSettings.json");
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

async function fetchLeagueView(view, scoringPeriodId, matchupPeriod = false) {
  if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets for live player mapping.");
  const url = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`);
  url.searchParams.set("view", view);
  if (scoringPeriodId != null) url.searchParams.set("scoringPeriodId", String(scoringPeriodId));
  if (matchupPeriod) url.searchParams.set("matchupPeriodId", String(scoringPeriodId));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`
    }
  });
  if (!response.ok) throw new Error(`ESPN ${view} request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

const currentWeek = Number(matchupFile?.scoringPeriodId || 1);
console.log(`Live-play mapping: week ${currentWeek}, local matchup schedule ${(matchupFile?.schedule || []).length}, local boxscore schedule ${(localBoxscore?.schedule || []).length}`);

const previous = await readJson("data/current/live-plays.json", { week: currentWeek, updatedAt: null, plays: [] });

try {
  const [directMatchup, roster] = await Promise.all([
    fetchLeagueView("mMatchup", currentWeek, true),
    fetchLeagueView("mRoster", currentWeek)
  ]);
  const matchup = (directMatchup?.schedule || []).length ? directMatchup : matchupFile;
  console.log(`ESPN live-play mapping: direct matchup schedule ${(directMatchup?.schedule || []).length}, roster teams ${(roster?.teams || []).length}`);

  const playerMap = new Map();
  const matchupByTeam = new Map(
    (matchup?.schedule || [])
      .filter(g => Number(g.matchupPeriodId) === currentWeek)
      .flatMap(g => [
        g.home?.teamId ? [Number(g.home.teamId), Number(g.id)] : null,
        g.away?.teamId ? [Number(g.away.teamId), Number(g.id)] : null
      ])
      .filter(Boolean)
  );

  const rosterEntriesByTeam = new Map();
  for (const team of (roster?.teams || [])) {
    rosterEntriesByTeam.set(
      Number(team.id),
      team.roster?.entries ||
      team.rosterForCurrentScoringPeriod?.entries ||
      []
    );
  }
  for (const game of (matchup?.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek)) {
    for (const side of [game.home, game.away]) {
      if (!side?.teamId || rosterEntriesByTeam.get(Number(side.teamId))?.length) continue;
      rosterEntriesByTeam.set(Number(side.teamId), side.rosterForCurrentScoringPeriod?.entries || []);
    }
  }
  for (const game of (localBoxscore?.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek)) {
    for (const side of [game.home, game.away]) {
      if (!side?.teamId || rosterEntriesByTeam.get(Number(side.teamId))?.length) continue;
      rosterEntriesByTeam.set(Number(side.teamId), side.rosterForCurrentScoringPeriod?.entries || []);
    }
  }

  for (const game of (matchup?.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek)) {
    const matchupId = Number(game.id);
    for (const side of [game.home, game.away]) {
      if (!side?.teamId) continue;
      for (const entry of (rosterEntriesByTeam.get(Number(side.teamId)) || [])) {
        if (Number(entry.lineupSlotId) === 20 || Number(entry.lineupSlotId) === 21) continue;
        const player = entry.playerPoolEntry?.player;
        if (!player?.id || !player?.proTeamId) continue;
        playerMap.set(Number(player.id), {
          playerId: Number(player.id),
          player: player.fullName || `${player.firstName || ""} ${player.lastName || ""}`.trim(),
          proTeamId: Number(player.proTeamId),
          fantasyTeamId: Number(side.teamId),
          matchupId: matchupByTeam.get(Number(side.teamId)) || matchupId
        });
      }
    }
  }

  console.log(`ESPN live-play mapping: matchup teams ${matchupByTeam.size}, roster entry teams ${rosterEntriesByTeam.size}, active player map ${playerMap.size}`);

  if (!playerMap.size) {
    console.warn("No active fantasy players could be mapped; live-play feed will remain empty.");
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

  console.log(`NFL public scoreboard: ${(nflScoreboard.events || []).length} games, ${relevantGames.length} relevant games`);

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

    const data = await fetchJson(`https://cdn.espn.com/core/nfl/game?xhr=1&gameId=${eventId}`);
    const game = data?.gamepackageJSON || data || {};
    const drivePlays = [
      ...(game?.drives?.previous || []).flatMap(drive => drive?.plays || []),
      ...(game?.drives?.current?.plays || [])
    ];
    if (drivePlays.length) return drivePlays;
    return game?.plays || [];
  }

  function playerNameMatches(text, player) {
    const normalized = text.toLowerCase();
    const full = player.player.toLowerCase();
    const parts = full.split(/\s+/);
    return normalized.includes(full) ||
      (parts.length >= 2 && normalized.includes(parts.slice(-2).join(" ")));
  }

  function yardageFromText(text) {
    const patterns = [
      /for (-?\d+) yards?/i,
      /(-?\d+) yard(?:s)? (?:rush|run|reception|catch|pass)/i,
      /\b(-?\d+) yd\b/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function fantasyPointsFromText(text, fantasyPlayer, play) {
    const lower = text.toLowerCase();
    const yards = Number.isFinite(Number(play.statYardage)) ? Number(play.statYardage) : yardageFromText(text);
    let points = 0;

    const isPassCompletion =
      /pass complete|complete to|pass to .* for \d+ yards|\b\d+ yd pass from/i.test(text);
    const isRush =
      /rush|rushed|run for|running play|left end|right end|up the middle|scrambles/i.test(text);
    const isReception =
      isPassCompletion && (lower.includes(fantasyPlayer.player.toLowerCase()) || /catch|complete to|pass to/i.test(text));

    if (isRush && !isPassCompletion && Number.isFinite(yards)) {
      points += yards * (scoringRules.get(statIds.rushingYards) || 0);
    }

    if (isReception && Number.isFinite(yards)) {
      points += yards * (scoringRules.get(statIds.receivingYards) || 0);
      points += scoringRules.get(statIds.receivingReceptions) || 0;
    }

    if (/touchdown/i.test(text)) {
      if (isPassCompletion || /receiv|caught|catch/i.test(text)) {
        points += scoringRules.get(statIds.receivingTouchdowns) || 0;
      } else if (isRush || /rushing|rush/i.test(text)) {
        points += scoringRules.get(statIds.rushingTouchdowns) || 0;
      } else if (/intercepted|interception/i.test(text)) {
        // Conservative: don't assign an interception return to a fantasy player
        // unless ESPN identifies that returner as a participant.
      } else {
        points += scoringRules.get(statIds.rushingTouchdowns) || 0;
      }
    }

    if (/2-point conversion/i.test(text)) {
      if (isPassCompletion || /receiv|caught|catch/i.test(text)) {
        points += scoringRules.get(statIds.receiving2PtConversions) || 0;
      } else if (isRush) {
        points += scoringRules.get(statIds.rushing2PtConversions) || 0;
      }
    }

    if (/intercepted|interception/i.test(text) && /pass|thrown/i.test(text)) {
      points += scoringRules.get(statIds.passingInterceptions) || 0;
    }

    if (/fumble/i.test(text) && /lost/i.test(text)) {
      points += scoringRules.get(statIds.lostFumbles) || 0;
    }

    return Math.round(points * 100) / 100;
  }

  const relevant = [];
  for (const event of relevantGames) {
    const plays = await getPlays(event.id);
    console.log(`NFL game ${event.id}: received ${plays.length} plays`);

    for (const play of plays) {
      const text = String(play.shortText || play.text || "").trim();
      if (!text) continue;

      const participants = Array.isArray(play.participants) ? play.participants : [];
      const matched = [];

      for (const participant of participants) {
        const ref = participant.athlete?.$ref || participant.athlete?.href || "";
        const idMatch = String(ref).match(/athletes\/(\d+)/);
        const playerId = Number(participant.athlete?.id || (idMatch ? idMatch[1] : NaN));
        const fantasyPlayer = playerMap.get(playerId);
        if (!fantasyPlayer) continue;

        // ESPN's summary participant stats are not consistently shaped across
        // feeds. Prefer them when present, otherwise derive the play from text.
        let fantasyPoints = 0;
        for (const stat of (participant.stats || [])) {
          const statId = statIds[stat?.name];
          const value = Number(stat?.value);
          if (statId && scoringRules.has(statId) && Number.isFinite(value)) {
            fantasyPoints += value * scoringRules.get(statId);
          }
        }

        if (!fantasyPoints) fantasyPoints = fantasyPointsFromText(text, fantasyPlayer, play);
        matched.push({ fantasyPlayer, fantasyPoints });
      }

      // Current ESPN summary plays often omit participant objects entirely.
      // Match starters by the names appearing in the play description and
      // calculate the fantasy impact from the same description.
      if (!matched.length) {
        for (const fantasyPlayer of playerMap.values()) {
          if (!playerNameMatches(text, fantasyPlayer)) continue;
          const fantasyPoints = fantasyPointsFromText(text, fantasyPlayer, play);
          if (fantasyPoints !== 0) matched.push({ fantasyPlayer, fantasyPoints });
        }
      }

      const uniquePlayers = [];
      const seen = new Set();
      for (const item of matched) {
        if (seen.has(item.fantasyPlayer.playerId)) continue;
        seen.add(item.fantasyPlayer.playerId);
        uniquePlayers.push(item);
      }

      for (const { fantasyPlayer, fantasyPoints } of uniquePlayers) {
        if (fantasyPoints === 0) continue;
        relevant.push({
          id: `${event.id}-${play.id}-${fantasyPlayer.playerId}`,
          eventId: String(event.id),
          matchupId: fantasyPlayer.matchupId,
          fantasyTeamId: fantasyPlayer.fantasyTeamId,
          playerId: fantasyPlayer.playerId,
          player: fantasyPlayer.player,
          points: Math.round(fantasyPoints * 100) / 100,
          text: text.replace(/^\([^)]*\)\s*/, "").trim(),
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

  console.log(`Live-play parser: ${relevant.length} fantasy-relevant plays retained; stored ${plays.length} across ${relevantGames.length} relevant NFL games.`);
} catch (error) {
  console.warn(`Live play feed unavailable: ${error.message}`);
  if (!previous || Number(previous.week) !== currentWeek) {
    await writeFile("data/current/live-plays.json", JSON.stringify({ week: currentWeek, updatedAt: null, plays: [] }, null, 2) + "\n");
  }
}