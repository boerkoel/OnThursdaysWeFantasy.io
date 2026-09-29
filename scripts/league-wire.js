import { readFile, writeFile } from "node:fs/promises";
import { round } from "./lib/simulation.js";

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
const BENCH_SLOT = 20;
const IR_SLOT = 21;

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

// Best total from filling `slots` with `players` (each used at most once, only
// in slots they're eligible for). Every slot must be filled.
function optimalFill(slots, players) {
  const full = (1 << slots.length) - 1;
  const memo = new Map();
  const best = (i, used) => {
    if (i >= players.length) return used === full ? 0 : -Infinity;
    const key = i + "|" + used;
    if (memo.has(key)) return memo.get(key);
    let value = best(i + 1, used);
    for (let s = 0; s < slots.length; s++) {
      if (used & (1 << s) || !players[i].eligibleSlots.includes(slots[s])) continue;
      value = Math.max(value, players[i].actual + best(i + 1, used | (1 << s)));
    }
    memo.set(key, value);
    return value;
  };
  return best(0, 0);
}

// Settled lineup decisions: only players whose games are over can be swapped,
// so an unplayed starter never looks like a mistake. Returns points left on
// the bench and the single best bench-for-starter swap.
function settledLineupRegret(liveTeam) {
  const finished = liveTeam.players.filter(p => p.finished);
  const starters = finished.filter(p => !p.bench);
  const bench = finished.filter(p => p.bench);
  const actual = starters.reduce((sum, p) => sum + p.actual, 0);
  const optimal = starters.length ? optimalFill(starters.map(p => p.slot), finished) : actual;
  let bestSwap = null;
  for (const b of bench) for (const s of starters) {
    const gain = b.actual - s.actual;
    if (gain > 0 && b.eligibleSlots.includes(s.slot) && (!bestSwap || gain > bestSwap.gain)) {
      bestSwap = {benchPlayer:b, starter:s, gain:round(gain)};
    }
  }
  return {
    pointsLeft:round(Math.max(0, optimal - actual)),
    finishedStarters:starters.length,
    finishedBench:bench.length,
    bestSwap
  };
}

const pts = n => money(n) + " pts";
const possessive = team => team + (team.endsWith("s") ? "'" : "'s");
const listNames = names => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

function buildMarqueeStories() {
  const stories = [];
  const previousScores = new Map((previousScoreboard?.week === currentWeek ? (previousScoreboard.scores || []) : []).map(s => [s.teamId, s]));
  const previousProjectedMedian = previousScoreboard?.week === currentWeek
    ? Number(previousScoreboard.projectedMedian ?? previousScoreboard.median)
    : null;
  const add = (type, text, score) => stories.push({type, text, score:Number.isFinite(score) ? round(score) : 0});
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
  const regrets = [...liveTeams.values()].map(t => ({...t, ...settledLineupRegret(t)}));
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
      add("MEDIAN CLUSTER","🎯 " + nearMedian.length + " teams are in the thick of the median race: " + listNames(nearMedian.map(s => s.team)) + ".",58 + nearMedian.length);
    }
  }
  const rising=currentScores.filter(s=>s.projectionTrend==="up").sort((a,b)=>Number(b.projectionAverage)-Number(a.projectionAverage))[0];
  if(rising) add("STOCK RISING","📈 Stock rising: " + rising.team + " has its ESPN projection trending up.",22);
  const falling=currentScores.filter(s=>s.projectionTrend==="down").sort((a,b)=>Number(a.projectionAverage)-Number(b.projectionAverage))[0];
  if(falling) add("STOCK FALLING","📉 Stock falling: " + possessive(falling.team) + " ESPN projection is trending down.",20);
  addLineupMistakeStories(add, matchupStates, regrets);
  addDeathWatchStory(add);
  addPickupStories(add);
  addSwingStories(add, matchupStates);
  addRaffleStories(add, previousScores);
  addPrimetimeStories(add, matchupStates);
  addWeekAheadStories(add);

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
    add("FRESH OFF THE WIRE","🗞️ Fresh off the wire: " + listNames(fresh.map(describe)) + ".",24 + fresh.length);
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
    add("RAFFLE WATCH","🎟️ RAFFLE WATCH: " + chaser.team + " (" + money(chaser.topScoreProbability) + "% to take the ticket) is chasing " + possessive(leader.team) + " " + money(leader.score) + " — " + pts(Number(leader.score) - Number(chaser.score)) + " back" + (left.length ? " with " + listNames(left) + " still to play" : "") + ".",76 + chaser.topScoreProbability / 10);
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
  const left = t => (t.remaining || []).map(p => p.name.split(" ").slice(-1)[0] + (p.game ? " (" + p.game + ")" : ""));
  if (first.chopProbability >= 100) {
    add("DEATH WATCH","🪓 DEATH WATCH: the blade has fallen — " + first.team + " is getting chopped from " + guillotineData.leagueName + " with " + pts(first.score) + ".",90);
  } else if (first.survivalNeed && first.playersLeft) {
    add("DEATH WATCH","🪓 DEATH WATCH: " + first.team + " (" + money(first.chopProbability) + "% chop odds) needs " + pts(first.survivalNeed.points) + " more from " + listNames(left(first)) + " to pass " + first.survivalNeed.passTeam + " and survive.",86);
  } else if (second?.survivalNeed && second.playersLeft) {
    add("DEATH WATCH","🪓 DEATH WATCH: " + first.team + " is on the chopping block (" + money(first.chopProbability) + "%) — unless " + listNames(left(second)) + " can't find " + pts(second.survivalNeed.points) + ", which would send " + second.team + " to the guillotine instead.",86);
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
      const swapText = swap.benchPlayer.name + " (" + pts(swap.benchPlayer.actual) + ") over " + swap.starter.name + " (" + pts(swap.starter.actual) + ")";
      if (score < oppScore && swappedScore > oppScore && teamDone && oppDone) {
        candidates.push({type:"INSTANT REGRET", text:"😱 INSTANT REGRET: " + team.team + " would have beaten " + opp.team + " by starting " + swapText + ". Oops!", score:97});
      } else if (score < oppScore && swappedScore > oppScore && oppDone) {
        candidates.push({type:"INSTANT REGRET", text:"😱 INSTANT REGRET: starting " + swapText + " would have locked up a win over " + opp.team + " for " + team.team + ". Instead they need " + pts(oppScore - score) + " more.", score:95});
      } else if (score < oppScore && swappedScore > oppScore) {
        candidates.push({type:"LINEUP MISTAKE", text:"😬 " + team.team + " would be leading " + opp.team + " if they'd started " + swapText + " — instead they trail by " + pts(oppScore - score) + ".", score:88});
      } else if (!teamDone || !oppDone) {
        const winOdds = Number(team.winProbability);
        if (swap.gain >= 5 && winOdds >= 30 && winOdds <= 70) {
          candidates.push({type:"LINEUP MISTAKE", text:"😅 " + team.team + " could be sitting pretty by starting " + swapText + ", but instead they're sweating out a close one with " + opp.team + " (" + money(winOdds) + "% to win).", score:80});
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
    const odds = " " + possessive(trailer.team) + " win chance: " + money(trailerOdds) + "%.";

    if (trailerOdds < LONG_SHOT_ODDS) {
      const chance = "🤞 So you're saying there's a chance… ";
      let text;
      if (!leaderLeft.length && trailerLeft.length === 1) {
        const p = trailerLeft[0];
        const projected = p.projection != null ? " (ESPN projects " + pts(p.projection) + ")" : "";
        text = chance + trailer.team + " needs " + withGame(p) + " to top " + pts(round(p.actual + deficit)) + projected + " to steal it from " + leader.team + ".";
      } else if (!leaderLeft.length) {
        text = chance + trailer.team + " needs " + pts(deficit) + " from " + listNames(trailerLeft.map(withGame)) + " to catch " + leader.team + ".";
      } else {
        text = chance + trailer.team + " trails " + leader.team + " by " + pts(deficit) + ", but a big night from " + listNames(trailerLeft.map(withGame)) + " and a quiet one from " + listNames(leaderLeft.map(p => p.lastName)) + " (late scratch, anyone?) could flip it.";
      }
      longShots.push({type:"LONG SHOT", text:text + odds, score:66 + trailerOdds});
      continue;
    }

    if (!leaderLeft.length && trailerLeft.length === 1) {
      const p = trailerLeft[0];
      const target = round(p.actual + deficit);
      const soFar = p.actual > 0 ? " (" + money(p.actual) + " so far)" : "";
      const projected = p.projection != null ? " ESPN projects " + pts(p.projection) + "." : "";
      storylines.push({type:"ALL EYES ON", text:"👀 All eyes on " + withGame(p) + ": if " + p.lastName + " tops " + pts(target) + soFar + ", " + trailer.team + " beats " + leader.team + ". Otherwise " + leader.team + " takes it." + projected + odds, score:urgency + 3});
    } else if (!leaderLeft.length) {
      storylines.push({type:"COMEBACK WATCH", text:"⏳ " + trailer.team + " needs " + pts(deficit) + " more from " + listNames(trailerLeft.map(withGame)) + " to catch " + leader.team + " (ESPN projects " + pts(projectedRest(trailerLeft)) + ")." + odds, score:urgency});
    } else {
      storylines.push({type:"SHOWDOWN", text:"⚔️ SHOWDOWN: " + leader.team + " leads " + trailer.team + " by " + pts(deficit) + " — it's " + listNames(leaderLeft.map(withGame)) + " vs " + listNames(trailerLeft.map(withGame)) + " the rest of the way." + odds, score:urgency});
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
    add("MATCHUPS THAT MATTER","🏈 Matchups that matter: " + live.map(m => m.x.a.team + " vs " + m.x.b.team + " (" + m.fav.team + " " + money(m.odds) + "%)").join(" · ") + ".",60 + live.length);
  }

  // Median races that come down to one or two players.
  const medianStakes = currentScores
    .filter(s => isNearMedian(s))
    .map(s => ({s, left:startersLeft(s.teamId)}))
    .filter(m => m.left.length && m.left.length <= 2)
    .sort((a,b) => Math.abs(Number(a.s.aboveMedianProbability) - 50) - Math.abs(Number(b.s.aboveMedianProbability) - 50))
    .slice(0, 2);
  for (const {s, left} of medianStakes) {
    add("MEDIAN STAKES","🎯 MEDIAN STAKES: " + possessive(s.team) + " shot at a median win (" + money(s.aboveMedianProbability) + "%) rides on " + listNames(left.map(withGame)) + ".",74);
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
