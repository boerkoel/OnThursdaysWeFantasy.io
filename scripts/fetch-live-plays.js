import { readFile, writeFile } from "node:fs/promises";
import { normalCdf, normalQuantile } from "./lib/simulation.js";

const season = process.env.ESPN_SEASON || "2026";
const includeCompleted = process.env.ESPN_INCLUDE_COMPLETED === "true";

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

// ---- Momentum ---------------------------------------------------------------
// How much a play moved its fantasy matchup: the win odds just after it versus
// the odds with the play's points taken back out. A team's final score is roughly
// normal (projection, projectionSd), so the margin is too, with the two SDs
// combined. Only plays from the last 15 minutes get one, so a backfilled
// play isn't judged against a much later scoreboard.
const MOMENTUM_MAX_AGE_MS = 15 * 60 * 1000;
const MIN_MARGIN_SD = 3;
// Plays first seen in the same run all happened before this one scoreboard,
// so each matchup's new plays are walked newest first: a play is judged
// against the odds just after it (the current odds with every later play
// taken back out). Returns play id -> momentum.
function momentumByPlay(newPlays, scoresByTeam) {
  const result = new Map();
  const byMatchup = new Map();
  for (const play of newPlays) {
    if (!play.wallclock || Date.now() - Date.parse(play.wallclock) > MOMENTUM_MAX_AGE_MS) continue;
    if (!byMatchup.has(play.matchupId)) byMatchup.set(play.matchupId, []);
    byMatchup.get(play.matchupId).push(play);
  }
  for (const plays of byMatchup.values()) {
    const team = scoresByTeam.get(Number(plays[0].fantasyTeamId));
    const opponent = team && scoresByTeam.get(Number(team.opponentId));
    if (!team || !opponent || !Number.isFinite(Number(team.winProbability))) continue;
    const marginSd = Math.max(MIN_MARGIN_SD, Math.hypot(Number(team.projectionSd) || 0, Number(opponent.projectionSd) || 0));
    let z = normalQuantile(Math.min(0.9999, Math.max(0.0001, Number(team.winProbability) / 100)));
    plays.sort((x, y) => Date.parse(y.wallclock) - Date.parse(x.wallclock));
    for (const play of plays) {
      const delta = (Number(play.fantasyTeamId) === Number(team.teamId) ? 1 : -1) * Number(play.points) / marginSd;
      const after = normalCdf(z), before = normalCdf(z - delta);
      z -= delta;
      const shift = Math.round((after - before) * 1000) / 10;
      if (!shift) continue;
      const toward = shift > 0 ? team : opponent;
      result.set(play.id, {
        towardTeamId: Number(toward.teamId),
        toward: toward.team,
        shift: Math.abs(shift),
        winProbability: Math.round((shift > 0 ? after : 1 - after) * 1000) / 10
      });
    }
  }
  return result;
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
          positionId: Number(player.defaultPositionId || 0),
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
    // The CDN game package is the fresher source for live PBP. ESPN's
    // summary endpoint can lag behind during active games, sometimes returning
    // an old single-game snapshot even though the game package has newer plays.
    try {
      const data = await fetchJson(`https://cdn.espn.com/core/nfl/game?xhr=1&gameId=${eventId}`);
      const game = data?.gamepackageJSON || data || {};
      const drivePlays = [
        ...(game?.drives?.previous || []).flatMap(drive => drive?.plays || []),
        ...(game?.drives?.current?.plays || [])
      ];
      if (drivePlays.length) return drivePlays;
      if (Array.isArray(game?.plays) && game.plays.length) return game.plays;
    } catch (error) {
      console.warn(`ESPN CDN play feed failed for ${eventId}: ${error.message}`);
    }

    try {
      const summary = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`
      );
      return summary?.plays || summary?.gameInfo?.plays || [];
    } catch (error) {
      console.warn(`ESPN summary play feed failed for ${eventId}: ${error.message}`);
      return [];
    }
  }

  function playerNameMatches(text, player) {
    const normalized = text.toLowerCase();
    const full = player.player.toLowerCase();
    const parts = full.split(/\s+/);
    if (normalized.includes(full)) return true;
    if (parts.length >= 2 && normalized.includes(parts.slice(-2).join(" "))) return true;

    // ESPN PBP commonly uses compact names such as "J.Allen" or "A.St. Brown".
    const firstInitial = parts[0]?.[0];
    const lastName = parts[parts.length - 1];
    if (!firstInitial || !lastName) return false;
    const escapedLast = lastName.replace(/[.*+?^$\\{}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + firstInitial + "\\.?\\s*" + escapedLast + "\\b", "i").test(text);
  }

  function isPasserInPlay(text, player) {
    const lastName = player.player.trim().split(/\s+/).pop();
    if (!lastName) return false;
    const escaped = lastName.replace(/[.*+?^$\\{}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b[A-Z]\\.?\\s*" + escaped + "\\s+(?:pass|scramble|kneels?)\\b", "i").test(text);
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

    // Kickers are often mentioned in the same PBP sentence as the actual
    // touchdown scorer. Never let the touchdown parser credit the kicker.
    // Handle extra points separately because the kicker is the scorer there.
    if (Number(fantasyPlayer.positionId) === 5) {
      if (/extra point is good/i.test(text)) {
        return scoringRules.get(statIds.madeExtraPoints) || 0;
      }
      if (/extra point is (?:blocked|no good|missed)/i.test(text)) {
        return scoringRules.get(statIds.missedExtraPoints) || 0;
      }
      return 0;
    }

    const isPasser = isPasserInPlay(text, fantasyPlayer);

    // ESPN describes completed passes in several ways, including:
    // "T.Shough pass short left to N.Fant for 3 yards, TOUCHDOWN."
    // Do not require the literal phrase "pass to" because route/direction
    // words can appear between "pass" and "to".
    const isPassCompletion =
      /pass\s+(?:complete|incomplete)/i.test(text) ||
      /complete to\b/i.test(text) ||
      /\bpass\b.*\bto\b.*\bfor\s+-?\d+\s+yards?/i.test(text) ||
      /\b-?\d+\s+yds?\s+pass\s+from\b/i.test(text);

    const isRush =
      /rush|rushed|run for|running play|left end|right end|up the middle|scrambles/i.test(text);

    const isReception =
      !isPasser &&
      isPassCompletion &&
      (lower.includes(fantasyPlayer.player.toLowerCase()) || /catch|complete to|pass\b.*\bto\b/i.test(text));

    if (isPasser && isPassCompletion && Number.isFinite(yards)) {
      points += yards * (scoringRules.get(statIds.passingYards) || 0);
    }

    if (isRush && !isPassCompletion && Number.isFinite(yards)) {
      points += yards * (scoringRules.get(statIds.rushingYards) || 0);
    }

    if (isReception && Number.isFinite(yards)) {
      points += yards * (scoringRules.get(statIds.receivingYards) || 0);
      points += scoringRules.get(statIds.receivingReceptions) || 0;
    }

    if (/touchdown/i.test(text)) {
      if (isPasser) {
        points += scoringRules.get(statIds.passingTouchdowns) || 0;
      } else if (isPassCompletion || /receiv|caught|catch/i.test(text)) {
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

    const eventTeamIds = new Set(
      (event.competitions?.[0]?.competitors || [])
        .map(c => Number(c.id || c.team?.id))
        .filter(Number.isFinite)
    );

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
          // Only match players who are actually on one of the NFL teams in
          // this game. This prevents identical initials/names from unrelated
          // fantasy players from being credited with the same play.
          if (!eventTeamIds.has(Number(fantasyPlayer.proTeamId))) continue;
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

  // Merge the new ESPN snapshot with the previous saved feed so a 5-minute
  // refresh does not erase recent plays. ESPN can return only the latest slice
  // of PBP, so persistence has to happen here rather than in the frontend.
  let previousPlays = [];
  try {
    const previous = JSON.parse(await readFile("data/current/live-plays.json", "utf8"));
    if (Number(previous.week) === Number(currentWeek)) previousPlays = previous.plays || [];
  } catch {}

  // A play keeps the momentum it was given when it was first seen; new ones
  // get it from this run's freshly updated scoreboard.
  const previousById = new Map(previousPlays.map(p => [p.id, p]));
  const scoreboard = await readJson("data/current/scoreboard.json", {});
  const scoresByTeam = Number(scoreboard.week) === currentWeek ? new Map((scoreboard.scores || []).map(s => [Number(s.teamId), s])) : new Map();
  const fresh = momentumByPlay(relevant.filter(p => !previousById.has(p.id)), scoresByTeam);
  const deduped = new Map();
  for (const play of [...relevant, ...previousPlays]) {
    if (deduped.has(play.id)) continue;
    const momentum = previousById.has(play.id) ? previousById.get(play.id).momentum : fresh.get(play.id);
    deduped.set(play.id, momentum ? { ...play, momentum } : play);
  }

  const plays = [...deduped.values()]
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