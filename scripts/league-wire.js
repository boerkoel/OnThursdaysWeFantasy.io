import { readFile, writeFile } from "node:fs/promises";
import { playerOutlook, round, swingOdds } from "./lib/simulation.js";
import { BENCH_SLOT, IR_SLOT, settledLineupRegret } from "./lib/lineup.js";

// League Wire: the rotating live stories and each matchup's key plays. Runs
// on every live update (after update-live-scoreboard.js, which it reads) and
// in the daily update. Only needs the current week's data.
function money(n){return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00"}
const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n");

const previousScoreboard = await readJson(process.env.PREVIOUS_SCOREBOARD_PATH || "data/current/scoreboard.json").catch(() => null);
const teamData = await readJson("data/current/mTeam.json");
const matchupData = await readJson("data/current/mMatchup.json");
const guillotineData = await readJson("data/current/guillotine.json").catch(() => null);
const liveScoringData = await readJson("data/current/mLiveScoring.json");
const boxscoreData = await readJson("data/current/mBoxscore.json");
const rosterData = await readJson("data/current/mRoster.json").catch(() => ({ teams: [] }));

const teamNames = new Map((teamData.teams || []).map(t => [t.id, (t.name || "").trim()]));
const name = id => teamNames.get(id) || "Team " + id;
const currentWeek = Number(matchupData.scoringPeriodId || 1);
const currentWeekMatchups = (matchupData.schedule || [])
  .filter(m => m.home?.teamId && m.away?.teamId && Number(m.matchupPeriodId) === currentWeek)
  .map(m => ({ id:m.id, week:m.matchupPeriodId, homeTeamId:m.home.teamId, awayTeamId:m.away.teamId, winner:m.winner, completed:m.winner==="HOME"||m.winner==="AWAY" }));

// ESPN's mBoxscore response includes schedule entries for many/all matchup
// periods. Only use entries for the current matchup period; otherwise later
// zero-valued future matchups can overwrite the live totals for the same team.
const liveSchedule = (liveScoringData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const boxscoreSchedule = (boxscoreData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const allLiveSchedules = [...liveSchedule, ...boxscoreSchedule];

// The live scoreboard (scores, ESPN projections, Monte Carlo odds) is built by
// update-live-scoreboard.js, which must run before this script.
const liveScoreboard = await readJson("data/current/scoreboard.json");
const currentScores = Number(liveScoreboard.week) === currentWeek ? (liveScoreboard.scores || []) : [];
const projectedMedian = Number(liveScoreboard.projectedMedian);
// "Near median" is decided by update-live-scoreboard.js (the teams on either
// side of the projected median, plus any with 30-70% above-median odds).
const isNearMedian = s => Boolean(s?.nearMedian);

async function buildKeyPlays() {
  const plays = await readJson("data/current/live-plays.json").catch(() => ({ plays: [] }));
  return (plays.plays || [])
    .filter(play => Math.abs(Number(play.points)) >= 4)
    .sort((a, b) => {
      const aTime = a.wallclock ? new Date(a.wallclock).getTime() : 0;
      const bTime = b.wallclock ? new Date(b.wallclock).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 60)
    .map(play => ({
      id: play.id,
      matchupId: play.matchupId,
      teamId: play.fantasyTeamId,
      playerId: play.playerId,
      points: round(play.points),
      player: play.player,
      text: play.text,
      wallclock: play.wallclock || null
    }));
}

// ---- Live lineup model for the League Wire ----------------------------------
// NFL game status comes from update-live-scoreboard.js via scoreboard.json.
const nflGames = Number(liveScoreboard.week) === currentWeek ? (liveScoreboard.nflGames || []) : [];
const nflGameByProTeam = new Map(nflGames.flatMap(g => (g.teamIds || []).map(id => [Number(id), g])));

// One entry per fantasy team: its players this week with weekly points,
// projection, lineup slot and NFL game status.
const liveTeams = new Map();
for (const g of allLiveSchedules) for (const side of [g.home, g.away]) {
  if (!side?.teamId || liveTeams.has(Number(side.teamId))) continue;
  const teamId = Number(side.teamId);
  const players = (side.rosterForCurrentScoringPeriod?.entries || [])
    .filter(entry => entry.playerPoolEntry?.player && Number(entry.lineupSlotId) !== IR_SLOT)
    .map(entry => {
      const player = entry.playerPoolEntry.player;
      const game = nflGameByProTeam.get(Number(player.proTeamId)) || null;
      const projection = Number((player.stats || []).find(s => Number(s.scoringPeriodId) === currentWeek && Number(s.statSourceId) === 1 && Number(s.statSplitTypeId) === 1)?.appliedTotal);
      return {
        playerId:Number(entry.playerId),
        name:player.fullName,
        lastName:player.lastName || player.fullName,
        teamId,
        slot:Number(entry.lineupSlotId),
        bench:Number(entry.lineupSlotId) === BENCH_SLOT,
        actual:round(Number(entry.playerPoolEntry.appliedStatTotal ?? 0)),
        projection:Number.isFinite(projection) ? round(projection) : null,
        eligibleSlots:(player.eligibleSlots || []).map(Number),
        positionId:Number(player.defaultPositionId),
        game,
        // No game this week (bye) counts as finished with its current points.
        finished:game ? game.completed : nflGames.length > 0,
        playing:game?.state === "in",
        upcoming:game?.state === "pre"
      };
    });
  liveTeams.set(teamId, {teamId, team:name(teamId), players});
}

// Games worth talking about right now: those in progress, or if none are,
// the most recent kickoff slot that has finished.
function recentGameIds() {
  const live = nflGames.filter(g => g.state === "in");
  if (live.length) return new Set(live.map(g => g.id));
  const done = nflGames.filter(g => g.completed && g.kickoff);
  if (!done.length) return new Set();
  const latest = Math.max(...done.map(g => Date.parse(g.kickoff)));
  return new Set(done.filter(g => Date.parse(g.kickoff) >= latest - 60 * 60 * 1000).map(g => g.id));
}

const pts = n => money(n) + " pts";
const possessive = team => team + (team.endsWith("s") ? "'" : "'s");
const listNames = names => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
// "Swift and D/ST (PHI @ CHI)": players ({name, game}) with each game named once.
function playersWithGames(players) {
  const games = [...new Set(players.map(p => p.game || ""))];
  return listNames(games.map(g => listNames(players.filter(p => (p.game || "") === g).map(p => p.name)) + (g ? " (" + g + ")" : "")));
}
// Stories should fit in about three lines on a phone (the pinned wire box is
// as tall as its longest story). fit() takes a story's versions, longest
// first, and returns the first that fits (or the shortest).
const STORY_MAX_CHARS = 160;
const fit = (...versions) => versions.find(v => v.length <= STORY_MAX_CHARS) ?? versions.reduce((a, b) => b.length < a.length ? b : a);

function buildMarqueeStories() {
  const stories = [];
  const previousScores = new Map((previousScoreboard?.week === currentWeek ? (previousScoreboard.scores || []) : []).map(s => [s.teamId, s]));
  const previousProjectedMedian = previousScoreboard?.week === currentWeek
    ? Number(previousScoreboard.projectedMedian ?? previousScoreboard.median)
    : null;
  const add = (type, text, score) => {
    if (text.length > STORY_MAX_CHARS) console.warn("League Wire: " + type + " runs " + text.length + " chars (budget " + STORY_MAX_CHARS + "): " + text);
    stories.push({type, text, score:Number.isFinite(score) ? round(score) : 0});
  };
  // Player stories only cover the games being played now (or the most
  // recently finished slot), so Thursday's hero doesn't lead on Sunday night.
  const recentGames = recentGameIds();
  const recentStarters = [...liveTeams.values()]
    .flatMap(t => t.players)
    .filter(p => !p.bench && p.game && recentGames.has(p.game.id) && Number.isFinite(p.projection))
    .map(p => ({...p, team:name(p.teamId), overProjection:round(p.actual - p.projection)}));
  const hot = recentStarters.filter(p => p.actual >= 10 && p.overProjection >= 4).sort((a,b) => b.overProjection - a.overProjection)[0];
  if (hot) add("HOT PLAYER","🔥 " + hot.name + " is on fire — " + pts(hot.actual) + ", " + pts(hot.overProjection) + " over projection for " + hot.team + ".",hot.overProjection+20);
  const buster = recentStarters.filter(p => p.actual >= 8 && p.overProjection > 0 && p.playerId !== hot?.playerId).sort((a,b) => b.overProjection - a.overProjection)[0];
  if (buster) add("PROJECTION BUSTER","🎯 " + buster.name + " is " + pts(buster.overProjection) + " above ESPN projection for " + buster.team + ".",buster.overProjection+10);
  const dud = recentStarters.filter(p => p.finished && p.projection >= 10 && p.actual <= p.projection / 3).sort((a,b) => a.overProjection - b.overProjection)[0];
  if (dud) add("DUD ALERT","🫠 " + dud.name + " laid an egg for " + dud.team + " — " + pts(dud.actual) + " against a " + pts(dud.projection) + " projection.",18 - dud.overProjection / 2);

  // Lineup decisions that are already settled (both players' games are over).
  const regrets = [...liveTeams.values()].map(t => ({...t, ...settledLineupRegret(t.players)}));
  const regret = regrets.filter(r => r.pointsLeft >= 8).sort((a,b) => b.pointsLeft - a.pointsLeft)[0];
  if (regret) {
    const swap = regret.bestSwap ? " Starting " + regret.bestSwap.benchPlayer.name + " (" + pts(regret.bestSwap.benchPlayer.actual) + ") over " + regret.bestSwap.starter.name + " (" + pts(regret.bestSwap.starter.actual) + ") alone was worth " + pts(regret.bestSwap.gain) + "." : "";
    add("LINEUP REGRET","🪑 " + regret.team + " has left " + pts(regret.pointsLeft) + " on the bench this week." + swap,40 + regret.pointsLeft);
  }
  // Perfect managers: every settled decision was right, with enough games in
  // the books (including some bench players) for that to mean something.
  const perfect = regrets.filter(r => r.pointsLeft === 0 && r.finishedStarters >= 5 && r.finishedBench >= 2).map(r => r.team);
  if (perfect.length) add("LINEUP GENIUS","🧠 Perfect lineup calls so far: " + listNames(perfect) + (perfect.length === 1 ? " hasn't" : " haven't") + " left a single point on the bench.",30 + 5 * perfect.length);

  const matchupStates = currentWeekMatchups.map(m => {
    const a=currentScores.find(s=>s.teamId===m.homeTeamId), b=currentScores.find(s=>s.teamId===m.awayTeamId);
    if(!a||!b) return null;
    const pa=previousScores.get(a.teamId), pb=previousScores.get(b.teamId);
    const aProj=Number(a.projectionAverage), bProj=Number(b.projectionAverage);
    const paProj=pa ? Number(pa.projectionAverage ?? pa.projection?.espn) : NaN;
    const pbProj=pb ? Number(pb.projectionAverage ?? pb.projection?.espn) : NaN;
    const projectedDiff=Number.isFinite(aProj)&&Number.isFinite(bProj)?aProj-bProj:null;
    const previousProjectedDiff=Number.isFinite(paProj)&&Number.isFinite(pbProj)?paProj-pbProj:null;
    return {m,a,b,diff:Math.abs(Number(a.score)-Number(b.score)),currentDiff:Number(a.score)-Number(b.score),previousDiff:pa&&pb?Number(pa.score)-Number(pb.score):null,projectedDiff,previousProjectedDiff,projectedDiffAbs:Number.isFinite(projectedDiff)?Math.abs(projectedDiff):null};
  }).filter(Boolean);
  const close=matchupStates.filter(x=>!x.m.completed&&Number.isFinite(x.projectedDiff)&&x.projectedDiffAbs<=8).sort((a,b)=>a.projectedDiffAbs-b.projectedDiffAbs)[0];
  if(close) add("MATCHUP ALERT","⚔️ " + close.a.team + " vs " + close.b.team + " is projected to finish just " + money(close.projectedDiffAbs) + " pts apart.",30-close.projectedDiffAbs);
  const projectionFlip=matchupStates.find(x=>!x.m.completed&&Number.isFinite(x.previousProjectedDiff)&&Number.isFinite(x.projectedDiff)&&((x.previousProjectedDiff>0&&x.projectedDiff<0)||(x.previousProjectedDiff<0&&x.projectedDiff>0)));
  if(projectionFlip){
    const leader=projectionFlip.projectedDiff>0?projectionFlip.a.team:projectionFlip.b.team;
    const trailer=projectionFlip.projectedDiff>0?projectionFlip.b.team:projectionFlip.a.team;
    add("PROJECTION FLIP","🔮 PROJECTION FLIP: " + leader + " is now projected to beat " + trailer + ".",98);
  } else {
    const narrowing=matchupStates
      .filter(x=>!x.m.completed&&Number.isFinite(x.previousProjectedDiff)&&Number.isFinite(x.projectedDiff))
      .map(x=>({...x,projectionChange:x.projectedDiffAbs-Math.abs(x.previousProjectedDiff)}))
      .filter(x=>x.projectionChange<=-3)
      .sort((a,b)=>a.projectionChange-b.projectionChange)[0];
    if(narrowing) add("PROJECTION TIGHTENING","🔮 " + narrowing.a.team + " vs " + narrowing.b.team + " is tightening — the projected margin shrank to " + money(narrowing.projectedDiffAbs) + " pts.",82);
  }
  const flip=matchupStates.find(x=>Number.isFinite(x.previousDiff)&&((x.previousDiff>0&&x.currentDiff<0)||(x.previousDiff<0&&x.currentDiff>0)));
  if(flip){const leader=flip.currentDiff>0?flip.a.team:flip.b.team;const trailer=flip.currentDiff>0?flip.b.team:flip.a.team;add("MATCHUP FLIP","🚨 LEAD CHANGE: " + leader + " just jumped in front of " + trailer + ".",100);}

  if(Number.isFinite(projectedMedian) && projectedMedian > 0){
    const nearMedian = currentScores
      .filter(isNearMedian)
      .sort((a,b) => Math.abs(Number(a.aboveMedianProbability) - 50) - Math.abs(Number(b.aboveMedianProbability) - 50));

    // Crossing the projected median is the most meaningful median story.
    const medianFlip = currentScores.find(s => {
      const p = previousScores.get(s.teamId);
      if (!p || !Number.isFinite(previousProjectedMedian)) return false;
      const previousProjection = Number(p.projectionAverage ?? p.projection?.espn);
      const currentProjection = Number(s.projectionAverage);
      return Number.isFinite(previousProjection) &&
        ((previousProjection > previousProjectedMedian && currentProjection < projectedMedian) ||
         (previousProjection < previousProjectedMedian && currentProjection > projectedMedian));
    });
    if (medianFlip) {
      const direction = Number(medianFlip.projectionAverage) > projectedMedian ? "above" : "below";
      add("MEDIAN FLIP","🚨 MEDIAN FLIP: " + medianFlip.team + " just moved " + direction + " the projected league median.",96);
    } else {
      const newlyNear = nearMedian.find(s => {
        const p = previousScores.get(s.teamId);
        return p && "nearMedian" in p && !isNearMedian(p);
      });
      if (newlyNear) {
        add("MEDIAN WATCH","🎯 " + newlyNear.team + " has moved into the median race — " + money(newlyNear.aboveMedianProbability) + "% to finish above it.",84);
      }
    }

    if (nearMedian.length >= 4) {
      const closest = nearMedian[0];
      add("MEDIAN CLUSTER",fit(
        "🎯 " + nearMedian.length + " teams are in the thick of the median race: " + listNames(nearMedian.map(s => s.team)) + ".",
        "🎯 " + nearMedian.length + " teams are in the thick of the median race, with " + closest.team + " right on the line (" + money(closest.aboveMedianProbability) + "%)."
      ),58 + nearMedian.length);
    }
  }
  const rising=currentScores.filter(s=>s.projectionTrend==="up").sort((a,b)=>Number(b.projectionAverage)-Number(a.projectionAverage))[0];
  if(rising) add("STOCK RISING","📈 Stock rising: " + rising.team + " has its ESPN projection trending up.",22);
  const falling=currentScores.filter(s=>s.projectionTrend==="down").sort((a,b)=>Number(a.projectionAverage)-Number(b.projectionAverage))[0];
  if(falling) add("STOCK FALLING","📉 Stock falling: " + possessive(falling.team) + " ESPN projection is trending down.",20);
  addLineupMistakeStories(add, matchupStates, regrets);
  addDeathWatchStory(add);
  addPickupStories(add);
  try { addRosterStories(add); } catch (error) { console.warn("League Wire: roster stories failed: " + error.message); }
  addSwingStories(add, matchupStates);
  addRaffleStories(add, previousScores);
  addPrimetimeStories(add, matchupStates);
  addWeekAheadStories(add);
  addWhatToWatchStories(add, matchupStates);
  addEarlyMomentumStories(add, matchupStates);
  // Newest story; a bug in it shouldn't take down the whole wire.
  try { addGameToWatchStory(add, matchupStates); } catch (error) { console.warn("League Wire: game to watch failed: " + error.message); }

  const biggestLead=matchupStates.filter(x=>!x.m.completed).sort((a,b)=>b.diff-a.diff)[0];
  if(biggestLead&&biggestLead.diff>=20){const leader=biggestLead.currentDiff>0?biggestLead.a.team:biggestLead.b.team;const trailer=biggestLead.currentDiff>0?biggestLead.b.team:biggestLead.a.team;add("LEAGUE GOSSIP","👀 League gossip: " + leader + " has " + money(biggestLead.diff) + " pts to play with against " + trailer + ".",28);}
  else if(regret?.bestSwap) add("LEAGUE GOSSIP","👀 League gossip: " + regret.team + " may be wishing they trusted " + regret.bestSwap.benchPlayer.name + " — " + pts(regret.bestSwap.benchPlayer.actual) + " are sitting on the bench.",regret.bestSwap.benchPlayer.actual+5);
  else if(close && Number(close.a.score) + Number(close.b.score) > 0) add("LEAGUE GOSSIP","👀 League gossip: " + close.a.team + " and " + close.b.team + " are separated by " + money(close.diff) + " pts. Somebody's Sunday just got interesting.",26-close.diff);
  return stories.filter((story,i,arr)=>arr.findIndex(x=>x.text===story.text)===i).sort((a,b)=>b.score-a.score);
}
// Waiver-wire news: players added in the last week. Hot pickups when they're
// already producing; otherwise the freshest adds and their projections, which
// keeps the League Wire lively between games.
const PICKUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
function addPickupStories(add) {
  const pickups = (rosterData.teams || []).flatMap(t => (t.roster?.entries || [])
    .filter(e => e.acquisitionType === "ADD" && Date.now() - Number(e.acquisitionDate) <= PICKUP_WINDOW_MS && e.playerPoolEntry?.player)
    .map(e => {
      const player = e.playerPoolEntry.player;
      const stat = source => Number((player.stats || []).find(s => Number(s.scoringPeriodId) === currentWeek && Number(s.statSourceId) === source && Number(s.statSplitTypeId) === 1)?.appliedTotal);
      const game = nflGameByProTeam.get(Number(player.proTeamId));
      return {
        name: player.fullName,
        position: POSITIONS[Number(player.defaultPositionId)] || "",
        team: name(Number(t.id)),
        addedOn: Number(e.acquisitionDate),
        bench: Number(e.lineupSlotId) === BENCH_SLOT,
        points: Number.isFinite(stat(0)) ? round(stat(0)) : 0,
        projection: Number.isFinite(stat(1)) ? round(stat(1)) : null,
        played: Boolean(game && game.state !== "pre")
      };
    }));
  const day = ms => new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

  const hot = pickups.filter(p => p.points >= 10).sort((a, b) => b.points - a.points)[0];
  if (hot) {
    add("HOT PICKUP","🛒 HOT PICKUP: " + hot.team + " grabbed " + hot.name + " (" + hot.position + ") off the wire on " + day(hot.addedOn) + ", and it's paying off — " + pts(hot.points) + " this week" + (hot.bench ? " (from the bench!)" : "") + ".",30 + hot.points);
  }
  const fresh = pickups.filter(p => !p.played && p !== hot).sort((a, b) => b.addedOn - a.addedOn).slice(0, 3);
  if (fresh.length) {
    const describe = p => p.team + " added " + p.name + " (" + p.position + (p.projection != null ? ", projected " + pts(p.projection) : "") + ")";
    const versions = fresh.map((_, i) => {
      const more = fresh.length - (i + 1);
      return "🗞️ Fresh off the wire: " + listNames(fresh.slice(0, i + 1).map(describe)) + (more ? ", plus " + more + " more pickup" + (more === 1 ? "" : "s") : "") + ".";
    }).reverse();
    add("FRESH OFF THE WIRE",fit(...versions),24 + fresh.length);
  }
}

// ---- Roster stories ----------------------------------------------------------
// Injury wards (a team missing a lot of draft capital) and bold roster
// constructions (piles of onesies, no depth where it counts). Neither depends
// on the games, so they run all week.
const draftData = await readJson("data/current/mDraftDetail.json").catch(() => null);
const draftRound = new Map((draftData?.draftDetail?.picks || []).map(p => [Number(p.playerId), Number(p.roundId)]));
const settingsData = await readJson("data/current/mSettings.json").catch(() => null);
const slotCounts = settingsData?.settings?.rosterSettings?.lineupSlotCounts || {};
const startersAt = slot => Number(slotCounts[slot] ?? 1);
const OUT_STATUSES = new Set(["OUT", "INJURY_RESERVE", "DOUBTFUL", "SUSPENSION"]);
// Draft capital lost to injury: a 1st-rounder counts 8, a 2nd 7, ... an 8th 1.
const draftValue = round => round ? Math.max(0, 9 - round) : 0;
const INJURY_WARD_MIN_VALUE = 12;
const ONESIE_LABEL = {1:"QB", 4:"TE", 5:"K", 16:"D/ST"};
const BOLD_MIN_SCORE = 4;

function rosterReport(t) {
  const players = (t.roster?.entries || []).filter(e => e.playerPoolEntry?.player).map(e => {
    const player = e.playerPoolEntry.player;
    const status = player.injuryStatus || e.injuryStatus || "ACTIVE";
    return {
      name:player.fullName,
      lastName:(player.lastName || player.fullName).replace(/\s+(Jr\.|Sr\.|II|III|IV)$/, ""),
      positionId:Number(player.defaultPositionId),
      slot:Number(e.lineupSlotId),
      round:draftRound.get(Number(e.playerId)) || null,
      out:OUT_STATUSES.has(status)
    };
  });
  const healthy = players.filter(p => !p.out);
  const count = pos => healthy.filter(p => p.positionId === pos);

  const injured = players.filter(p => p.out && draftValue(p.round) > 0).sort((a, b) => a.round - b.round);
  const injuryValue = injured.reduce((sum, p) => sum + draftValue(p.round), 0);

  // Quirks, each with a weight for how bold it is. Onesie stockpiles count
  // healthy players only, so an injury-forced backup QB isn't "bold".
  const quirks = [];
  const tes = count(4), qbs = count(1), ks = count(5), dsts = count(16);
  if (tes.length >= 3) quirks.push({weight:2 + tes.length - 3, text:tes.length + " TEs", detail:tes.map(p => p.lastName)});
  if (qbs.length >= 3) quirks.push({weight:2 + qbs.length - 3, text:qbs.length + " QBs", detail:qbs.map(p => p.lastName)});
  if (ks.length >= 2) quirks.push({weight:3, text:ks.length + " kickers"});
  if (dsts.length >= 2) quirks.push({weight:1, text:dsts.length + " defenses"});
  const bench = players.filter(p => p.slot === BENCH_SLOT);
  const benchOnesies = bench.filter(p => ONESIE_LABEL[p.positionId]);
  if (bench.length >= 3 && benchOnesies.length === bench.length) quirks.push({weight:3, text:"a bench made entirely of onesies (" + listNames([...new Set(benchOnesies.map(p => ONESIE_LABEL[p.positionId]))]) + ")"});
  else if (bench.length >= 3 && benchOnesies.length / bench.length >= 0.6) quirks.push({weight:1, text:benchOnesies.length + " of " + bench.length + " bench spots on onesies"});
  // No healthy depth behind the starters at RB or WR.
  const thin = [];
  for (const [pos, slot, label] of [[2, 2, "RB"], [3, 4, "WR"]]) {
    const healthyAt = count(pos);
    if (healthyAt.length > startersAt(slot)) continue;
    thin.push({label, healthy:healthyAt.map(p => p.lastName), short:healthyAt.length < startersAt(slot)});
    quirks.push({weight:2, text:(healthyAt.length ? "just " + healthyAt.length : "no") + " healthy " + label + (healthyAt.length === 1 ? "" : "s")});
  }
  quirks.sort((a, b) => b.weight - a.weight);
  return {teamId:Number(t.id), team:name(Number(t.id)), injured, injuryValue, quirks, thin, boldness:quirks.reduce((sum, q) => sum + q.weight, 0)};
}

function addRosterStories(add) {
  const reports = (rosterData.teams || []).map(rosterReport);
  // Roster stories lead the week-ahead wire and sit behind live game stories.
  const pregame = currentScores.every(s => Number(s.score) === 0);
  const COTTON = " It's a bold strategy, Cotton. Let's see if it pays off for 'em.";
  const injuredList = (r, n) => listNames(r.injured.slice(0, n).map(p => p.lastName + " (Rd " + p.round + ")"));
  const injuredNames = (r, n) => listNames(r.injured.slice(0, n).map(p => p.lastName));
  const quirkList = (r, n, withDetail) => listNames(r.quirks.slice(0, n).map(q => q.text + (withDetail && q.detail ? " (" + listNames(q.detail) + ")" : "")));

  const slammed = reports.filter(r => r.injuryValue >= INJURY_WARD_MIN_VALUE).sort((a, b) => b.injuryValue - a.injuryValue)[0];
  const bold = reports.filter(r => r.boldness >= BOLD_MIN_SCORE).sort((a, b) => b.boldness - a.boldness)[0];
  if (slammed) {
    const n = slammed.injured.length;
    add("INJURY WARD",fit(
      "🚑 INJURY WARD: " + slammed.team + " is absolutely slammed — " + injuredList(slammed, 4) + (n > 4 ? " and " + (n - 4) + " more" : "") + (n === 1 ? " is" : " are") + " out.",
      "🚑 INJURY WARD: " + slammed.team + " is without " + injuredList(slammed, 3) + ".",
      "🚑 INJURY WARD: " + slammed.team + " is without " + injuredNames(slammed, 3) + "."
    ),(pregame ? 62 : 32) + slammed.injuryValue / 4);
  }
  if (bold) {
    add("BOLD STRATEGY",fit(
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 3, true) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 2, true) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 2, false) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 1, false) + "." + COTTON
    ),(pregame ? 60 : 30) + bold.boldness);
  }

  // Thin ice: no healthy backup at RB or WR (or already a hole in the
  // lineup). The bold team already got its depth called out.
  const thin = reports.filter(r => r !== bold).flatMap(r => r.thin.map(x => ({...x, team:r.team})))
    .sort((a, b) => b.short - a.short || a.healthy.length - b.healthy.length);
  if (thin.length) {
    const describe = (x, withNames) => x.short
      ? x.team + " is down to " + (x.healthy.length ? x.healthy.length + " healthy " + x.label + (withNames ? " (" + listNames(x.healthy) + ")" : "") : "zero healthy " + x.label + "s")
      : x.team + " has no healthy backup " + x.label + (withNames ? " behind " + listNames(x.healthy) : "");
    const tail = thin[0].short ? " That's already a hole in the lineup." : " One more injury and there's a hole in the lineup.";
    add("THIN ICE",fit(
      "🧊 THIN ICE: " + listNames(thin.slice(0, 2).map(x => describe(x, true))) + "." + tail,
      "🧊 THIN ICE: " + listNames(thin.slice(0, 2).map(x => describe(x, false))) + "." + tail,
      "🧊 THIN ICE: " + describe(thin[0], true) + "." + tail,
      "🧊 THIN ICE: " + describe(thin[0], false) + "." + tail
    ),(pregame ? 58 : 28) + (thin[0].short ? 4 : 0));
  }
}

// Stories from this week's win-odds history (the swing charts): the biggest
// comeback, and games whose odds keep flipping.
// Raffle race (the week's highest score earns a ticket): a new favorite, a
// live threat to the leader, or a near-lock.
function addRaffleStories(add, previousScores) {
  const withOdds = currentScores.filter(s => Number.isFinite(Number(s.topScoreProbability)));
  if (!withOdds.length || withOdds.every(s => Number(s.score) === 0)) return;
  const leader = [...withOdds].sort((a, b) => Number(b.score) - Number(a.score))[0];
  const favorite = [...withOdds].sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];
  const previousFavorite = [...previousScores.values()]
    .filter(s => Number.isFinite(Number(s.topScoreProbability)))
    .sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];

  if (previousFavorite && previousFavorite.teamId !== favorite.teamId && favorite.topScoreProbability >= 40) {
    add("RAFFLE FLIP","🎟️ RAFFLE FLIP: " + favorite.team + " is now the favorite for this week's raffle ticket (" + money(favorite.topScoreProbability) + "%), passing " + previousFavorite.team + ".",87);
  }
  const chaser = withOdds
    .filter(s => s.teamId !== leader.teamId && s.startersLeft > 0 && s.topScoreProbability >= 25)
    .sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];
  if (chaser) {
    const left = (liveTeams.get(chaser.teamId)?.players || []).filter(p => !p.bench && !p.finished).map(p => p.lastName);
    const chase = "🎟️ RAFFLE WATCH: " + chaser.team + " (" + money(chaser.topScoreProbability) + "% to take the ticket) is chasing " + possessive(leader.team) + " " + money(leader.score) + " — " + pts(Number(leader.score) - Number(chaser.score)) + " back";
    add("RAFFLE WATCH",fit(
      chase + (left.length ? " with " + listNames(left) + " still to play" : "") + ".",
      chase + " with " + left.length + " starter" + (left.length === 1 ? "" : "s") + " still to play."
    ),76 + chaser.topScoreProbability / 10);
  } else if (leader.topScoreProbability >= 95 && leader.topScoreProbability < 100) {
    add("RAFFLE LOCK","🎟️ RAFFLE LOCK: " + leader.team + " has all but clinched this week's raffle ticket with " + pts(leader.score) + " (" + money(leader.topScoreProbability) + "%).",62);
  }
}

function addSwingStories(add, matchupStates) {
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (history.length < 3) return;
  const oddsOf = id => history.map(pt => Number(pt.p?.[id])).filter(Number.isFinite);
  const comebacks = [];
  const swingers = [];
  for (const x of matchupStates) {
    for (const [team, opp] of [[x.a, x.b], [x.b, x.a]]) {
      const series = oddsOf(team.teamId);
      const now = series[series.length - 1];
      const low = Math.min(...series);
      if (low <= 25 && now >= 60) comebacks.push({ team, opp, low, now });
    }
    // A flip counts only when the favorite clearly changes (past 55%), so
    // small wobbles around a coin flip don't register.
    let favorite = null;
    let flips = 0;
    for (const p of oddsOf(x.a.teamId)) {
      const side = p > 55 ? "a" : p < 45 ? "b" : favorite;
      if (favorite && side !== favorite) flips++;
      favorite = side;
    }
    if (flips >= 3) swingers.push({ x, flips });
  }
  const wildest = swingers.sort((a, b) => b.flips - a.flips)[0];
  if (wildest) {
    add("HEART ATTACK GAME","💓 HEART ATTACK GAME: the favorite in " + wildest.x.a.team + " vs " + wildest.x.b.team + " has flipped " + wildest.flips + " times this week.",70 + wildest.flips);
  }
  // Momentum shift: the biggest recent swing, comparing now with roughly half
  // an hour ago (the most recent snapshot at least 25 minutes old).
  const MOMENTUM_WINDOW_MS = 25 * 60 * 1000;
  const MOMENTUM_SWING = 20;
  const latest = history[history.length - 1];
  const earlier = [...history].reverse().find(pt => Date.parse(latest.t) - Date.parse(pt.t) >= MOMENTUM_WINDOW_MS);
  if (earlier) {
    const swings = matchupStates.filter(x => !x.m.completed).flatMap(x => [[x.a, x.b], [x.b, x.a]].map(([team, opp]) => ({
      team, opp,
      before: Number(earlier.p?.[team.teamId]),
      after: Number(latest.p?.[team.teamId])
    }))).filter(s => Number.isFinite(s.before) && Number.isFinite(s.after) && s.after - s.before >= MOMENTUM_SWING);
    const biggest = swings.sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
    if (biggest) {
      const minutes = Math.round((Date.parse(latest.t) - Date.parse(earlier.t)) / 60000);
      add("MOMENTUM SHIFT","⚡ MOMENTUM SHIFT: " + possessive(biggest.team.team) + " win odds against " + biggest.opp.team + " jumped from " + money(biggest.before) + "% to " + money(biggest.after) + "% in the last " + minutes + " minutes.",88 + (biggest.after - biggest.before) / 10);
    }
  }

  const best = comebacks.sort((a, b) => a.low - b.low)[0];
  if (best) {
    add("COMEBACK","📈 COMEBACK: " + best.team.team + " was down to " + money(best.low) + "% against " + best.opp.team + (best.now >= 100 ? " — and won." : " — now " + money(best.now) + "% to win."),best.now >= 100 ? 94 : 86);
  }
}

// The guillotine side league's most endangered team this week.
function addDeathWatchStory(add) {
  if (Number(guillotineData?.week) !== currentWeek) return;
  const atRisk = (guillotineData.teams || []).filter(t => t.chopProbability > 0);
  const [first, second] = atRisk;
  if (!first) return;
  const left = t => playersWithGames((t.remaining || []).map(p => ({name:p.name.split(" ").slice(-1)[0], game:p.game})));
  if (first.chopProbability >= 100) {
    add("DEATH WATCH","🪓 DEATH WATCH: the blade has fallen — " + first.team + " is getting chopped from " + guillotineData.leagueName + " with " + pts(first.score) + ".",90);
  } else if (first.survivalNeed && first.playersLeft) {
    add("DEATH WATCH","🪓 DEATH WATCH: " + first.team + " (" + money(first.chopProbability) + "% chop odds) needs " + pts(first.survivalNeed.points) + " more from " + left(first) + " to pass " + first.survivalNeed.passTeam + " and survive.",86);
  } else if (second?.survivalNeed && second.playersLeft) {
    add("DEATH WATCH","🪓 DEATH WATCH: " + first.team + " is on the chopping block (" + money(first.chopProbability) + "%) — unless " + left(second) + " can't find " + pts(second.survivalNeed.points) + " for " + second.team + ".",86);
  } else {
    add("DEATH WATCH","🪓 DEATH WATCH: " + first.team + " leads the chopping-block odds at " + money(first.chopProbability) + "%" + (second ? ", with " + second.team + " next at " + money(second.chopProbability) + "%" : "") + ".",70);
  }
}

// Settled start/sit mistakes that cost (or are costing) a team its matchup.
function addLineupMistakeStories(add, matchupStates, regrets) {
  const regretByTeam = new Map(regrets.map(r => [r.teamId, r]));
  const candidates = [];
  for (const x of matchupStates) {
    for (const [team, opp] of [[x.a, x.b], [x.b, x.a]]) {
      const swap = regretByTeam.get(team.teamId)?.bestSwap;
      if (!swap) continue;
      const score = Number(team.score);
      const oppScore = Number(opp.score);
      const swappedScore = score + swap.gain;
      const teamDone = x.m.completed || team.startersLeft === 0;
      const oppDone = x.m.completed || opp.startersLeft === 0;
      // With and without each player's points.
      const swapTexts = [
        swap.benchPlayer.name + " (" + pts(swap.benchPlayer.actual) + ") over " + swap.starter.name + " (" + pts(swap.starter.actual) + ")",
        swap.benchPlayer.name + " over " + swap.starter.name
      ];
      if (score < oppScore && swappedScore > oppScore && teamDone && oppDone) {
        candidates.push({type:"INSTANT REGRET", text:fit(...swapTexts.map(t => "😱 INSTANT REGRET: " + team.team + " would have beaten " + opp.team + " by starting " + t + ". Oops!")), score:97});
      } else if (score < oppScore && swappedScore > oppScore && oppDone) {
        candidates.push({type:"INSTANT REGRET", text:fit(...swapTexts.map(t => "😱 INSTANT REGRET: " + team.team + " needs " + pts(oppScore - score) + " more to beat " + opp.team + ". Starting " + t + " would have locked it up.")), score:95});
      } else if (score < oppScore && swappedScore > oppScore) {
        candidates.push({type:"LINEUP MISTAKE", text:fit(...swapTexts.map(t => "😬 " + team.team + " would be leading " + opp.team + " if they'd started " + t + " — instead they trail by " + pts(oppScore - score) + ".")), score:88});
      } else if (!teamDone || !oppDone) {
        const winOdds = Number(team.winProbability);
        if (swap.gain >= 5 && winOdds >= 30 && winOdds <= 70) {
          candidates.push({type:"LINEUP MISTAKE", text:fit(...swapTexts.map(t => "😅 " + team.team + " is sweating out a close one with " + opp.team + " (" + money(winOdds) + "% to win). Starting " + t + " would have helped.")), score:80});
        }
      }
    }
  }
  candidates.sort((a,b) => b.score - a.score).slice(0, 2).forEach(c => add(c.type, c.text, c.score));
}

// Down-to-the-wire storylines once a matchup comes down to a few players
// (typically Sunday and Monday night), plus which matchups and median races
// are still live.
function addPrimetimeStories(add, matchupStates) {
  const startersLeft = teamId => (liveTeams.get(teamId)?.players || []).filter(p => !p.bench && !p.finished);
  const withGame = p => p.lastName + (p.game?.name ? " (" + p.game.name + ")" : "");
  const withGames = players => playersWithGames(players.map(p => ({name:p.lastName, game:p.game?.name})));
  const projectedRest = players => round(players.reduce((sum, p) => sum + Math.max(0, (p.projection ?? 0) - p.actual), 0));

  // Odds below this are long shots: they get one "there's a chance" story
  // instead of a headline. Outcomes no simulation produced aren't mentioned
  // (the odds floor is 0.01% because every open outcome starts with one win).
  const LONG_SHOT_ODDS = 10;
  const NO_SIMULATED_WINS = 0.01;
  const storylines = [];
  const longShots = [];
  for (const x of matchupStates) {
    if (x.m.completed) continue;
    const [leader, trailer] = Number(x.a.score) >= Number(x.b.score) ? [x.a, x.b] : [x.b, x.a];
    const leaderLeft = startersLeft(leader.teamId);
    const trailerLeft = startersLeft(trailer.teamId);
    // A trailing team with no one left can't catch up, and a matchup with lots
    // of players still to go isn't a storyline yet.
    if (!trailerLeft.length || leaderLeft.length + trailerLeft.length > 3) continue;
    const trailerOdds = Number(trailer.winProbability);
    if (!Number.isFinite(trailerOdds) || trailerOdds <= NO_SIMULATED_WINS) continue;
    const deficit = round(Number(leader.score) - Number(trailer.score));
    const urgency = 92 - Math.min(deficit, 30) / 10;
    const odds = money(trailerOdds) + "%";

    if (trailerOdds < LONG_SHOT_ODDS) {
      const chance = "🤞 So you're saying there's a chance… ";
      let text;
      if (!leaderLeft.length && trailerLeft.length === 1) {
        const p = trailerLeft[0];
        const projected = p.projection != null ? " (ESPN projects " + pts(p.projection) + ")" : "";
        text = fit(
          chance + trailer.team + " (" + odds + ") needs " + withGame(p) + " to top " + pts(round(p.actual + deficit)) + projected + " to steal it from " + leader.team + ".",
          chance + trailer.team + " (" + odds + ") needs " + p.lastName + " to top " + pts(round(p.actual + deficit)) + " to steal it from " + leader.team + "."
        );
      } else if (!leaderLeft.length) {
        text = fit(
          chance + trailer.team + " (" + odds + ") needs " + pts(deficit) + " from " + withGames(trailerLeft) + " to catch " + leader.team + ".",
          chance + trailer.team + " (" + odds + ") needs " + pts(deficit) + " from " + listNames(trailerLeft.map(p => p.lastName)) + " to catch " + leader.team + "."
        );
      } else {
        text = fit(
          chance + trailer.team + " (" + odds + ") trails " + leader.team + " by " + pts(deficit) + ", but a big night from " + withGames(trailerLeft) + " and a quiet one from " + listNames(leaderLeft.map(p => p.lastName)) + " could flip it.",
          chance + trailer.team + " (" + odds + ") trails " + leader.team + " by " + pts(deficit) + ", but a big night from " + listNames(trailerLeft.map(p => p.lastName)) + " could flip it."
        );
      }
      longShots.push({type:"LONG SHOT", text, score:66 + trailerOdds});
      continue;
    }

    if (!leaderLeft.length && trailerLeft.length === 1) {
      const p = trailerLeft[0];
      const target = round(p.actual + deficit);
      const soFar = p.actual > 0 ? " (" + money(p.actual) + " so far)" : "";
      const projected = p.projection != null ? " ESPN projects " + pts(p.projection) + "." : "";
      storylines.push({type:"ALL EYES ON", text:fit(
        "👀 All eyes on " + withGame(p) + ": if " + p.lastName + " tops " + pts(target) + soFar + ", " + trailer.team + " (" + odds + ") beats " + leader.team + "." + projected,
        "👀 All eyes on " + withGame(p) + ": if " + p.lastName + " tops " + pts(target) + ", " + trailer.team + " (" + odds + ") beats " + leader.team + ".",
        "👀 All eyes on " + p.lastName + ": " + pts(target) + " and " + trailer.team + " (" + odds + ") beats " + leader.team + "."
      ), score:urgency + 3});
    } else if (!leaderLeft.length) {
      storylines.push({type:"COMEBACK WATCH", text:fit(
        "⏳ " + trailer.team + " (" + odds + ") needs " + pts(deficit) + " more from " + withGames(trailerLeft) + " to catch " + leader.team + ". ESPN projects " + pts(projectedRest(trailerLeft)) + ".",
        "⏳ " + trailer.team + " (" + odds + ") needs " + pts(deficit) + " more from " + withGames(trailerLeft) + " to catch " + leader.team + ".",
        "⏳ " + trailer.team + " (" + odds + ") needs " + pts(deficit) + " more from " + listNames(trailerLeft.map(p => p.lastName)) + " to catch " + leader.team + "."
      ), score:urgency});
    } else {
      storylines.push({type:"SHOWDOWN", text:fit(
        "⚔️ SHOWDOWN: " + leader.team + " leads " + trailer.team + " (" + odds + ") by " + pts(deficit) + " — it's " + withGames(leaderLeft) + " vs " + withGames(trailerLeft) + " the rest of the way.",
        "⚔️ SHOWDOWN: " + leader.team + " leads " + trailer.team + " (" + odds + ") by " + pts(deficit) + " — it's " + listNames(leaderLeft.map(p => p.lastName)) + " vs " + listNames(trailerLeft.map(p => p.lastName)) + " the rest of the way."
      ), score:urgency});
    }
  }
  storylines.sort((a,b) => b.score - a.score).slice(0, 4).forEach(story => add(story.type, story.text, story.score));
  // At most one long shot, the likeliest one.
  longShots.sort((a,b) => b.score - a.score).slice(0, 1).forEach(story => add(story.type, story.text, story.score));

  // Undecided matchups where the favorite isn't a lock.
  const live = matchupStates
    .filter(x => !x.m.completed && (x.a.startersLeft !== 0 || x.b.startersLeft !== 0))
    .map(x => {
      const fav = Number(x.a.winProbability) >= Number(x.b.winProbability) ? x.a : x.b;
      return {x, fav, odds:Number(fav.winProbability)};
    })
    .filter(m => Number.isFinite(m.odds) && m.odds <= 80)
    .sort((a,b) => a.odds - b.odds);
  if (live.length) {
    const describe = m => m.x.a.team + " vs " + m.x.b.team + " (" + m.fav.team + " " + money(m.odds) + "%)";
    add("MATCHUPS THAT MATTER",fit(
      "🏈 Matchups that matter: " + live.map(describe).join(" · ") + ".",
      "🏈 " + live.length + " matchups are still up for grabs, and " + describe(live[0]) + " is the tightest.",
      "🏈 " + live.length + " matchups are still up for grabs, and " + live[0].x.a.team + " vs " + live[0].x.b.team + " is the tightest."
    ),60 + live.length);
  }

  // Median races that come down to one or two players.
  const medianStakes = currentScores
    .filter(s => isNearMedian(s))
    .map(s => ({s, left:startersLeft(s.teamId)}))
    .filter(m => m.left.length && m.left.length <= 2)
    .sort((a,b) => Math.abs(Number(a.s.aboveMedianProbability) - 50) - Math.abs(Number(b.s.aboveMedianProbability) - 50))
    .slice(0, 2);
  for (const {s, left} of medianStakes) {
    add("MEDIAN STAKES","🎯 MEDIAN STAKES: " + possessive(s.team) + " shot at a median win (" + money(s.aboveMedianProbability) + "%) rides on " + withGames(left) + ".",74);
  }
}

// ---- What to watch ---------------------------------------------------------
// Between games: the next kickoff slot (games starting within half an hour of
// the first one), which league starters play in it, and what's riding on it.
const SLOT_SPREAD_MS = 30 * 60 * 1000;
const WATCH_AHEAD_MS = 36 * 60 * 60 * 1000;
const kickoffLabel = iso => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {weekday:"long", timeZone:"America/New_York"});
  const time = d.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", timeZone:"America/New_York"}).replace(":00", "");
  return day + " " + time;
};
function addWhatToWatchStories(add, matchupStates) {
  if (nflGames.some(g => g.state === "in")) return;
  const upcoming = nflGames.filter(g => g.state === "pre" && g.kickoff).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (!upcoming.length) return;
  const first = Date.parse(upcoming[0].kickoff);
  if (first - Date.now() > WATCH_AHEAD_MS) return;
  const slot = new Set(upcoming.filter(g => Date.parse(g.kickoff) - first <= SLOT_SPREAD_MS).map(g => g.id));
  const inSlot = teamId => (liveTeams.get(teamId)?.players || []).filter(p => !p.bench && p.game && slot.has(p.game.id));
  const when = kickoffLabel(upcoming[0].kickoff) + (slot.size === 1 ? " (" + upcoming[0].name + ")" : "");

  const stakes = matchupStates.filter(x => !x.m.completed).map(x => {
    const players = [...inSlot(x.a.teamId), ...inSlot(x.b.teamId)];
    const projected = round(players.reduce((sum, p) => sum + (p.projection ?? 0), 0));
    const odds = Number(x.a.winProbability);
    return {x, players, projected, closeness:Number.isFinite(odds) ? 1 - Math.abs(odds - 50) / 50 : 0.5};
  }).filter(m => m.players.length);
  const starters = stakes.reduce((n, m) => n + m.players.length, 0);
  if (!starters) return;
  const top = [...stakes].sort((a, b) => b.projected - a.projected)[0];
  const startsFor = teamId => { const ps = inSlot(teamId); return ps.length ? listNames(ps.map(shortName)) + " for " + name(teamId) : null; };
  const lineups = [...new Set(stakes.flatMap(m => [m.x.a.teamId, m.x.b.teamId]))].map(startsFor).filter(Boolean);
  add("WHAT TO WATCH",fit(
    "📺 Up next, " + when + ": " + lineups.join("; ") + ".",
    "📺 Up next, " + when + ": " + starters + " league starters in action. Most riding on it: " + top.x.a.team + " vs " + top.x.b.team + " (" + pts(top.projected) + " projected).",
    "📺 Up next, " + when + ": " + starters + " league starters, led by " + top.x.a.team + " vs " + top.x.b.team + ".",
    "📺 Up next, " + when + ": " + starters + " league starters in action."
  ),76);

  // The starter whose game matters most: a big projection in a close matchup.
  const swing = stakes.flatMap(m => m.players.map(p => ({p, m, weight:(p.projection ?? 0) * m.closeness})))
    .sort((a, b) => b.weight - a.weight)[0];
  if (swing && swing.weight > 0) {
    const mine = name(swing.p.teamId), other = swing.p.teamId === swing.m.x.a.teamId ? swing.m.x.b : swing.m.x.a;
    const odds = Number(currentScores.find(s => s.teamId === swing.p.teamId)?.winProbability);
    add("PLAYER TO WATCH",fit(
      "🔭 Player to watch: " + swing.p.name + (swing.p.game ? " (" + swing.p.game.name + ")" : "") + ". ESPN projects " + pts(swing.p.projection ?? 0) + ", and " + mine + (Number.isFinite(odds) ? " is " + money(odds) + "%" : " is in a tight one") + " against " + other.team + ".",
      "🔭 Player to watch: " + shortName(swing.p) + ", with " + mine + (Number.isFinite(odds) ? " at " + money(odds) + "%" : "") + " against " + other.team + "."
    ),70);
  }
}

// ---- Game to watch ---------------------------------------------------------
// The NFL game (live, or kicking off within 36 hours) that could move the most
// odds: how far a big versus a quiet game from the league's starters in it
// swings each H2H matchup and each median race (normal approximation from
// the projections), plus the guillotine league's chop odds (from its
// simulations), added up.
const GAME_WATCH_MIN_SWING = 15;
function addGameToWatchStory(add, matchupStates) {
  const sdIn = (teamId, gameId) => Math.hypot(...(liveTeams.get(teamId)?.players || [])
    .filter(p => !p.bench && !p.finished && p.game?.id === gameId)
    .map(p => playerOutlook({actual:p.actual, projection:p.projection, positionId:p.positionId}).sd));
  const candidates = nflGames.filter(g => !g.completed && (g.state === "in" || (g.kickoff && Date.parse(g.kickoff) - Date.now() <= WATCH_AHEAD_MS)));
  const games = candidates.map(g => {
    const starters = [...liveTeams.values()].flatMap(t => t.players).filter(p => !p.bench && !p.finished && p.game?.id === g.id);
    const pointsLeft = round(starters.reduce((sum, p) => sum + Math.max(0, (p.projection ?? 0) - p.actual), 0));
    const h2h = matchupStates.filter(x => !x.m.completed).map(x => ({
      x, swing:swingOdds(x.a.winProbability, Math.hypot(sdIn(x.a.teamId, g.id), sdIn(x.b.teamId, g.id)), Math.hypot(Number(x.a.projectionSd) || 0, Number(x.b.projectionSd) || 0))
    })).sort((a, b) => b.swing - a.swing);
    const median = currentScores.map(s => ({s, swing:swingOdds(s.aboveMedianProbability, sdIn(s.teamId, g.id), Number(s.projectionSd))})).sort((a, b) => b.swing - a.swing);
    const chop = (guillotineData?.teams || []).map(t => {
      const gs = (t.gameSwings || []).find(x => x.game === g.name);
      return gs ? {t, swing:round(gs.chopIfBelow - gs.chopIfAbove)} : null;
    }).filter(Boolean).sort((a, b) => b.swing - a.swing);
    const total = [...h2h, ...median, ...chop].reduce((sum, x) => sum + x.swing, 0);
    return {g, starters, pointsLeft, h2h:h2h[0], median:median[0], chop:chop[0], total};
  }).filter(x => x.starters.length).sort((a, b) => b.total - a.total);
  const best = games[0];
  if (!best || Math.max(best.h2h?.swing || 0, best.median?.swing || 0, best.chop?.swing || 0) < GAME_WATCH_MIN_SWING) return;

  const when = best.g.state === "in" ? "live now" : kickoffLabel(best.g.kickoff);
  const stakes = [
    best.h2h?.swing >= GAME_WATCH_MIN_SWING ? best.h2h.x.a.team + " vs " + best.h2h.x.b.team + " by " + Math.round(best.h2h.swing) + "%" : null,
    best.median?.swing >= GAME_WATCH_MIN_SWING ? possessive(best.median.s.team) + " median odds by " + Math.round(best.median.swing) + "%" : null,
    best.chop?.swing >= 10 ? possessive(best.chop.t.team) + " chop odds by " + Math.round(best.chop.swing) + "%" : null
  ].filter(Boolean);
  const intro = "🏟️ Game to watch: " + best.g.name + " (" + when + "), " + best.starters.length + " league starters in action with " + pts(best.pointsLeft) + " up for grabs.";
  add("GAME TO WATCH",fit(
    intro + " It could swing " + listNames(stakes) + ".",
    intro + " It could swing " + listNames(stakes.slice(0, 2)) + ".",
    intro + " It could swing " + stakes[0] + ".",
    intro
  ),best.g.state === "in" ? 82 : 77);
}

// ---- Early momentum ---------------------------------------------------------
// Early in the week (most starters yet to play): the matchup whose win odds
// have moved most since the week began, and who moved them. Plus the single
// play that swung a matchup the most in the last 45 minutes.
const EARLY_SHARE_PLAYED = 0.4;
// Last name, except defenses keep their team ("Steelers D/ST", not "D/ST").
const shortName = p => /D\/ST/.test(p.lastName) ? p.name : p.lastName;
const EARLY_MIN_SWING = 5;
const BIG_PLAY_WINDOW_MS = 45 * 60 * 1000;
const BIG_PLAY_MIN_SHIFT = 4;
const livePlayFeed = await readJson("data/current/live-plays.json").catch(() => null);
function addEarlyMomentumStories(add, matchupStates) {
  const starters = [...liveTeams.values()].flatMap(t => t.players).filter(p => !p.bench);
  const started = starters.filter(p => p.game && p.game.state !== "pre");
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (started.length && starters.length && started.length / starters.length <= EARLY_SHARE_PLAYED && history.length >= 2) {
    const baseline = history[0], latest = history[history.length - 1];
    const movers = matchupStates.flatMap(x => [[x.a, x.b], [x.b, x.a]]).map(([team, opp]) => ({
      team, opp, before:Number(baseline.p?.[team.teamId]), after:Number(latest.p?.[team.teamId])
    })).filter(m => Number.isFinite(m.before) && Number.isFinite(m.after) && m.after - m.before >= EARLY_MIN_SWING)
      .sort((a, b) => (b.after - b.before) - (a.after - a.before));
    const best = movers[0];
    if (best) {
      const leader = started.filter(p => p.teamId === best.team.teamId).sort((a, b) => b.actual - a.actual)[0];
      const by = leader && leader.actual > 0 ? ", led by " + shortName(leader) + " (" + pts(leader.actual) + ")" : "";
      const others = movers.slice(1, 3).filter(m => m.team.teamId !== best.opp.teamId);
      add("EARLY EDGE",fit(
        "⚡ Early edge: " + best.team.team + " went from " + money(best.before) + "% to " + money(best.after) + "% against " + best.opp.team + by + "." + (others.length ? " Also up: " + listNames(others.map(m => m.team.team + " (+" + money(m.after - m.before) + ")")) + "." : ""),
        "⚡ Early edge: " + best.team.team + " went from " + money(best.before) + "% to " + money(best.after) + "% against " + best.opp.team + by + ".",
        "⚡ Early edge: " + best.team.team + " is up to " + money(best.after) + "% against " + best.opp.team + by + "."
      ),80 + (best.after - best.before) / 10);
    }
  }

  const bigPlay = (Number(livePlayFeed?.week) === currentWeek ? livePlayFeed.plays || [] : [])
    .filter(p => p.momentum?.shift >= BIG_PLAY_MIN_SHIFT && p.wallclock && Date.now() - Date.parse(p.wallclock) <= BIG_PLAY_WINDOW_MS)
    .sort((a, b) => b.momentum.shift - a.momentum.shift)[0];
  if (bigPlay) {
    const team = name(Number(bigPlay.fantasyTeamId));
    const sign = bigPlay.points > 0 ? "+" : "";
    add("BIGGEST PLAY",fit(
      "💥 Biggest play: " + bigPlay.player + " (" + sign + pts(bigPlay.points) + " for " + team + ") swung the odds " + money(bigPlay.momentum.shift) + "% toward " + bigPlay.momentum.toward + ", now " + money(bigPlay.momentum.winProbability) + "%.",
      "💥 Biggest play: " + bigPlay.player + " (" + sign + pts(bigPlay.points) + ") swung the odds " + money(bigPlay.momentum.shift) + "% toward " + bigPlay.momentum.toward + "."
    ),84 + bigPlay.momentum.shift / 5);
  }
}

const keyPlays = await buildKeyPlays();
await writeJson("data/current/key-plays.json", {
  week: currentWeek,
  updatedAt: new Date().toISOString(),
  plays: keyPlays
});

// ---- Week in review -------------------------------------------------------
// For 48 hours after the last game of a week (usually MNF), the wire mixes
// that week's biggest storylines in with stories about the week ahead.
const REVIEW_HOURS_AFTER_LAST_GAME = 48;
const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;
const season = Number(process.env.ESPN_SEASON || matchupData.seasonId || new Date().getFullYear());

// Swing headlines, in the past tense, for matchups already decided. Saved in
// marquee.json so they outlive the scoreboard's win history once the week
// rolls over. Returns null when there's nothing decided to report.
function weekHeadlines() {
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (history.length < 3) return null;
  const oddsOf = id => history.map(pt => Number(pt.p?.[id])).filter(Number.isFinite);
  const byTeam = new Map(currentScores.map(s => [s.teamId, s]));
  const stories = [];
  const comebacks = [];
  const wild = [];
  for (const m of currentWeekMatchups) {
    const a = byTeam.get(m.homeTeamId), b = byTeam.get(m.awayTeamId);
    if (!a || !b) continue;
    const winner = Number(a.winProbability) >= 100 ? a : Number(b.winProbability) >= 100 ? b : null;
    if (!winner) continue;
    const loser = winner === a ? b : a;
    const low = Math.min(...oddsOf(winner.teamId));
    if (low <= 25) comebacks.push({winner, loser, low});
    let favorite = null, flips = 0;
    for (const p of oddsOf(a.teamId)) {
      const side = p > 55 ? "a" : p < 45 ? "b" : favorite;
      if (favorite && side !== favorite) flips++;
      favorite = side;
    }
    if (flips >= 3) wild.push({winner, loser, flips});
  }
  const escape = comebacks.sort((x, y) => x.low - y.low)[0];
  if (escape) stories.push({type:"GREAT ESCAPE", text:"📈 " + escape.winner.team + " was down to " + money(escape.low) + "% against " + escape.loser.team + " — and won.", score:78});
  const wildest = wild.sort((x, y) => y.flips - x.flips)[0];
  if (wildest) stories.push({type:"HEART ATTACK GAME", text:"💓 " + wildest.winner.team + " outlasted " + wildest.loser.team + " after the favorite flipped " + wildest.flips + " times.", score:74});
  return stories.length ? {week:currentWeek, stories} : null;
}

// When the week's last NFL game kicked off (cached in marquee.json).
async function lastKickoff(week, previous) {
  if (previous?.review?.week === week && previous.review.lastKickoff) return previous.review.lastKickoff;
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`);
    if (!response.ok) return null;
    const dates = ((await response.json()).events || []).map(e => Date.parse(e.date)).filter(Number.isFinite);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  } catch {
    return null;
  }
}

async function weekInReview(previous, archive) {
  const week = currentWeek - 1;
  if (week < 1) return {stories:[], meta:null};
  const kickoff = await lastKickoff(week, previous);
  const meta = {week, lastKickoff:kickoff};
  const reviewUntil = kickoff ? Date.parse(kickoff) + GAME_LENGTH_MS + REVIEW_HOURS_AFTER_LAST_GAME * 60 * 60 * 1000 : 0;
  if (Date.now() > reviewUntil) return {stories:[], meta};

  const label = type => "WEEK " + week + " · " + type;
  const stories = [];
  const weekly = await readJson("data/current/weekly.json").catch(() => null);
  const recap = (weekly?.weeks || []).find(w => Number(w.week) === week)?.recap || [];
  const RECAP_SCORES = {"HIGH SCORE":80, "CLOSEST MATCHUP":79, "INSTANT REGRET":77, "TOUGH LUCK":72, "BLOWOUT":70, "LUCKY WIN":69, "BIGGEST REGRET":62};
  for (const story of recap) stories.push({type:label(story.type), text:story.text, score:RECAP_SCORES[story.type] ?? 60});
  if (archive?.week === week) for (const story of archive.stories) stories.push({...story, type:label(story.type)});
  const chop = (guillotineData?.chopped || []).find(c => Number(c.week) === week);
  if (chop) stories.push({type:label("CHOPPED"), text:"🪦 " + chop.team + " got the axe in " + (guillotineData.leagueName || "the guillotine league") + " with " + pts(chop.finalScore) + (chop.survivedBy ? ", " + pts(chop.margin) + " short of " + chop.survivedBy.team : "") + ".", score:76});
  return {stories:stories.sort((a, b) => b.score - a.score), meta};
}

// Alternate review and current stories so neither crowds the other out.
function interleave(first, second) {
  const out = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (i < second.length) out.push(second[i]);
    if (i < first.length) out.push(first[i]);
  }
  return out;
}

// ---- Week ahead -----------------------------------------------------------
// Before anyone in the league has scored this week: rivalry history, streaks,
// big matchups at the top (or bottom) of the standings, and title odds.
async function readOptional(path) { return readJson(path).catch(() => null); }
const recordBook = await readOptional("data/current/record-book.json");
const standingsData = await readOptional("data/current/standings.json");
const seasonOddsData = await readOptional("data/current/season-odds.json");

function addWeekAheadStories(add) {
  if (currentScores.some(s => Number(s.score) !== 0)) return;
  const record = t => t ? t.h2hWins + "–" + t.h2hLosses : "";
  const standings = (standingsData?.standings || []);
  const rankOf = new Map(standings.map((t, i) => [Number(t.id), {...t, rank:i + 1}]));

  // Rivalries: the most-played series among this week's matchups.
  const managerOf = recordBook?.currentTeamManagers || {};
  const series = currentWeekMatchups.map(m => {
    const ma = managerOf[m.homeTeamId], mb = managerOf[m.awayTeamId];
    const r = (recordBook?.rivalries || []).find(x => (x.a === ma && x.b === mb) || (x.a === mb && x.b === ma));
    if (!r || r.games < 3) return null;
    const teamFor = manager => manager === ma ? m.homeTeamId : m.awayTeamId;
    return {r, teamFor};
  }).filter(Boolean).sort((x, y) => y.r.games - x.r.games);
  for (const {r, teamFor} of series.slice(0, 2)) {
    const [lead, trail, lw, tw] = r.aWins >= r.bWins ? [r.a, r.b, r.aWins, r.bWins] : [r.b, r.a, r.bWins, r.aWins];
    const recordText = lw === tw ? name(teamFor(lead)) + " and " + name(teamFor(trail)) + " are all square at " + lw + "–" + tw + (r.ties ? "–" + r.ties : "") + " all-time"
      : name(teamFor(lead)) + " leads " + name(teamFor(trail)) + " " + lw + "–" + tw + (r.ties ? "–" + r.ties : "") + " all-time";
    const streak = r.streak?.length >= 2 ? ", and " + name(teamFor(r.streak.manager)) + " has won the last " + r.streak.length : "";
    add("RIVALRY WEEK","🤝 Rivalry week: " + recordText + streak + ".",64 + Math.min(r.games, 10) / 2);
  }

  // Streaks worth mentioning, with who's next.
  const opponentOf = id => { const m = currentWeekMatchups.find(x => x.homeTeamId === id || x.awayTeamId === id); return m ? name(m.homeTeamId === id ? m.awayTeamId : m.homeTeamId) : null; };
  const hot = standings.filter(t => t.streak?.type === "W" && t.streak.length >= 3).sort((a, b) => b.streak.length - a.streak.length)[0];
  if (hot && opponentOf(hot.id)) add("ON A ROLL","🔥 " + hot.name + " has won " + hot.streak.length + " straight. " + opponentOf(hot.id) + " gets the next crack at them.",58 + hot.streak.length);
  const cold = standings.filter(t => t.streak?.type === "L" && t.streak.length >= 3).sort((a, b) => b.streak.length - a.streak.length)[0];
  if (cold && opponentOf(cold.id)) add("SKID WATCH","🥶 " + cold.name + " has dropped " + cold.streak.length + " straight. Can they snap it against " + opponentOf(cold.id) + "?",56 + cold.streak.length);

  // Top-of-the-table clash, or a battle of the winless.
  const clash = currentWeekMatchups.map(m => ({m, a:rankOf.get(m.homeTeamId), b:rankOf.get(m.awayTeamId)}))
    .filter(x => x.a && x.b).sort((x, y) => (x.a.rank + x.b.rank) - (y.a.rank + y.b.rank))[0];
  if (clash && clash.a.rank <= 4 && clash.b.rank <= 4) {
    const [hi, lo] = clash.a.rank < clash.b.rank ? [clash.a, clash.b] : [clash.b, clash.a];
    add("HEAVYWEIGHT BOUT","🥊 Heavyweight bout: #" + hi.rank + " " + hi.name + " (" + record(hi) + ") meets #" + lo.rank + " " + lo.name + " (" + record(lo) + ").",68);
  }
  const winless = currentWeekMatchups.map(m => [rankOf.get(m.homeTeamId), rankOf.get(m.awayTeamId)])
    .find(([a, b]) => a && b && a.games > 0 && a.h2hWins === 0 && b.h2hWins === 0);
  if (winless) add("TOILET BOWL PREVIEW","🚽 Something's gotta give: winless " + winless[0].name + " and " + winless[1].name + " meet, and one of them gets off the schneid.",62);

  // Title favorite from the season simulation.
  const odds = (seasonOddsData?.teams || []).slice().sort((a, b) => b.titleOdds - a.titleOdds);
  if (odds.length >= 2 && Number(seasonOddsData.week) === currentWeek) {
    add("TITLE ODDS","🏆 Title odds entering Week " + currentWeek + ": " + odds[0].team + " " + money(odds[0].titleOdds) + "%, " + odds[1].team + " " + money(odds[1].titleOdds) + "%" + (odds[2] ? ", " + odds[2].team + " " + money(odds[2].titleOdds) + "%" : "") + ".",57);
  }
}

const previousMarquee = await readJson("data/current/marquee.json").catch(() => null);
const headlines = weekHeadlines() || previousMarquee?.headlines || null;
const review = await weekInReview(previousMarquee, headlines);
const marqueeStories = interleave(review.stories, buildMarqueeStories());
await writeJson("data/current/marquee.json",{week:currentWeek,lastUpdated:new Date().toISOString(),stories:marqueeStories,headlines,review:review.meta});
