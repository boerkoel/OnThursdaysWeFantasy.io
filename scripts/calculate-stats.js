import { mkdir, readFile, writeFile } from "node:fs/promises";

function money(n){return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00"}

const settings = await readJson("data/current/mSettings.json");
const previousScoreboard = await readJson(process.env.PREVIOUS_SCOREBOARD_PATH || "data/current/scoreboard.json").catch(() => null);
const teamData = await readJson("data/current/mTeam.json");
const matchupData = await readJson("data/current/mMatchup.json");
const rosterData = await readJson("data/current/mRoster.json");
const historicalRosterData = new Map();
const draftData = await readJson("data/current/mDraftDetail.json").catch(() => ({draftDetail:{picks:[]}}));
const draftPicks = draftData?.draftDetail?.picks || [];
const draftByPlayer = new Map(draftPicks.map(p => [Number(p.playerId), p]));
const fantasyProsRos = await readJson("data/current/fantasypros-ros-ppr.json").catch(() => null);
const fantasyProsRosByName = new Map(
  (fantasyProsRos?.rankings || []).map(p => [normalizePlayerName(p.name), Number(p.rank)])
);
const freeAgentData = await readJson("data/current/free-agents.json").catch(() => null);
const liveScoringData = await readJson("data/current/mLiveScoring.json");
const boxscoreData = await readJson("data/current/mBoxscore.json");
const logoMap = await readJson("data/current/logo-map.json").catch(() => ({}));
const manualLogoMap = {
  "4": "/OnThursdaysWeFantasy.io/team-logos/team-11.png",
  "7": "/OnThursdaysWeFantasy.io/team-logos/team-10.png",
  "10": "/OnThursdaysWeFantasy.io/team-logos/team-7.png",
  "11": "/OnThursdaysWeFantasy.io/team-logos/team-4.png"
};

const teams = new Map((teamData.teams || []).map(t => [t.id, { id:t.id, name:(t.name||"").trim(), abbrev:t.abbrev||"", logo:manualLogoMap[String(t.id)] || logoMap[String(t.id)] || t.logo || null }]));
const matchups = (matchupData.schedule || []).filter(m => m.home?.teamId && m.away?.teamId).map(m => ({
  id:m.id, week:m.matchupPeriodId, homeTeamId:m.home.teamId, awayTeamId:m.away.teamId,
  homeScore:Number(m.home.totalPoints||0), awayScore:Number(m.away.totalPoints||0),
  margin:Math.abs(Number(m.home.totalPoints||0)-Number(m.away.totalPoints||0)),
  winner:m.winner, completed:m.winner==="HOME"||m.winner==="AWAY"
}));
const completed = matchups.filter(m => m.completed);
const currentWeek = Number(matchupData.scoringPeriodId || 1);
const completedWeeks = [...new Set(completed.map(m=>m.week))].sort((a,b)=>a-b);

const currentWeekMatchups = matchups.filter(m => m.week === currentWeek);
const historicalBoxscoreData = new Map();
for (const week of completedWeeks) {
  historicalRosterData.set(week, await readJson(`data/current/mRoster-week-${week}.json`).catch(() => null));
  historicalBoxscoreData.set(week, await readJson(`data/current/mBoxscore-week-${week}.json`).catch(() => null));
}

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
// Same "near median" rule as the scoreboard: roughly coin-flip odds of
// finishing above the league median.
const NEAR_MEDIAN_MIN = 30;
const NEAR_MEDIAN_MAX = 70;
const isNearMedian = s => {
  const odds = Number(s?.aboveMedianProbability);
  return Number.isFinite(odds) && odds >= NEAR_MEDIAN_MIN && odds <= NEAR_MEDIAN_MAX;
};

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
        return p && Number.isFinite(Number(p.aboveMedianProbability)) && !isNearMedian(p);
      });
      if (newlyNear) {
        add("MEDIAN WATCH","🎯 " + newlyNear.team + " is now a coin flip to finish above the median — " + money(newlyNear.aboveMedianProbability) + "% odds.",84);
      }
    }

    if (nearMedian.length >= 4) {
      add("MEDIAN CLUSTER","🎯 " + nearMedian.length + " teams have between " + NEAR_MEDIAN_MIN + "% and " + NEAR_MEDIAN_MAX + "% odds of finishing above the median.",58 + nearMedian.length);
    }
  }
  const rising=currentScores.filter(s=>s.projectionTrend==="up").sort((a,b)=>Number(b.projectionAverage)-Number(a.projectionAverage))[0];
  if(rising) add("STOCK RISING","📈 Stock rising: " + rising.team + " has its ESPN projection trending up.",22);
  const falling=currentScores.filter(s=>s.projectionTrend==="down").sort((a,b)=>Number(a.projectionAverage)-Number(b.projectionAverage))[0];
  if(falling) add("STOCK FALLING","📉 Stock falling: " + possessive(falling.team) + " ESPN projection is trending down.",20);
  addLineupMistakeStories(add, matchupStates, regrets);
  addPrimetimeStories(add, matchupStates);

  const biggestLead=matchupStates.filter(x=>!x.m.completed).sort((a,b)=>b.diff-a.diff)[0];
  if(biggestLead&&biggestLead.diff>=20){const leader=biggestLead.currentDiff>0?biggestLead.a.team:biggestLead.b.team;const trailer=biggestLead.currentDiff>0?biggestLead.b.team:biggestLead.a.team;add("LEAGUE GOSSIP","👀 League gossip: " + leader + " has " + money(biggestLead.diff) + " pts to play with against " + trailer + ".",28);}
  else if(regret?.bestSwap) add("LEAGUE GOSSIP","👀 League gossip: " + regret.team + " may be wishing they trusted " + regret.bestSwap.benchPlayer.name + " — " + pts(regret.bestSwap.benchPlayer.actual) + " are sitting on the bench.",regret.bestSwap.benchPlayer.actual+5);
  else if(close) add("LEAGUE GOSSIP","👀 League gossip: " + close.a.team + " and " + close.b.team + " are separated by " + money(close.diff) + " pts. Somebody's Sunday just got interesting.",26-close.diff);
  return stories.filter((story,i,arr)=>arr.findIndex(x=>x.text===story.text)===i).sort((a,b)=>b.score-a.score);
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

  const storylines = [];
  for (const x of matchupStates) {
    if (x.m.completed) continue;
    const [leader, trailer] = Number(x.a.score) >= Number(x.b.score) ? [x.a, x.b] : [x.b, x.a];
    const leaderLeft = startersLeft(leader.teamId);
    const trailerLeft = startersLeft(trailer.teamId);
    // A trailing team with no one left can't catch up, and a matchup with lots
    // of players still to go isn't a storyline yet.
    if (!trailerLeft.length || leaderLeft.length + trailerLeft.length > 3) continue;
    const deficit = round(Number(leader.score) - Number(trailer.score));
    const urgency = 92 - Math.min(deficit, 30) / 10;
    const odds = Number.isFinite(Number(trailer.winProbability)) ? " " + possessive(trailer.team) + " win chance: " + money(trailer.winProbability) + "%." : "";
    const add = (type, text, score) => storylines.push({type, text, score});

    if (!leaderLeft.length && trailerLeft.length === 1) {
      const p = trailerLeft[0];
      const target = round(p.actual + deficit);
      const soFar = p.actual > 0 ? " (" + money(p.actual) + " so far)" : "";
      const projected = p.projection != null ? " ESPN projects " + pts(p.projection) + "." : "";
      add("ALL EYES ON","👀 All eyes on " + withGame(p) + ": if " + p.lastName + " tops " + pts(target) + soFar + ", " + trailer.team + " beats " + leader.team + ". Otherwise " + leader.team + " takes it." + projected + odds,urgency + 3);
    } else if (!leaderLeft.length) {
      add("COMEBACK WATCH","⏳ " + trailer.team + " needs " + pts(deficit) + " more from " + listNames(trailerLeft.map(withGame)) + " to catch " + leader.team + " (ESPN projects " + pts(projectedRest(trailerLeft)) + ")." + odds,urgency);
    } else {
      add("SHOWDOWN","⚔️ SHOWDOWN: " + leader.team + " leads " + trailer.team + " by " + pts(deficit) + " — it's " + listNames(leaderLeft.map(withGame)) + " vs " + listNames(trailerLeft.map(withGame)) + " the rest of the way." + odds,urgency);
    }
  }
  storylines.sort((a,b) => b.score - a.score).slice(0, 4).forEach(story => add(story.type, story.text, story.score));

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
const marqueeStories=buildMarqueeStories();
await writeJson("data/current/marquee.json",{week:currentWeek,lastUpdated:new Date().toISOString(),stories:marqueeStories});

// Live runs only publish the League Wire and key plays. Everything below
// depends on completed weeks and is owned by the daily ESPN update; writing it
// here would leave uncommitted files behind and break the workflow's rebase.
if (process.env.LIVE_ONLY === "true") {
  console.log("calculate-stats: live update complete; skipping season stats.");
  process.exit(0);
}

const weeklyMedianByWeek = new Map();
for (const week of completedWeeks) {
  const weekScores = completed
    .filter(m => m.week === week)
    .flatMap(m => [Number(m.homeScore), Number(m.awayScore)])
    .filter(Number.isFinite)
    .sort((a,b) => a-b);
  if (!weekScores.length) continue;
  const median = weekScores.length % 2
    ? weekScores[Math.floor(weekScores.length / 2)]
    : (weekScores[weekScores.length / 2 - 1] + weekScores[weekScores.length / 2]) / 2;
  weeklyMedianByWeek.set(week, round(median));
}

const standings = [...teams.values()].map(team => {
  const games=completed.filter(m=>m.homeTeamId===team.id||m.awayTeamId===team.id);
  let wins=0,losses=0,ties=0,h2hWins=0,h2hLosses=0,medianWins=0,medianLosses=0,pointsFor=0,pointsAgainst=0;
  for(const g of games){
    const home=g.homeTeamId===team.id;
    pointsFor += home?g.homeScore:g.awayScore;
    pointsAgainst += home?g.awayScore:g.homeScore;
    if(home?g.winner==="HOME":g.winner==="AWAY"){ wins++; h2hWins++; } else { losses++; h2hLosses++; }

    const teamScore = home ? g.homeScore : g.awayScore;
    const median = weeklyMedianByWeek.get(g.week);
    if (Number.isFinite(median)) {
      if (teamScore > median) { wins++; medianWins++; }
      else if (teamScore < median) { losses++; medianLosses++; }
      else { ties++; }
    }
  }
  const weeksPlayed = games.length;
  const totalGames = weeksPlayed * 2;
  return {...team,wins,losses,ties,h2hWins,h2hLosses,medianWins,medianLosses,games:weeksPlayed,
    winPct:totalGames?(wins + ties * 0.5)/totalGames:0,
    pointsFor:round(pointsFor),pointsAgainst:round(pointsAgainst),streak:streak(team.id)};
}).sort((a,b)=>b.wins-a.wins||b.winPct-a.winPct||b.pointsFor-a.pointsFor);

const rows=completed.flatMap(g=>[
  {week:g.week,teamId:g.homeTeamId,opponentId:g.awayTeamId,score:g.homeScore,result:g.winner==="HOME"?"W":"L"},
  {week:g.week,teamId:g.awayTeamId,opponentId:g.homeTeamId,score:g.awayScore,result:g.winner==="AWAY"?"W":"L"}
]);
const highestScore=maxBy(rows,x=>x.score);
const lowestScore=minBy(rows,x=>x.score);
const highestScoringLoser=maxBy(rows.filter(x=>x.result==="L"),x=>x.score);
const lowestScoringWinner=minBy(rows.filter(x=>x.result==="W"),x=>x.score);
const blowout=maxBy(completed,x=>x.margin);

// Bench Warmer Champion is based only on completed weeks. The current
// live week is intentionally excluded so in-progress bench points cannot
// change the award during the matchup.
const benchByTeam = new Map([...teams.keys()].map(teamId => [teamId, {
  teamId,
  points:0,
  weeks:[]
}]));

for (const week of completedWeeks) {
  const weeklyRoster = historicalRosterData.get(week);
  for (const t of weeklyRoster?.teams || []) {
    const benchPlayers = (t.roster?.entries || []).filter(e => Number(e.lineupSlotId) === 20);
    const points = round(
      benchPlayers.reduce((sum, e) => sum + Number(e.playerPoolEntry?.appliedStatTotal || 0), 0)
    );
    const record = benchByTeam.get(Number(t.id));
    if (!record) continue;

    record.points = round(record.points + points);
    record.weeks.push({
      week,
      points,
      players:benchPlayers
        .map(e => ({
          playerId:e.playerId,
          name:e.playerPoolEntry?.player?.fullName || "Unknown player",
          points:round(Number(e.playerPoolEntry?.appliedStatTotal || 0))
        }))
        .sort((a,b) => b.points - a.points)
    });
  }
}

const bench = [...benchByTeam.values()]
  .map(record => ({
    ...record,
    team:name(record.teamId)
  }))
  .sort((a,b) => b.points - a.points || a.team.localeCompare(b.team));

const raffleWinners = completedWeeks.map(week => {
  const weekRows = rows.filter(x => x.week === week);
  return maxBy(weekRows, x => x.score);
}).filter(Boolean);

const raffleTickets = [...teams.values()].map(team => ({
  teamId: team.id,
  team: team.name,
  logo: team.logo,
  tickets: raffleWinners.filter(x => x.teamId === team.id).length,
  winningWeeks: raffleWinners.filter(x => x.teamId === team.id).map(x => x.week)
})).sort((a,b) => b.tickets - a.tickets || a.team.localeCompare(b.team));

const prizePool = {raffleWinner:100,firstPlace:375,secondPlace:225,thirdPlace:100};

const baseAwards={highestScore:scoreAward(highestScore),lowestScore:scoreAward(lowestScore),
  highestScoringLoser:scoreAward(highestScoringLoser),lowestScoringWinner:scoreAward(lowestScoringWinner),
  blowoutKing:matchupAward(blowout),
  benchWarmerChampion:bench[0] && bench[0].points > 0 ? {
    teamId:bench[0].teamId,
    team:bench[0].team,
    points:bench[0].points,
    weeks:bench[0].weeks
  }:null};

const weeklyTeamScores = new Map();
for (const row of rows) {
  if (!weeklyTeamScores.has(row.teamId)) weeklyTeamScores.set(row.teamId, []);
  weeklyTeamScores.get(row.teamId).push({week:row.week,score:row.score});
}

function trendFor(teamId) {
  const series=(weeklyTeamScores.get(teamId)||[]).sort((a,b)=>a.week-b.week).slice(-4);
  if (series.length < 2) return null;
  const n=series.length;
  const meanX=(n+1)/2;
  const meanY=series.reduce((sum,p)=>sum+p.score,0)/n;
  const slope=series.reduce((sum,p,i)=>sum+(i+1-meanX)*(p.score-meanY),0)/
    series.reduce((sum,p,i)=>sum+(i+1-meanX)**2,0);
  return {teamId,team:name(teamId),slope:round(slope),weeks:series.map(p=>p.week),scores:series.map(p=>round(p.score))};
}
const trends=[...teams.keys()].map(trendFor).filter(Boolean);
const heatingUp=maxBy(trends,x=>x.slope);
const coolingOff=minBy(trends,x=>x.slope);

const weeklyLeagueScores = new Map();
for (const row of rows) {
  if (!weeklyLeagueScores.has(row.week)) weeklyLeagueScores.set(row.week, []);
  weeklyLeagueScores.get(row.week).push(row.score);
}
const expected = new Map([...teams.keys()].map(id=>[id,{actual:0,expected:0}]));
for (const [week,scoresForWeek] of weeklyLeagueScores) {
  const sorted=scoresForWeek.slice().sort((a,b)=>b-a);
  const n=sorted.length;
  for (const row of rows.filter(x=>x.week===week)) {
    const rank=sorted.findIndex(score=>score===row.score);
    const better=sorted.filter(score=>score>row.score).length;
    const equal=sorted.filter(score=>score===row.score).length;
    const allPlay=(better + (equal-1)/2);
    const winExpectation=n>1 ? (n-1-allPlay)/(n-1) : 0;
    expected.get(row.teamId).expected += winExpectation;
    if (row.result==="W") expected.get(row.teamId).actual += 1;
  }
}
const luckAwards=[...expected.entries()].map(([teamId,x])=>({...x,teamId,team:name(teamId),luck:x.actual-x.expected}));
const luckBox=maxBy(luckAwards,x=>x.luck);
const unluckiest=minBy(luckAwards,x=>x.luck);

const activity=new Map([...teams.keys()].map(id=>[id,{teamId:id,team:name(id),trades:0,moves:0}]));
for (const t of (teamData.teams || [])) {
  const c=t.transactionCounter || {};
  if (!activity.has(t.id)) continue;
  activity.set(t.id,{teamId:t.id,team:name(t.id),trades:Number(c.trades||0),moves:Number(c.acquisitions||0)+Number(c.drops||0)});
}
const negotiator=maxBy([...activity.values()],x=>x.trades);
const getALife=maxBy([...activity.values()],x=>x.moves);

const newAwards={
  negotiator:negotiator?.trades ? negotiator : null,
  getALife:getALife?.moves ? getALife : null,
  heatingUp,
  coolingOff,
  luckBox,
  unluckiest
};
const awards={prizePool,...baseAwards,...newAwards};

await mkdir("data/current",{recursive:true});
const playoffTeamCount = Number(settings.settings?.scheduleSettings?.playoffTeamCount || 6);
const playoffSeedingRule = settings.settings?.scheduleSettings?.playoffSeedingRule || "TOTAL_POINTS_SCORED";
const playoffReseed = Boolean(settings.settings?.scheduleSettings?.playoffReseed);

const allByPoints = [...standings].sort((a,b)=>b.pointsFor-a.pointsFor || b.wins-a.wins);
const playoffSeeds = allByPoints.slice(0, playoffTeamCount).map((team,index)=>({...team,seed:index+1}));
const nonPlayoffTeams = allByPoints.slice(playoffTeamCount).map((team,index)=>({...team,seed:playoffTeamCount+index+1}));

const playoffSeedMap = new Map(playoffSeeds.map(t=>[t.seed,t]));
const playoffSchedule = [
  {id:"qf1",week:15,round:"Quarterfinal",homeSeed:3,awaySeed:6},
  {id:"qf2",week:15,round:"Quarterfinal",homeSeed:4,awaySeed:5},
  {id:"sf1",week:16,round:"Semifinal",homeSeed:1,homeBye:true},
  {id:"sf2",week:16,round:"Semifinal",homeSeed:2,homeBye:true},
  {id:"final",week:17,round:"Championship"},
  {id:"third",week:17,round:"Third Place"}
].map(g=>({
  ...g,
  homeTeam:g.homeSeed?playoffSeedMap.get(g.homeSeed)?.name:null,
  awayTeam:g.awaySeed?playoffSeedMap.get(g.awaySeed)?.name:null
}));

const week15Completed = matchups.filter(m=>m.week===15 && m.completed);
const playoffLosers = week15Completed.map(m => {
  const loserId = m.winner === "HOME" ? m.awayTeamId : m.homeTeamId;
  const winnerId = m.winner === "HOME" ? m.homeTeamId : m.awayTeamId;
  const loserSeed = playoffSeeds.find(s=>s.id===loserId)?.seed ?? null;
  return {teamId:loserId,team:name(loserId),playoffSeed:loserSeed,week:15,opponentId:winnerId,opponent:name(winnerId)};
}).filter(x=>x.teamId);

const sortedNonPlayoffTeams = [...nonPlayoffTeams].sort((a,b)=>a.seed-b.seed);
const sortedPlayoffLosers = [...playoffLosers].sort((a,b)=>(a.playoffSeed??99)-(b.playoffSeed??99));

// The Ultimate Loser field is an 8-team bracket: the six regular-season
// non-playoff teams are seeded first, followed by the two Week 15 playoff
// losers. Until Week 15 is complete, those final two spots remain labeled.
const ultimateEntrants = [
  ...sortedNonPlayoffTeams
    .slice(0,6)
    .sort((a,b)=>b.seed-a.seed)
    .map((t,i)=>({seed:i+1,teamId:t.id,team:t.name,source:"REGULAR_SEASON",regularSeasonSeed:t.seed,pointsFor:t.pointsFor})),
  sortedPlayoffLosers[0]
    ? {seed:7,teamId:sortedPlayoffLosers[0].teamId,team:sortedPlayoffLosers[0].team,source:"WEEK_15_PLAYOFF_LOSER",playoffSeed:sortedPlayoffLosers[0].playoffSeed,opponent:sortedPlayoffLosers[0].opponent}
    : {seed:7,teamId:null,team:"TBD",source:"WEEK_15_PLAYOFF_LOSER",playoffSeed:null,opponent:null},
  sortedPlayoffLosers[1]
    ? {seed:8,teamId:sortedPlayoffLosers[1].teamId,team:sortedPlayoffLosers[1].team,source:"WEEK_15_PLAYOFF_LOSER",playoffSeed:sortedPlayoffLosers[1].playoffSeed,opponent:sortedPlayoffLosers[1].opponent}
    : {seed:8,teamId:null,team:"TBD",source:"WEEK_15_PLAYOFF_LOSER",playoffSeed:null,opponent:null}
];

function completedUltimateLoserGame(teamAId, teamBId, week) {
  const game = matchups.find(m =>
    m.week === week &&
    ((m.homeTeamId === teamAId && m.awayTeamId === teamBId) ||
     (m.homeTeamId === teamBId && m.awayTeamId === teamAId))
  );
  if (!game || !game.completed) return null;
  const aScore = game.homeTeamId === teamAId ? game.homeScore : game.awayScore;
  const bScore = game.homeTeamId === teamBId ? game.homeScore : game.awayScore;
  // Ultimate Loser advances the lower-scoring team.
  return {
    teamAId,
    teamBId,
    week,
    teamAScore:aScore,
    teamBScore:bScore,
    advancingTeamId:aScore <= bScore ? teamAId : teamBId,
    completed:true
  };
}

function reseededPairs(teamsInRound) {
  const ordered = [...teamsInRound].sort((a,b)=>a.seed-b.seed);
  const pairs = [];
  for (let i=0; i<ordered.length/2; i++) {
    pairs.push({home:ordered[i], away:ordered[ordered.length-1-i]});
  }
  return pairs;
}

const ulRound16Pairs = [
  {home:ultimateEntrants.find(t=>t.seed===1),away:ultimateEntrants.find(t=>t.seed===8)},
  {home:ultimateEntrants.find(t=>t.seed===2),away:ultimateEntrants.find(t=>t.seed===7)},
  {home:ultimateEntrants.find(t=>t.seed===3),away:ultimateEntrants.find(t=>t.seed===6)},
  {home:ultimateEntrants.find(t=>t.seed===4),away:ultimateEntrants.find(t=>t.seed===5)}
].filter(p=>p.home && p.away);

const ulRound16Results = ulRound16Pairs
  .map(p=>completedUltimateLoserGame(p.home.teamId,p.away.teamId,16))
  .filter(Boolean);

const ulRound17Advancers = ulRound16Results
  .map(r=>ultimateEntrants.find(t=>t.teamId===r.advancingTeamId))
  .filter(Boolean);
const ulRound17Pairs = ulRound17Advancers.length === 4
  ? reseededPairs(ulRound17Advancers)
  : [];

const ulRound17Results = ulRound17Pairs
  .map(p=>completedUltimateLoserGame(p.home.teamId,p.away.teamId,17))
  .filter(Boolean);

const ulRound18Advancers = ulRound17Results
  .map(r=>ultimateEntrants.find(t=>t.teamId===r.advancingTeamId))
  .filter(Boolean);
const ulRound18Pairs = ulRound18Advancers.length === 2
  ? reseededPairs(ulRound18Advancers)
  : [];

const ultimateLoserSchedule = [
  ...ulRound16Pairs.map((p,i)=>({
    id:`ul-qf${i+1}`,week:16,round:"Quarterfinal",
    homeSeed:p.home.seed,awaySeed:p.away.seed,
    homeTeam:p.home.team,awayTeam:p.away.team
  })),
  ...ulRound17Pairs.map((p,i)=>({
    id:`ul-sf${i+1}`,week:17,round:"Semifinal",
    homeSeed:p.home.seed,awaySeed:p.away.seed,
    homeTeam:p.home.team,awayTeam:p.away.team,
    reseeded:true
  })),
  ...ulRound18Pairs.map((p,i)=>({
    id:"ul-final",week:18,round:"Championship",
    homeSeed:p.home.seed,awaySeed:p.away.seed,
    homeTeam:p.home.team,awayTeam:p.away.team,
    reseeded:true
  }))
];


const ultimateLoser = {
  format:"3-week single elimination",
  advancementRule:"LOWER_SCORE_ADVANCES",
  currentWeek,
  status:currentWeek>=16 ? "ACTIVE" : "PROJECTED",
  entrants:ultimateEntrants,
  playoffLosers,
  schedule:ultimateLoserSchedule,
  note:"Six regular-season non-playoff teams enter as seeds 1-6; the lower-ranked Week 15 playoff loser enters as seed 7 and the higher-ranked Week 15 playoff loser enters as seed 8. The lower-scoring team advances each round, and the remaining teams are reseeded highest-vs-lowest before the next round."
};

const playoffs = {
  season:settings.seasonId,
  currentWeek,
  playoffTeamCount,
  playoffReseed,
  playoffSeedingRule,
  status: currentWeek >= 15 ? "ACTIVE" : "PROJECTED",
  seeds:playoffSeeds.map(t=>({seed:t.seed,teamId:t.id,team:t.name,wins:t.wins,losses:t.losses,pointsFor:t.pointsFor})),
  nonPlayoffTeams:nonPlayoffTeams.map(t=>({seed:t.seed,teamId:t.id,team:t.name,wins:t.wins,losses:t.losses,pointsFor:t.pointsFor})),
  schedule:playoffSchedule,
  ultimateLoser
};

await writeJson("data/current/standings.json",{season:settings.seasonId,currentWeek,completedWeeks,standings});
await writeJson("data/current/playoffs.json",playoffs);
await writeJson("data/current/raffle.json",{season:settings.seasonId,currentWeek,completedWeeks,winners:raffleWinners.map(x=>({week:x.week,teamId:x.teamId,team:name(x.teamId),score:round(x.score)})),tickets:raffleTickets});
await writeJson("data/current/matchups.json",{season:settings.seasonId,currentWeek,matchups});
await writeJson("data/current/awards.json",{season:settings.seasonId,currentWeek,awards});
await writeJson("data/current/leaders.json",{season:settings.seasonId,currentWeek,leaders:{highestScore:scoreAward(highestScore),lowestScore:scoreAward(lowestScore),highestScoringLoser:scoreAward(highestScoringLoser),lowestScoringWinner:scoreAward(lowestScoringWinner),largestBlowout:matchupAward(blowout)}});
function buildWeeklyRecap(week) {
  const games = completed.filter(m => Number(m.week) === Number(week));
  const scores = games.flatMap(m => [Number(m.homeScore), Number(m.awayScore)]).filter(Number.isFinite).sort((a,b) => a-b);
  const median = scores.length ? (scores.length % 2 ? scores[Math.floor(scores.length/2)] : (scores[scores.length/2-1] + scores[scores.length/2]) / 2) : null;
  const stories = [];
  const add = (type,text,priority) => stories.push({type,text,priority});

  const topGame = games.slice().sort((a,b) => b.margin-a.margin)[0];
  const closeGame = games.slice().sort((a,b) => a.margin-b.margin)[0];
  const highScore = games.flatMap(m => [
    {teamId:m.homeTeamId,score:Number(m.homeScore),opponentId:m.awayTeamId,opponentScore:Number(m.awayScore),result:m.winner==="HOME"?"W":"L"},
    {teamId:m.awayTeamId,score:Number(m.awayScore),opponentId:m.homeTeamId,opponentScore:Number(m.homeScore),result:m.winner==="AWAY"?"W":"L"}
  ]).sort((a,b)=>b.score-a.score)[0];

  if (highScore) add("HIGH SCORE","🔥 " + name(highScore.teamId) + " dropped " + money(highScore.score) + " points — the week's highest score.",100);
  if (closeGame) add("CLOSEST MATCHUP","⚔️ " + name(closeGame.homeTeamId) + " edged " + name(closeGame.awayTeamId) + " by just " + money(closeGame.margin) + " points.",90);

  const weeklyEntries = weeklyTeamEntries(week).filter(e => Number.isFinite(e.score));
  const biggestBench = weeklyEntries.filter(e => Number(e.lineupSlotId) === 20).sort((a,b)=>b.score-a.score)[0];
  if (biggestBench && biggestBench.score >= 8) add("BIGGEST REGRET","🪑 " + name(biggestBench.teamId) + " left " + money(biggestBench.score) + " points on the bench with " + biggestBench.name + ".",85);

  const toughLoss = games.flatMap(m => [
    {teamId:m.homeTeamId,score:Number(m.homeScore),result:m.winner==="HOME"},
    {teamId:m.awayTeamId,score:Number(m.awayScore),result:m.winner==="AWAY"}
  ]).filter(x=>!x.result).sort((a,b)=>b.score-a.score)[0];
  if (toughLoss && toughLoss.score >= 100) {
    add("TOUGH LUCK","😬 " + name(toughLoss.teamId) + " scored " + money(toughLoss.score) + " and still took the L.",82);
  }

  if (topGame && topGame.margin >= 25) {
    const winnerId = topGame.winner === "HOME" ? topGame.homeTeamId : topGame.awayTeamId;
    const loserId = topGame.winner === "HOME" ? topGame.awayTeamId : topGame.homeTeamId;
    const winnerScore = topGame.winner === "HOME" ? topGame.homeScore : topGame.awayScore;
    const loserScore = topGame.winner === "HOME" ? topGame.awayScore : topGame.homeScore;
    add("BLOWOUT","💥 " + name(winnerId) + " beat " + name(loserId) + " " + money(winnerScore) + "-" + money(loserScore) + " (" + money(topGame.margin) + " points).",75);
  }

  const loser = games.flatMap(m => [
    {teamId:m.homeTeamId,score:Number(m.homeScore),result:m.winner==="HOME"},
    {teamId:m.awayTeamId,score:Number(m.awayScore),result:m.winner==="AWAY"}
  ]).filter(x=>!x.result).sort((a,b)=>b.score-a.score)[0];
  if (loser && loser.score >= 100) add("LEAGUE GOSSIP","👀 " + name(loser.teamId) + " scored " + money(loser.score) + " and still took the L. That's a rough one.",70);

  return stories.sort((a,b)=>b.priority-a.priority).slice(0,6).map(({type,text})=>({type,text}));
}

const weeklyRecaps = completedWeeks.map(week => ({
  week,
  recap:buildWeeklyRecap(week),
  matchups:completed.filter(m=>m.week===week),
  highestScore:scoreAward(maxBy(rows.filter(x=>x.week===week),x=>x.score)),
  largestBlowout:matchupAward(maxBy(completed.filter(m=>m.week===week),x=>x.margin))
}));
await writeJson("data/current/weekly.json",{season:settings.seasonId,currentWeek,weeks:weeklyRecaps});
function playerSeasonPoints(entry) {
  const stats = entry.playerPoolEntry?.player?.stats || [];
  const historical = stats
    .filter(s => Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1 && Number(s.scoringPeriodId) <= currentWeek)
    .map(s => Number(s.appliedTotal))
    .filter(Number.isFinite);
  if (historical.length) return round(historical.reduce((sum, value) => sum + value, 0));
  return round(Number(entry.playerPoolEntry?.appliedStatTotal || 0));
}

function playerWeeklyScores(entry) {
  const playerId = Number(entry.playerId);
  const scores = [];

  for (const week of completedWeeks) {
    const boxscore = historicalBoxscoreData.get(week);
    const weeklyEntry = (boxscore?.schedule || [])
      .flatMap(game => [game.home, game.away])
      .flatMap(side => side?.rosterForCurrentScoringPeriod?.entries || [])
      .find(e => Number(e.playerId) === playerId);

    if (weeklyEntry) {
      const score = Number(weeklyEntry.playerPoolEntry?.appliedStatTotal);
      if (Number.isFinite(score)) scores.push({week, score});
    }
  }

  if (!scores.length) {
    const stats = entry.playerPoolEntry?.player?.stats || [];
    return stats
      .filter(s => Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1 && Number(s.scoringPeriodId) <= currentWeek)
      .map(s => ({week:Number(s.scoringPeriodId), score:Number(s.appliedTotal)}))
      .filter(s => Number.isFinite(s.score) && completedWeeks.includes(s.week));
  }

  return scores;
}

function weeklyTeamEntries(week) {
  const boxscore = historicalBoxscoreData.get(week);
  const roster = historicalRosterData.get(week);
  const entries = [];

  for (const matchup of boxscore?.schedule || []) {
    for (const side of [matchup.home, matchup.away]) {
      if (!side?.teamId) continue;
      for (const entry of side.rosterForCurrentScoringPeriod?.entries || []) {
        entries.push({
          teamId:Number(side.teamId),
          playerId:Number(entry.playerId),
          lineupSlotId:Number(entry.lineupSlotId),
          score:Number(entry.playerPoolEntry?.appliedStatTotal),
          name:entry.playerPoolEntry?.player?.fullName || `Player #${entry.playerId}`,
          position:entry.playerPoolEntry?.player?.defaultPositionId || null
        });
      }
    }
  }

  if (entries.length) return entries;

  for (const team of roster?.teams || []) {
    for (const entry of team.roster?.entries || []) {
      entries.push({
        teamId:Number(team.id),
        playerId:Number(entry.playerId),
        lineupSlotId:Number(entry.lineupSlotId),
        score:Number(entry.playerPoolEntry?.appliedStatTotal),
        name:entry.playerPoolEntry?.player?.fullName || `Player #${entry.playerId}`,
        position:entry.playerPoolEntry?.player?.defaultPositionId || null
      });
    }
  }
  return entries;
}

const playerTeamHistory = new Map();
for (const week of completedWeeks) {
  for (const entry of weeklyTeamEntries(week)) {
    if (!Number.isFinite(entry.score)) continue;
    const key = `${entry.teamId}|${entry.playerId}`;
    if (!playerTeamHistory.has(key)) {
      playerTeamHistory.set(key, {
        teamId:entry.teamId,
        playerId:entry.playerId,
        name:entry.name,
        position:entry.position,
        draft:draftByPlayer.get(entry.playerId) || null,
        weekly:[]
      });
    }
    playerTeamHistory.get(key).weekly.push({
      week,
      score:entry.score,
      started:![20, 21].includes(entry.lineupSlotId)
    });
  }
}

const awardPlayersByTeam = new Map();
for (const player of playerTeamHistory.values()) {
  if (!awardPlayersByTeam.has(player.teamId)) awardPlayersByTeam.set(player.teamId, []);
  awardPlayersByTeam.get(player.teamId).push(player);
}

function stddev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum,v)=>sum+v,0) / values.length;
  return Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0) / values.length);
}

function starterEligible(entry, slotId) {
  if ([20, 21].includes(Number(slotId))) return false;
  const eligibleSlots = (entry.playerPoolEntry?.player?.eligibleSlots || []).map(Number);
  return eligibleSlots.includes(Number(slotId));
}

function lineupEfficiency(weeklyTeam, actualPointsOverride = null, excludedPlayerId = null) {
  const entries = (weeklyTeam?.roster?.entries || []).filter(e => Number(e.lineupSlotId) !== 21 && Number(e.playerId) !== Number(excludedPlayerId));
  const starterSlots = [];
  const lineupSlotCounts = settings.settings?.rosterSettings?.lineupSlotCounts || {};
  for (const [slotId, count] of Object.entries(lineupSlotCounts)) {
    const slot = Number(slotId);
    if ([20, 21].includes(slot)) continue;
    for (let i = 0; i < Number(count || 0); i++) starterSlots.push(slot);
  }

  const scoreOf = entry => {
    const score = Number(entry.playerPoolEntry?.appliedStatTotal);
    return Number.isFinite(score) ? score : 0;
  };

  const rosterActualPoints = round(
    entries
      .filter(e => Number(e.lineupSlotId) !== 20)
      .reduce((sum, e) => sum + scoreOf(e), 0)
  );
  const actualPoints = Number.isFinite(Number(actualPointsOverride))
    ? round(Number(actualPointsOverride))
    : rosterActualPoints;

  const memo = new Map();
  const solve = (index, remaining) => {
    if (index >= entries.length) return remaining.every(x => x === 0) ? 0 : -Infinity;
    const key = index + "|" + remaining.join(",");
    if (memo.has(key)) return memo.get(key);

    const entry = entries[index];
    let best = solve(index + 1, remaining);

    for (let slotIndex = 0; slotIndex < starterSlots.length; slotIndex++) {
      if (!remaining[slotIndex] || !starterEligible(entry, starterSlots[slotIndex])) continue;
      const next = remaining.slice();
      next[slotIndex]--;
      const candidate = scoreOf(entry) + solve(index + 1, next);
      if (candidate > best) best = candidate;
    }

    memo.set(key, best);
    return best;
  };

  const optimalPoints = solve(0, starterSlots.map(() => 1));
  if (!Number.isFinite(optimalPoints) || optimalPoints <= 0) return null;

  return {
    actualPoints,
    optimalPoints:round(optimalPoints),
    efficiency:round(Math.max(0, Math.min(1, actualPoints / optimalPoints)) * 100),
    pointsLeft:round(Math.max(0, optimalPoints - actualPoints))
  };
}

const positionFitByTeam = new Map();
const positionNames = {1:"QB",2:"RB",3:"WR",4:"TE",5:"K",16:"DST"};
const positionWeeklyByTeam = new Map();

for (const team of teams.values()) {
  const totals = Object.fromEntries(Object.values(positionNames).map(pos => [pos, []]));
  for (const week of completedWeeks) {
    const boxscore = historicalBoxscoreData.get(week);
    const side = (boxscore?.schedule || [])
      .filter(g => Number(g.matchupPeriodId) === Number(week))
      .flatMap(g => [g.home, g.away])
      .find(s => Number(s?.teamId) === Number(team.id));
    for (const entry of side?.rosterForCurrentScoringPeriod?.entries || []) {
      if ([20,21].includes(Number(entry.lineupSlotId))) continue;
      const position = positionNames[Number(entry.playerPoolEntry?.player?.defaultPositionId)];
      if (!position) continue;
      const points = Number(entry.playerPoolEntry?.appliedStatTotal ?? 0);
      if (Number.isFinite(points)) totals[position].push(points);
    }
  }
  positionWeeklyByTeam.set(Number(team.id), totals);
}

const positionLeagueAverages = Object.fromEntries(Object.values(positionNames).map(position => {
  const teamAverages = [...positionWeeklyByTeam.values()]
    .map(t => t[position]?.length ? t[position].reduce((sum,v)=>sum+v,0)/t[position].length : null)
    .filter(Number.isFinite);
  return [position, teamAverages.length ? teamAverages.reduce((sum,v)=>sum+v,0)/teamAverages.length : 0];
}));

for (const team of teams.values()) {
  const totals = positionWeeklyByTeam.get(Number(team.id)) || {};
  const comparisons = Object.values(positionNames).map(position => {
    const values = totals[position] || [];
    const average = values.length ? values.reduce((sum,v)=>sum+v,0)/values.length : 0;
    const leagueAverage = Number(positionLeagueAverages[position] || 0);
    const percent = leagueAverage ? ((average / leagueAverage) - 1) * 100 : 0;
    return {position, average:round(average), percent:round(percent)};
  });
  const strengths = comparisons.filter(p => p.percent >= 15).sort((a,b)=>b.percent-a.percent).slice(0,3);
  const needs = comparisons.filter(p => p.percent <= -15).sort((a,b)=>a.percent-b.percent).slice(0,3);
  positionFitByTeam.set(Number(team.id), {strengths, needs});
}

const benchTargetsByTeam = new Map();

function weeklyRosterForTeam(week, teamId) {
  const boxscore = historicalBoxscoreData.get(week);
  const side = (boxscore?.schedule || [])
    .filter(g => Number(g.matchupPeriodId) === Number(week))
    .flatMap(g => [g.home, g.away])
    .find(s => Number(s?.teamId) === Number(teamId));
  if (side?.rosterForCurrentScoringPeriod?.entries) {
    return {id:Number(teamId), roster:{entries:side.rosterForCurrentScoringPeriod.entries}};
  }
  return (historicalRosterData.get(week)?.teams || []).find(t => Number(t.id) === Number(teamId)) || null;
}

for (const team of teams.values()) {
  const currentTeam = (rosterData.teams || []).find(t => Number(t.id) === Number(team.id));
  const targets = [];
  for (const entry of currentTeam?.roster?.entries || []) {
    if (![20].includes(Number(entry.lineupSlotId))) continue;
    const playerId = Number(entry.playerId);
    const history = playerTeamHistory.get(`${team.id}|${playerId}`);
    if (!history?.weekly?.length) continue;

    const rosteredWeeks = history.weekly.length;
    const startedWeeks = history.weekly.filter(w => w.started).length;
    const startRate = startedWeeks / rosteredWeeks;
    let boost = 0;

    for (const weekEntry of history.weekly.filter(w => !w.started)) {
      const weeklyTeam = weeklyRosterForTeam(weekEntry.week, team.id);
      const fullOptimal = lineupEfficiency(weeklyTeam);
      const withoutPlayer = lineupEfficiency(weeklyTeam, null, playerId);
      if (fullOptimal && withoutPlayer) {
        const improvement = Math.max(0, Number(fullOptimal.optimalPoints) - Number(withoutPlayer.optimalPoints));
        boost += improvement;
      }
    }

    // Keep meaningful bench targets. Repeated sit/start mistakes do not
    // disqualify a player; they can still be useful trade targets.
    if (boost >= 5) {
      targets.push({
        playerId,
        player:entry.playerPoolEntry?.player?.fullName || history.name || `Player #${playerId}`,
        position:positionNames[Number(entry.playerPoolEntry?.player?.defaultPositionId || history.position)] || history.position || null,
        startRate:round(startRate * 100),
        rosteredWeeks,
        startedWeeks,
        boost:round(boost)
      });
    }
  }
  benchTargetsByTeam.set(Number(team.id), targets.sort((a,b) => b.boost - a.boost || a.startRate - b.startRate));
}

const rosterFitByTeam = new Map();
for (const team of teams.values()) {
  const fit = positionFitByTeam.get(Number(team.id)) || {strengths:[],needs:[]};
  const partners = [];

  for (const other of teams.values()) {
    if (Number(other.id) === Number(team.id)) continue;
    const otherFit = positionFitByTeam.get(Number(other.id)) || {strengths:[],needs:[]};
    const give = fit.strengths.filter(s => otherFit.needs.some(n => n.position === s.position));
    const get = fit.needs.filter(n => otherFit.strengths.some(s => s.position === n.position));
    if (!give.length || !get.length) continue;
    const score = give.reduce((sum,p) => sum + Math.abs(Number(p.percent)), 0)
      + get.reduce((sum,p) => sum + Math.abs(Number(p.percent)), 0);
    partners.push({
      teamId:Number(other.id), team:other.name, score:round(score),
      give:give.slice(0,2).map(p => ({position:p.position, percent:p.percent})),
      get:get.slice(0,2).map(p => ({position:p.position, percent:p.percent}))
    });
  }

  const sortedPartners = partners.sort((a,b) => b.score - a.score).slice(0,3);
  const targets = [];
  const strengthPositions = new Set(fit.strengths.map(p => p.position));
  const needPositions = new Set(fit.needs.map(p => p.position));

  // Evaluate every current bench player in the league against this team.
  for (const other of teams.values()) {
    if (Number(other.id) === Number(team.id)) continue;

    for (const player of benchTargetsByTeam.get(Number(other.id)) || []) {
      // Don't recommend a player at a position this team already identifies
      // as a need. A trade target should address a roster strength/need fit,
      // not add another hole at the destination position.
      if (player.position && needPositions.has(player.position)) continue;

      let boost = 0;
      let h2hWinsAdded = 0;
      let medianWinsAdded = 0;

      for (const week of completedWeeks) {
        const sourceRoster = weeklyRosterForTeam(week, other.id);
        const sourceEntry = sourceRoster?.roster?.entries?.find(e => Number(e.playerId) === Number(player.playerId));
        if (!sourceEntry || Number(sourceEntry.lineupSlotId) !== 20) continue;

        const destinationRoster = weeklyRosterForTeam(week, team.id);
        if (!destinationRoster?.roster?.entries) continue;

        const baseOptimal = lineupEfficiency(destinationRoster);
        const hypotheticalTeam = {
          id:Number(team.id),
          roster:{entries:destinationRoster.roster.entries.concat([{...sourceEntry, lineupSlotId:20}])}
        };
        const hypotheticalOptimal = lineupEfficiency(hypotheticalTeam);
        if (!baseOptimal || !hypotheticalOptimal) continue;

        const improvement = Math.max(0, Number(hypotheticalOptimal.optimalPoints) - Number(baseOptimal.optimalPoints));
        boost += improvement;
        if (improvement <= 0) continue;

        const game = completed.find(m =>
          m.week === week &&
          (m.homeTeamId === Number(team.id) || m.awayTeamId === Number(team.id))
        );
        if (!game) continue;

        const actual = game.homeTeamId === Number(team.id) ? game.homeScore : game.awayScore;
        const opponent = game.homeTeamId === Number(team.id) ? game.awayScore : game.homeScore;

        const weekScores = completed
          .filter(m => m.week === week)
          .flatMap(m => [Number(m.homeScore), Number(m.awayScore)])
          .filter(Number.isFinite)
          .sort((a,b) => a-b);
        const median = weekScores.length
          ? (weekScores.length % 2
            ? weekScores[Math.floor(weekScores.length/2)]
            : (weekScores[weekScores.length/2-1] + weekScores[weekScores.length/2]) / 2)
          : null;

        if (hypotheticalOptimal.optimalPoints > opponent && actual <= opponent) h2hWinsAdded += 1;
        if (Number.isFinite(median) && hypotheticalOptimal.optimalPoints > median && actual <= median) medianWinsAdded += 1;
      }

      // The Trade Desk should only show targets that meet the same 5-point
      // minimum used when identifying meaningful bench targets above.
      if (boost >= 5) {
        // Look for a reciprocal bench player who would also improve the
        // source team's optimal lineup. This identifies genuine win-win
        // trade possibilities rather than one-sided trade targets.
        let mutual = null;
        for (const reciprocal of benchTargetsByTeam.get(Number(team.id)) || []) {
          // Only show reciprocal opportunities when the two players are at
          // different positions. Same-position swaps mostly signal that
          // both managers have simply been making the same start/sit mistake.
          if (reciprocal.position && player.position && reciprocal.position === player.position) continue;

          let reciprocalBoost = 0;
          let reciprocalH2hWins = 0;
          let reciprocalMedianWins = 0;

          for (const week of completedWeeks) {
            const reciprocalSourceRoster = weeklyRosterForTeam(week, team.id);
            const reciprocalEntry = reciprocalSourceRoster?.roster?.entries?.find(e => Number(e.playerId) === Number(reciprocal.playerId));
            if (!reciprocalEntry || Number(reciprocalEntry.lineupSlotId) !== 20) continue;

            const receivingRoster = weeklyRosterForTeam(week, other.id);
            if (!receivingRoster?.roster?.entries) continue;

            const baseOptimal = lineupEfficiency(receivingRoster);
            const hypotheticalTeam = {
              id:Number(other.id),
              roster:{entries:receivingRoster.roster.entries.concat([{...reciprocalEntry, lineupSlotId:20}])}
            };
            const hypotheticalOptimal = lineupEfficiency(hypotheticalTeam);
            if (!baseOptimal || !hypotheticalOptimal) continue;

            const improvement = Math.max(0, Number(hypotheticalOptimal.optimalPoints) - Number(baseOptimal.optimalPoints));
            reciprocalBoost += improvement;
            if (improvement <= 0) continue;

            const game = completed.find(m =>
              m.week === week &&
              (m.homeTeamId === Number(other.id) || m.awayTeamId === Number(other.id))
            );
            if (!game) continue;

            const actual = game.homeTeamId === Number(other.id) ? game.homeScore : game.awayScore;
            const opponent = game.homeTeamId === Number(other.id) ? game.awayScore : game.homeScore;
            const weekScores = completed
              .filter(m => m.week === week)
              .flatMap(m => [Number(m.homeScore), Number(m.awayScore)])
              .filter(Number.isFinite)
              .sort((a,b) => a-b);
            const median = weekScores.length
              ? (weekScores.length % 2
                ? weekScores[Math.floor(weekScores.length/2)]
                : (weekScores[weekScores.length/2-1] + weekScores[weekScores.length/2]) / 2)
              : null;

            if (hypotheticalOptimal.optimalPoints > opponent && actual <= opponent) reciprocalH2hWins += 1;
            if (Number.isFinite(median) && hypotheticalOptimal.optimalPoints > median && actual <= median) reciprocalMedianWins += 1;
          }

          const reciprocalWins = reciprocalH2hWins + reciprocalMedianWins;
          if (reciprocalBoost > 0.25 && (!mutual || reciprocalWins > mutual.winsAdded || (reciprocalWins === mutual.winsAdded && reciprocalBoost > mutual.boost))) {
            mutual = {
              playerId:Number(reciprocal.playerId),
              player:reciprocal.player,
              position:reciprocal.position,
              startRate:reciprocal.startRate,
              boost:round(reciprocalBoost),
              h2hWinsAdded:round(reciprocalH2hWins),
              medianWinsAdded:round(reciprocalMedianWins),
              winsAdded:round(reciprocalWins)
            };
          }
        }

        targets.push({
          ...player,
          teamId:Number(other.id),
          team:other.name,
          boost:round(boost),
          h2hWinsAdded:round(h2hWinsAdded),
          medianWinsAdded:round(medianWinsAdded),
          winsAdded:round(h2hWinsAdded + medianWinsAdded),
          mutualTrade:mutual,
          otherNeeds:(positionFitByTeam.get(Number(other.id))?.needs || []).map(p => ({position:p.position, percent:p.percent})),
          needsMatch:(positionFitByTeam.get(Number(other.id))?.needs || [])
            .filter(p => strengthPositions.has(p.position))
            .map(p => p.position)
        });
      }
    }
  }

  rosterFitByTeam.set(Number(team.id), {
    partners:sortedPartners,
    targets:targets
      .sort((a,b) => b.needsMatch.length - a.needsMatch.length || b.boost - a.boost || b.winsAdded - a.winsAdded || a.startRate - b.startRate)
      .slice(0,3)
  });
}

const WIN_WIN_MIN_POINTS_PER_WEEK = 5;
const winWinTradesByTeam = new Map([...teams.keys()].map(teamId => [Number(teamId), []]));
const tradesStartedAt = Date.now();

const currentRosterPlayersByTeam = new Map();
for (const team of teams.values()) {
  const currentTeam = (rosterData.teams || []).find(t => Number(t.id) === Number(team.id));
  const players = (currentTeam?.roster?.entries || [])
    .filter(e => Number(e.playerId) > 0)
    .map(e => ({
      playerId:Number(e.playerId),
      player:e.playerPoolEntry?.player?.fullName || `Player #${e.playerId}`,
      position:positionNames[Number(e.playerPoolEntry?.player?.defaultPositionId)] || null,
      rosRank:fantasyProsRosByName.get(normalizePlayerName(e.playerPoolEntry?.player?.fullName)) ?? null
    }));
  currentRosterPlayersByTeam.set(Number(team.id), players);
}

function swapOptimalImpact(teamId, outgoingPlayerId, incomingEntryByWeek) {
  let boost = 0;
  let h2hWinsAdded = 0;
  let medianWinsAdded = 0;
  let weeksEvaluated = 0;

  for (const week of completedWeeks) {
    const roster = weeklyRosterForTeam(week, teamId);
    if (!roster?.roster?.entries) continue;

    const outgoing = roster.roster.entries.find(e => Number(e.playerId) === Number(outgoingPlayerId));
    const incoming = incomingEntryByWeek.get(week);
    if (!outgoing || !incoming) continue;

    const baseOptimal = lineupEfficiency(roster);
    const swappedEntries = roster.roster.entries
      .filter(e => Number(e.playerId) !== Number(outgoingPlayerId))
      .concat([{...incoming, lineupSlotId:20}]);
    const swappedOptimal = lineupEfficiency({id:Number(teamId),roster:{entries:swappedEntries}});
    if (!baseOptimal || !swappedOptimal) continue;

    const improvement = Number(swappedOptimal.optimalPoints) - Number(baseOptimal.optimalPoints);
    boost += improvement;
    weeksEvaluated++;

    const game = completed.find(m =>
      m.week === week &&
      (m.homeTeamId === Number(teamId) || m.awayTeamId === Number(teamId))
    );
    if (!game) continue;

    const opponent = game.homeTeamId === Number(teamId) ? game.awayScore : game.homeScore;
    const median = weeklyMedianByWeek.get(week);

    const beforeH2h = baseOptimal.optimalPoints > opponent ? 1 : baseOptimal.optimalPoints === opponent ? 0.5 : 0;
    const afterH2h = swappedOptimal.optimalPoints > opponent ? 1 : swappedOptimal.optimalPoints === opponent ? 0.5 : 0;
    h2hWinsAdded += afterH2h - beforeH2h;

    if (Number.isFinite(median)) {
      const beforeMedian = baseOptimal.optimalPoints > median ? 1 : baseOptimal.optimalPoints === median ? 0.5 : 0;
      const afterMedian = swappedOptimal.optimalPoints > median ? 1 : swappedOptimal.optimalPoints === median ? 0.5 : 0;
      medianWinsAdded += afterMedian - beforeMedian;
    }
  }

  return {
    boost:round(boost),
    h2hWinsAdded:round(h2hWinsAdded),
    medianWinsAdded:round(medianWinsAdded),
    winsAdded:round(h2hWinsAdded + medianWinsAdded),
    weeksEvaluated
  };
}

{
  const teamIdsForTrades = [...teams.keys()].map(Number);
  for (let i = 0; i < teamIdsForTrades.length; i++) {
    const teamAId = teamIdsForTrades[i];
    const teamAPlayers = currentRosterPlayersByTeam.get(teamAId) || [];
  
    for (let j = i + 1; j < teamIdsForTrades.length; j++) {
      const teamBId = teamIdsForTrades[j];
      const teamBPlayers = currentRosterPlayersByTeam.get(teamBId) || [];
      const trades = [];
  
      for (const playerA of teamAPlayers) {
        // Only evaluate reasonably close ROS values. This removes absurd
        // suggestions and avoids expensive historical simulations.
        if (!Number.isFinite(playerA.rosRank)) continue;
  
        const incomingForB = new Map();
        for (const week of completedWeeks) {
          const rosterA = weeklyRosterForTeam(week, teamAId);
          const entryA = rosterA?.roster?.entries?.find(e => Number(e.playerId) === playerA.playerId);
          if (entryA) incomingForB.set(week, entryA);
        }
        if (!incomingForB.size) continue;
  
        for (const playerB of teamBPlayers) {
          // Same-position swaps are excluded from this signal.
          if (playerA.position && playerB.position && playerA.position === playerB.position) continue;
  
          // Keep only trades whose FantasyPros ROS PPR ranks are within 18 spots.
          if (!Number.isFinite(playerB.rosRank) || Math.abs(playerA.rosRank - playerB.rosRank) > 18) continue;
  
          const incomingForA = new Map();
          for (const week of completedWeeks) {
            const rosterB = weeklyRosterForTeam(week, teamBId);
            const entryB = rosterB?.roster?.entries?.find(e => Number(e.playerId) === playerB.playerId);
            if (entryB) incomingForA.set(week, entryB);
          }
          if (!incomingForA.size) continue;
  
          const impactA = swapOptimalImpact(teamAId, playerA.playerId, incomingForA);
          const impactB = swapOptimalImpact(teamBId, playerB.playerId, incomingForB);
          if (!impactA.weeksEvaluated || !impactB.weeksEvaluated) continue;
  
          // A trade helps a team if it adds at least one net win, or adds at
          // least 5 optimal-lineup points per week without costing a win.
          const helps = impact =>
            (impact.winsAdded >= 1 && impact.boost > 0) ||
            (impact.winsAdded >= 0 && impact.boost >= WIN_WIN_MIN_POINTS_PER_WEEK * impact.weeksEvaluated);
          const meaningfulA = helps(impactA);
          const meaningfulB = helps(impactB);
          if (!meaningfulA || !meaningfulB) continue;
  
          trades.push({
            otherTeamId:teamBId,
            otherTeam:teams.get(teamBId)?.name || `Team ${teamBId}`,
            givePlayerId:playerA.playerId,
            givePlayer:playerA.player,
            givePosition:playerA.position,
            giveRosRank:playerA.rosRank,
            getPlayerId:playerB.playerId,
            getPlayer:playerB.player,
            getPosition:playerB.position,
            getRosRank:playerB.rosRank,
            yourBoost:impactA.boost,
            yourH2hWinsAdded:impactA.h2hWinsAdded,
            yourMedianWinsAdded:impactA.medianWinsAdded,
            yourWinsAdded:impactA.winsAdded,
            theirBoost:impactB.boost,
            theirH2hWinsAdded:impactB.h2hWinsAdded,
            theirMedianWinsAdded:impactB.medianWinsAdded,
            theirWinsAdded:impactB.winsAdded,
            weeksEvaluated:Math.min(impactA.weeksEvaluated, impactB.weeksEvaluated)
          });
        }
      }
  
      trades.sort((a,b) =>
        Math.max(b.yourWinsAdded, b.theirWinsAdded) - Math.max(a.yourWinsAdded, a.theirWinsAdded) ||
        (b.yourBoost + b.theirBoost) - (a.yourBoost + a.theirBoost)
      );
  
      if (trades.length) {
        const topTrades = trades.slice(0,3);
        winWinTradesByTeam.get(teamAId).push(...topTrades.map(t => ({...t, perspective:"A"})));
        winWinTradesByTeam.get(teamBId).push(...topTrades.map(t => ({
          ...t,
          otherTeamId:teamAId,
          otherTeam:teams.get(teamAId)?.name || `Team ${teamAId}`,
          givePlayerId:t.getPlayerId,
          givePlayer:t.getPlayer,
          givePosition:t.getPosition,
          getPlayerId:t.givePlayerId,
          getPlayer:t.givePlayer,
          getPosition:t.givePosition,
          getRosRank:t.giveRosRank,
          giveRosRank:t.getRosRank,
          yourBoost:t.theirBoost,
          yourH2hWinsAdded:t.theirH2hWinsAdded,
          yourMedianWinsAdded:t.theirMedianWinsAdded,
          yourWinsAdded:t.theirWinsAdded,
          theirBoost:t.yourBoost,
          theirH2hWinsAdded:t.yourH2hWinsAdded,
          theirMedianWinsAdded:t.yourMedianWinsAdded,
          theirWinsAdded:t.yourWinsAdded,
          perspective:"B"
        })));
      }
    }
  }
  
  
  console.log(`calculate-stats: win-win trade simulations completed in ${Date.now() - tradesStartedAt} ms`);
}


for (const teamId of teams.keys()) {
  const unique = new Map();
  for (const trade of winWinTradesByTeam.get(Number(teamId)) || []) {
    const key = [trade.otherTeamId, trade.givePlayerId, trade.getPlayerId].join("|");
    if (!unique.has(key)) unique.set(key, trade);
  }
  winWinTradesByTeam.set(Number(teamId), [...unique.values()]
    .sort((a,b) =>
      Math.max(b.yourWinsAdded,b.theirWinsAdded) - Math.max(a.yourWinsAdded,a.theirWinsAdded) ||
      (b.yourBoost+b.theirBoost) - (a.yourBoost+a.theirBoost)
    )
    .slice(0,3));
}

// Waiver targets: current free agents who would have added wins. Compares the
// best possible lineup with and without the player each completed week, so it
// measures the player's value rather than past start/sit decisions. Weeks when
// the player was on any roster are skipped.
const WAIVER_CANDIDATES_PER_WEEK = 60;
const waiverTargetsByTeam = new Map([...teams.keys()].map(teamId => [Number(teamId), []]));
for (const week of completedWeeks) {
  const rosteredThatWeek = new Set(weeklyTeamEntries(week).map(e => e.playerId));
  const candidates = (freeAgentData?.weeks?.[week] || [])
    .filter(p => !rosteredThatWeek.has(Number(p.playerId)))
    .sort((a,b) => b.points - a.points)
    .slice(0, WAIVER_CANDIDATES_PER_WEEK);
  if (!candidates.length) continue;

  for (const team of teams.values()) {
    const teamId = Number(team.id);
    const roster = weeklyRosterForTeam(week, teamId);
    const game = completed.find(m => m.week === week && (m.homeTeamId === teamId || m.awayTeamId === teamId));
    if (!roster?.roster?.entries || !game) continue;
    const base = lineupEfficiency(roster);
    if (!base) continue;
    const opponent = game.homeTeamId === teamId ? game.awayScore : game.homeScore;
    const median = weeklyMedianByWeek.get(week);

    for (const p of candidates) {
      const entry = {
        playerId:p.playerId,
        lineupSlotId:20,
        playerPoolEntry:{appliedStatTotal:p.points, player:{id:p.playerId, fullName:p.name, eligibleSlots:p.eligibleSlots, defaultPositionId:p.defaultPositionId}}
      };
      const withPlayer = lineupEfficiency({id:teamId, roster:{entries:roster.roster.entries.concat([entry])}});
      const gain = withPlayer ? withPlayer.optimalPoints - base.optimalPoints : 0;
      if (gain <= 0) continue;
      const h2h = withPlayer.optimalPoints > opponent && base.optimalPoints <= opponent ? 1 : 0;
      const med = Number.isFinite(median) && withPlayer.optimalPoints > median && base.optimalPoints <= median ? 1 : 0;
      const targets = waiverTargetsByTeam.get(teamId);
      let target = targets.find(t => t.playerId === p.playerId);
      if (!target) {
        target = {playerId:p.playerId, player:p.name, position:positionNames[p.defaultPositionId] || null, boost:0, h2hWinsAdded:0, medianWinsAdded:0, weeks:[]};
        targets.push(target);
      }
      target.boost = round(target.boost + gain);
      target.h2hWinsAdded += h2h;
      target.medianWinsAdded += med;
      target.weeks.push({week, points:round(p.points), gain:round(gain)});
    }
  }
}
for (const [teamId, targets] of waiverTargetsByTeam) {
  waiverTargetsByTeam.set(teamId, targets
    .map(t => ({...t, winsAdded:t.h2hWinsAdded + t.medianWinsAdded}))
    .filter(t => t.winsAdded >= 1)
    .sort((a,b) => b.winsAdded - a.winsAdded || b.boost - a.boost)
    .slice(0, 3));
}

const startSitByTeam = new Map();
for (const team of teams.values()) {
  const weeks = completedWeeks.map(week => {
    const game = completed.find(m =>
      m.week === week &&
      (m.homeTeamId === Number(team.id) || m.awayTeamId === Number(team.id))
    );
    if (!game) return null;

    const boxscore = historicalBoxscoreData.get(week);
    const boxscoreSide = (boxscore?.schedule || [])
      .filter(g => Number(g.matchupPeriodId) === Number(week))
      .flatMap(g => [g.home, g.away])
      .find(side => Number(side?.teamId) === Number(team.id));

    const weeklyRoster = historicalRosterData.get(week);
    const rosterTeam = (weeklyRoster?.teams || []).find(t => Number(t.id) === Number(team.id));
    const weeklyTeam = boxscoreSide?.rosterForCurrentScoringPeriod?.entries
      ? {id:Number(team.id), roster:{entries:boxscoreSide.rosterForCurrentScoringPeriod.entries}}
      : rosterTeam;

    const actualScore = game.homeTeamId === Number(team.id) ? game.homeScore : game.awayScore;
    const opponentScore = game.homeTeamId === Number(team.id) ? game.awayScore : game.homeScore;
    const result = lineupEfficiency(weeklyTeam, actualScore);
    if (!result) return null;

    return {
      week,
      ...result,
      opponentScore:round(opponentScore),
      result:actualScore > opponentScore ? "W" : "L",
      winLostToMistake:actualScore < opponentScore && result.optimalPoints > opponentScore
    };
  }).filter(Boolean);

  const totalActual = round(weeks.reduce((sum, w) => sum + w.actualPoints, 0));
  const totalOptimal = round(weeks.reduce((sum, w) => sum + w.optimalPoints, 0));
  const score = totalOptimal > 0 ? round((totalActual / totalOptimal) * 100) : null;
  const winsLost = weeks.reduce((sum, w) => {
    const actual = Number(w.actualPoints);
    const optimal = Number(w.optimalPoints);
    const opponent = Number(w.opponentScore);
    const h2hMissed = actual < opponent && optimal > opponent ? 1 : 0;

    // Median wins are awarded to teams above the weekly median. A start/sit
    // mistake costs a median win when the actual lineup is at/below the
    // median but the optimal lineup would have finished above it.
    const weekScores = completed
      .filter(m => m.week === w.week)
      .flatMap(m => [Number(m.homeScore), Number(m.awayScore)])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const median = weekScores.length
      ? (weekScores.length % 2
        ? weekScores[Math.floor(weekScores.length / 2)]
        : (weekScores[weekScores.length / 2 - 1] + weekScores[weekScores.length / 2]) / 2)
      : null;
    const medianMissed = Number.isFinite(median) && actual <= median && optimal > median ? 1 : 0;

    return sum + h2hMissed + medianMissed;
  }, 0);
  startSitByTeam.set(team.id, {
    score,
    actualPoints:totalActual,
    optimalPoints:totalOptimal,
    weeks,
    pointsLeft:round(weeks.reduce((sum, w) => sum + w.pointsLeft, 0)),
    winsLost
  });
}

const playerAwardsByTeam = new Map();

for (const team of teams.values()) {
  const players = awardPlayersByTeam.get(Number(team.id)) || [];

  // MVP / scoring awards use only points actually scored for this team,
  // and only when the player was in a starting slot that week.
  const teamScoringPlayers = players.map(p => ({
    ...p,
    points:p.weekly.filter(w => w.started).reduce((sum,w) => sum + w.score, 0)
  }));

  const rankedTeamScorers = [...teamScoringPlayers].filter(p => p.points > 0).sort((a,b) => b.points - a.points);
  const mvp = rankedTeamScorers[0] || null;
  const mvpSeasonRank = mvp ? rankedTeamScorers.findIndex(p => p.playerId === mvp.playerId) + 1 : null;

  const draftedByTeam = players.filter(p =>
    p.draft &&
    Number(p.draft.overallPickNumber) > 0 &&
    Number(p.draft.teamId) === Number(team.id)
  );

  const draftPool = draftedByTeam.map(p => {
    const rosRank = fantasyProsRosByName.get(normalizePlayerName(p.name));
    return {
      ...p,
      draftPick:Number(p.draft.overallPickNumber),
      round:Number(p.draft.roundId || 0),
      rosRank:Number.isFinite(rosRank) ? rosRank : null,
      valueGap:Number.isFinite(rosRank) ? Number(p.draft.overallPickNumber) - rosRank : null
    };
  });

  // Draft value is measured against the live FantasyPros ROS PPR ranking:
  // a positive gap means the player is now ranked higher than where he was drafted.
  const draftValuePool = draftPool.filter(p => Number.isFinite(p.valueGap));
  const bestValue = maxBy(draftValuePool, p => p.valueGap);
  const worstValue = minBy(draftValuePool, p => p.valueGap);

  const boomCandidates = players.flatMap(p =>
    p.weekly.filter(w => w.started).map(w => ({...p,week:w.week,weekScore:w.score}))
  );
  const boom = maxBy(boomCandidates, p => p.weekScore);

  const consistentCandidates = players
    .map(p => ({
      ...p,
      variance:stddev(p.weekly.filter(w => w.started).map(w => w.score))
    }))
    .filter(p => Number.isFinite(p.variance));
  const mostConsistent = minBy(consistentCandidates, p => p.variance);

  const lateRound = maxBy(draftValuePool.filter(p => p.round >= 8), p => p.valueGap);

  const boomBustCandidates = players
    .map(p => {
      const weekly = p.weekly.filter(w => w.started);
      return {
        ...p,
        weeklyRange:weekly.length > 1
          ? Math.max(...weekly.map(w => w.score)) - Math.min(...weekly.map(w => w.score))
          : null
      };
    })
    .filter(p => Number.isFinite(p.weeklyRange));

  const boomBust = maxBy(boomBustCandidates, p => p.weeklyRange);

  playerAwardsByTeam.set(team.id, {
    mvp:mvp ? {
      playerId:mvp.playerId,player:mvp.name,position:mvp.position,points:round(mvp.points),
      seasonRank:mvpSeasonRank
    } : null,
    bestDraftValue:bestValue ? {
      playerId:bestValue.playerId,player:bestValue.name,points:round(bestValue.points),
      draftPick:bestValue.draftPick,round:bestValue.round,rosRank:bestValue.rosRank,valueGap:round(bestValue.valueGap)
    } : null,
    worstDraftValue:worstValue ? {
      playerId:worstValue.playerId,player:worstValue.name,points:round(worstValue.points),
      draftPick:worstValue.draftPick,round:worstValue.round,rosRank:worstValue.rosRank,valueGap:round(worstValue.valueGap)
    } : null,
    boomMachine:boom ? {
      playerId:boom.playerId,player:boom.name,week:boom.week,score:round(boom.weekScore)
    } : null,
    mostConsistent:mostConsistent ? {
      playerId:mostConsistent.playerId,player:mostConsistent.name,variance:round(mostConsistent.variance)
    } : null,
    lateRoundWizard:lateRound ? {
      playerId:lateRound.playerId,player:lateRound.name,round:lateRound.round,
      draftPick:lateRound.draftPick,rosRank:lateRound.rosRank,valueGap:round(lateRound.valueGap),points:round(lateRound.points)
    } : null,
    boomBust:boomBust ? {
      playerId:boomBust.playerId,player:boomBust.name,range:round(boomBust.weeklyRange)
    } : null
  });
}

const trendByTeam = new Map(trends.map(t => [Number(t.teamId), t]));
const luckByTeam = new Map(luckAwards.map(t => [Number(t.teamId), t]));

await writeJson("data/current/teams.json",{season:settings.seasonId,currentWeek,teams:[...teams.values()].map(t=>{
  const trend = trendByTeam.get(Number(t.id)) || null;
  const luck = luckByTeam.get(Number(t.id)) || null;
  const startSit = startSitByTeam.get(t.id) || null;
  return {
    ...t,
    standings:standings.find(s=>s.id===t.id)||null,
    weeklyResults:completed.filter(m=>m.homeTeamId===t.id||m.awayTeamId===t.id).map(m=>({week:m.week,opponentId:m.homeTeamId===t.id?m.awayTeamId:m.homeTeamId,opponent:name(m.homeTeamId===t.id?m.awayTeamId:m.homeTeamId),score:m.homeTeamId===t.id?m.homeScore:m.awayScore,opponentScore:m.homeTeamId===t.id?m.awayScore:m.homeScore,result:(m.homeTeamId===t.id?m.winner==="HOME":m.winner==="AWAY")?"W":"L"})),
    playerAwards:playerAwardsByTeam.get(t.id)||null,
    startSit,
    profileAnalytics:{
      optimalLineup:startSit ? {actualPoints:startSit.actualPoints,optimalPoints:startSit.optimalPoints,pointsLeft:startSit.pointsLeft,efficiency:startSit.score} : null,
      positionFit:positionFitByTeam.get(Number(t.id))||null,
      rosterFit:rosterFitByTeam.get(Number(t.id))||null,
      winWinTrades:winWinTradesByTeam.get(Number(t.id))||[],
      waiverTargets:freeAgentData ? waiverTargetsByTeam.get(Number(t.id))||[] : null,
      trend:trend ? {...trend,direction:trend.slope >= 2 ? "up" : trend.slope <= -2 ? "down" : "steady"} : null,
      luck:luck ? {actualWins:round(luck.actual),expectedWins:round(luck.expected),difference:round(luck.luck)} : null
    }
  };
})});

function normalizePlayerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}
function name(id){return teams.get(id)?.name||"Team "+id}
function streak(id){const gs=completed.filter(m=>m.homeTeamId===id||m.awayTeamId===id).sort((a,b)=>a.week-b.week);if(!gs.length)return{type:"NONE",length:0};const last=gs[gs.length-1],type=(last.homeTeamId===id?last.winner==="HOME":last.winner==="AWAY")?"W":"L";let length=0;for(let i=gs.length-1;i>=0;i--){const g=gs[i],t=(g.homeTeamId===id?g.winner==="HOME":g.winner==="AWAY")?"W":"L";if(t!==type)break;length++}return{type,length}}
function scoreAward(x){return x?{week:x.week,teamId:x.teamId,team:name(x.teamId),opponentId:x.opponentId,opponent:name(x.opponentId),score:round(x.score),result:x.result}:null}
function matchupAward(x){if(!x)return null;const h=x.winner==="HOME";return{week:x.week,winnerTeamId:h?x.homeTeamId:x.awayTeamId,winner:name(h?x.homeTeamId:x.awayTeamId),loserTeamId:h?x.awayTeamId:x.homeTeamId,loser:name(h?x.awayTeamId:x.homeTeamId),winnerScore:round(h?x.homeScore:x.awayScore),loserScore:round(h?x.awayScore:x.homeScore),margin:round(x.margin)}}
function maxBy(a,f){return a.length?a.reduce((b,x)=>f(x)>f(b)?x:b):null}
function minBy(a,f){return a.length?a.reduce((b,x)=>f(x)<f(b)?x:b):null}
function round(n){return Math.round((Number(n)+Number.EPSILON)*100)/100}
async function readJson(p){return JSON.parse(await readFile(p,"utf8"))}
async function writeJson(p,v){await writeFile(p,JSON.stringify(v,null,2)+"\n")}