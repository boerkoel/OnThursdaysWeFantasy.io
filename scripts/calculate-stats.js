import { mkdir, readFile, writeFile } from "node:fs/promises";

const settings = await readJson("data/current/mSettings.json");
const previousScoreboard = await readJson("data/current/scoreboard.json").catch(() => null);
const previousProjectionHistory = previousScoreboard?.projectionHistory || [];
const teamData = await readJson("data/current/mTeam.json");
const matchupData = await readJson("data/current/mMatchup.json");
const rosterData = await readJson("data/current/mRoster.json");
const liveScoringData = await readJson("data/current/mLiveScoring.json");
const boxscoreData = await readJson("data/current/mBoxscore.json");
const scoreboardData = await readJson("data/current/mScoreboard.json");
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

// ESPN's mBoxscore response includes schedule entries for many/all matchup
// periods. Only use entries for the current matchup period; otherwise later
// zero-valued future matchups can overwrite the live totals for the same team.
const liveSchedule = (liveScoringData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const boxscoreSchedule = (boxscoreData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const allLiveSchedules = [...liveSchedule, ...boxscoreSchedule];
const liveByTeam = new Map();

for (const g of allLiveSchedules) {
  for (const side of [g.home, g.away]) {
    if (!side?.teamId) continue;

    // ESPN's boxscore can report totalPoints=0 while games are live,
    // while the roster entries contain the actual live player scores.
    const playerTotal = (side.rosterForCurrentScoringPeriod?.entries || [])
      .filter(entry => Number(entry.lineupSlotId) !== 20)
      .reduce(
        (sum, entry) => sum + Number(entry.playerPoolEntry?.appliedStatTotal ?? 0),
        0
      );

    const reportedLive = Number(side.totalPointsLive);
    const reportedTotal = Number(side.totalPoints);
    const fallbackScore = Number(side.cumulativeScore?.score ?? 0);

    const liveScore = Number.isFinite(reportedLive) && reportedLive > 0
      ? reportedLive
      : playerTotal > 0
        ? playerTotal
        : Number.isFinite(reportedTotal)
          ? reportedTotal
          : fallbackScore;

    liveByTeam.set(side.teamId, liveScore);
  }
}

// ESPN can expose totalProjectedPointsLive directly. When it does not,
// calculate the ESPN weekly projection by summing active roster players'
// projected appliedTotal values (statSourceId 1).
const espnProjectionByTeam = new Map();

const projectionSchedules = [
  ...(scoreboardData.schedule || []),
  ...(liveScoringData.schedule || []),
  ...(boxscoreSchedule || [])
].filter(g => Number(g.matchupPeriodId) === currentWeek);

for (const g of projectionSchedules) {
  for (const side of [g.home, g.away]) {
    if (!side?.teamId) continue;

    const liveProjection = Number(side.totalProjectedPointsLive);
    if (Number.isFinite(liveProjection) && liveProjection > 0) {
      espnProjectionByTeam.set(side.teamId, round(liveProjection));
      continue;
    }

    const projection = (side.rosterForCurrentScoringPeriod?.entries || [])
      .filter(entry => Number(entry.lineupSlotId) !== 20)
      .reduce((sum, entry) => {
        const stats = entry.playerPoolEntry?.player?.stats || [];
        const weeklyProjection = stats.find(s =>
          Number(s.scoringPeriodId) === currentWeek &&
          Number(s.statSourceId) === 1 &&
          Number(s.statSplitTypeId) === 1
        );
        return sum + Number(weeklyProjection?.appliedTotal ?? 0);
      }, 0);

    // Do not let a later ESPN response overwrite a valid projection
    // with a weaker fallback from another view.
    if (!espnProjectionByTeam.has(side.teamId) && projection > 0) {
      espnProjectionByTeam.set(side.teamId, round(projection));
    }
  }
}

const previousProjections = new Map();
for (const snapshot of previousProjectionHistory) {
  for (const score of snapshot.scores || []) {
    const projection = Number(score.projectionAverage ?? score.projection?.espn);
    if (Number.isFinite(projection)) previousProjections.set(score.teamId, projection);
  }
}

const currentProjectionSnapshot = {
  timestamp: new Date().toISOString(),
  week: currentWeek,
  scores: [...espnProjectionByTeam.entries()].map(([teamId, projection]) => ({teamId, projection}))
};
const projectionHistory = [
  ...previousProjectionHistory.filter(snapshot => Number(snapshot.week) === currentWeek),
  currentProjectionSnapshot
].slice(-4);

const priorThreeSnapshots = projectionHistory.slice(0, -1).slice(-3);
const recentProjectionAverage = new Map();
for (const teamId of teams.keys()) {
  const values = priorThreeSnapshots
    .map(snapshot => (snapshot.scores || []).find(s => s.teamId === teamId)?.projection)
    .map(Number)
    .filter(Number.isFinite);
  if (values.length) recentProjectionAverage.set(teamId, values.reduce((sum, value) => sum + value, 0) / values.length);
}

const projectionTrend = (teamId, projection) => {
  const baseline = recentProjectionAverage.get(teamId);
  if (!Number.isFinite(projection) || !Number.isFinite(baseline)) return null;
  const delta = projection - baseline;
  if (Math.abs(delta) < 0.25) return null;
  return delta > 0 ? "up" : "down";
};

const currentScores = currentWeekMatchups.flatMap(m => [
  { teamId:m.homeTeamId, opponentId:m.awayTeamId, score:liveByTeam.get(m.homeTeamId) ?? m.homeScore, opponentScore:liveByTeam.get(m.awayTeamId) ?? m.awayScore, matchupId:m.id },
  { teamId:m.awayTeamId, opponentId:m.homeTeamId, score:liveByTeam.get(m.awayTeamId) ?? m.awayScore, opponentScore:liveByTeam.get(m.homeTeamId) ?? m.homeScore, matchupId:m.id }
]).map(x => ({
  ...x,
  team:name(x.teamId),
  opponent:name(x.opponentId),
  logo:teams.get(x.teamId)?.logo || null,
  projection:{
    espn:espnProjectionByTeam.get(x.teamId) ?? null
  },
  projectionAverage:espnProjectionByTeam.get(x.teamId) ?? null,
  projectionTrend:projectionTrend(x.teamId, espnProjectionByTeam.get(x.teamId)),
  status: currentWeekMatchups.find(m => m.id === x.matchupId)?.completed ? "FINAL" : "LIVE"
})).sort((a,b)=>b.score-a.score);

const median = currentScores.length % 2
  ? currentScores[Math.floor(currentScores.length / 2)].score
  : currentScores.length ? round((currentScores[currentScores.length / 2 - 1].score + currentScores[currentScores.length / 2].score) / 2) : null;

const projectedValues = currentScores
  .map(s => Number(s.projectionAverage))
  .filter(Number.isFinite)
  .sort((a,b)=>a-b);
const projectedMedian = projectedValues.length % 2
  ? projectedValues[Math.floor(projectedValues.length / 2)]
  : projectedValues.length
    ? round((projectedValues[projectedValues.length / 2 - 1] + projectedValues[projectedValues.length / 2]) / 2)
    : null;

const currentScoreboard = {
  week:currentWeek,
  lastUpdated:new Date().toISOString(),
  scores:currentScores,
  median,
  projectedMedian,
  projectionSources:["ESPN"],
  projectionHistory
};

const standings = [...teams.values()].map(team => {
  const games=completed.filter(m=>m.homeTeamId===team.id||m.awayTeamId===team.id);
  let wins=0,losses=0,pointsFor=0,pointsAgainst=0;
  for(const g of games){
    const home=g.homeTeamId===team.id;
    pointsFor += home?g.homeScore:g.awayScore;
    pointsAgainst += home?g.awayScore:g.homeScore;
    if(home?g.winner==="HOME":g.winner==="AWAY") wins++; else losses++;
  }
  return {...team,wins,losses,games:games.length,winPct:games.length?wins/games.length:0,
    pointsFor:round(pointsFor),pointsAgainst:round(pointsAgainst),streak:streak(team.id)};
}).sort((a,b)=>b.wins-a.wins||b.pointsFor-a.pointsFor);

const rows=completed.flatMap(g=>[
  {week:g.week,teamId:g.homeTeamId,opponentId:g.awayTeamId,score:g.homeScore,result:g.winner==="HOME"?"W":"L"},
  {week:g.week,teamId:g.awayTeamId,opponentId:g.homeTeamId,score:g.awayScore,result:g.winner==="AWAY"?"W":"L"}
]);
const highestScore=maxBy(rows,x=>x.score);
const lowestScore=minBy(rows,x=>x.score);
const highestScoringLoser=maxBy(rows.filter(x=>x.result==="L"),x=>x.score);
const lowestScoringWinner=minBy(rows.filter(x=>x.result==="W"),x=>x.score);
const blowout=maxBy(completed,x=>x.margin);

const bench=(rosterData.teams||[]).map(t=>{
  const players=(t.roster?.entries||[]).filter(e=>Number(e.lineupSlotId)===20);
  return {teamId:t.id,week:currentWeek,points:round(players.reduce((s,e)=>s+Number(e.playerPoolEntry?.appliedStatTotal||0),0)),
    players:players.map(e=>({playerId:e.playerId,name:e.playerPoolEntry?.player?.fullName||"Unknown player",points:round(Number(e.playerPoolEntry?.appliedStatTotal||0))})).sort((a,b)=>b.points-a.points)};
}).sort((a,b)=>b.points-a.points);

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
  benchWarmerChampion:bench[0]?{week:currentWeek,teamId:bench[0].teamId,team:name(bench[0].teamId),points:bench[0].points,players:bench[0].players}:null};

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

const ultimateEntrants = [
  ...nonPlayoffTeams
    .sort((a,b)=>b.seed-a.seed)
    .map((t,i)=>({seed:i+1,teamId:t.id,team:t.name,source:"REGULAR_SEASON",regularSeasonSeed:t.seed,pointsFor:t.pointsFor})),
  ...playoffLosers
    .sort((a,b)=>(b.playoffSeed??0)-(a.playoffSeed??0))
    .map((t,i)=>({seed:5+i,teamId:t.teamId,team:t.team,source:"WEEK_15_PLAYOFF_LOSER",playoffSeed:t.playoffSeed,opponent:t.opponent}))
];

const ulSeedMap = new Map(ultimateEntrants.map(t=>[t.seed,t]));
const ultimateLoserSchedule = [
  {id:"ul-qf1",week:16,round:"Quarterfinal",homeSeed:1,awaySeed:6},
  {id:"ul-qf2",week:16,round:"Quarterfinal",homeSeed:2,awaySeed:5},
  {id:"ul-qf3",week:16,round:"Quarterfinal",homeSeed:3,awaySeed:8},
  {id:"ul-qf4",week:16,round:"Quarterfinal",homeSeed:4,awaySeed:7},
  {id:"ul-sf1",week:17,round:"Semifinal",homeFrom:"ul-qf1",awayFrom:"ul-qf2"},
  {id:"ul-sf2",week:17,round:"Semifinal",homeFrom:"ul-qf3",awayFrom:"ul-qf4"},
  {id:"ul-final",week:18,round:"Championship",homeFrom:"ul-sf1",awayFrom:"ul-sf2"}
].map(g=>({
  ...g,
  homeTeam:g.homeSeed?ulSeedMap.get(g.homeSeed)?.team:null,
  awayTeam:g.awaySeed?ulSeedMap.get(g.awaySeed)?.team:null,
  homeSeed:g.homeSeed??null,
  awaySeed:g.awaySeed??null
}));

const ultimateLoser = {
  format:"3-week single elimination",
  advancementRule:"LOWER_SCORE_ADVANCES",
  currentWeek,
  status:currentWeek>=16 ? "ACTIVE" : "PROJECTED",
  entrants:ultimateEntrants,
  playoffLosers,
  schedule:ultimateLoserSchedule,
  note:"Six regular-season non-playoff teams enter as seeds 1-6; the two Week 15 playoff losers enter as seeds 7-8. The lower-scoring team advances each round."
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
await writeJson("data/current/scoreboard.json",currentScoreboard);
await writeJson("data/current/awards.json",{season:settings.seasonId,currentWeek,awards});
await writeJson("data/current/leaders.json",{season:settings.seasonId,currentWeek,leaders:{highestScore:scoreAward(highestScore),lowestScore:scoreAward(lowestScore),highestScoringLoser:scoreAward(highestScoringLoser),lowestScoringWinner:scoreAward(lowestScoringWinner),largestBlowout:matchupAward(blowout)}});
await writeJson("data/current/weekly.json",{season:settings.seasonId,currentWeek,weeks:completedWeeks.map(week=>({week,matchups:completed.filter(m=>m.week===week),highestScore:scoreAward(maxBy(rows.filter(x=>x.week===week),x=>x.score)),largestBlowout:matchupAward(maxBy(completed.filter(m=>m.week===week),x=>x.margin))}))});
await writeJson("data/current/teams.json",{season:settings.seasonId,currentWeek,teams:[...teams.values()].map(t=>({...t,standings:standings.find(s=>s.id===t.id)||null,weeklyResults:completed.filter(m=>m.homeTeamId===t.id||m.awayTeamId===t.id).map(m=>({week:m.week,opponentId:m.homeTeamId===t.id?m.awayTeamId:m.homeTeamId,opponent:name(m.homeTeamId===t.id?m.awayTeamId:m.homeTeamId),score:m.homeTeamId===t.id?m.homeScore:m.awayScore,opponentScore:m.homeTeamId===t.id?m.awayScore:m.homeScore,result:(m.homeTeamId===t.id?m.winner==="HOME":m.winner==="AWAY")?"W":"L"}))}))});

function name(id){return teams.get(id)?.name||"Team "+id}
function streak(id){const gs=completed.filter(m=>m.homeTeamId===id||m.awayTeamId===id).sort((a,b)=>a.week-b.week);if(!gs.length)return{type:"NONE",length:0};const last=gs[gs.length-1],type=(last.homeTeamId===id?last.winner==="HOME":last.winner==="AWAY")?"W":"L";let length=0;for(let i=gs.length-1;i>=0;i--){const g=gs[i],t=(g.homeTeamId===id?g.winner==="HOME":g.winner==="AWAY")?"W":"L";if(t!==type)break;length++}return{type,length}}
function scoreAward(x){return x?{week:x.week,teamId:x.teamId,team:name(x.teamId),opponentId:x.opponentId,opponent:name(x.opponentId),score:round(x.score),result:x.result}:null}
function matchupAward(x){if(!x)return null;const h=x.winner==="HOME";return{week:x.week,winnerTeamId:h?x.homeTeamId:x.awayTeamId,winner:name(h?x.homeTeamId:x.awayTeamId),loserTeamId:h?x.awayTeamId:x.homeTeamId,loser:name(h?x.awayTeamId:x.homeTeamId),winnerScore:round(h?x.homeScore:x.awayScore),loserScore:round(h?x.awayScore:x.homeScore),margin:round(x.margin)}}
function maxBy(a,f){return a.length?a.reduce((b,x)=>f(x)>f(b)?x:b):null}
function minBy(a,f){return a.length?a.reduce((b,x)=>f(x)<f(b)?x:b):null}
function round(n){return Math.round((Number(n)+Number.EPSILON)*100)/100}
async function readJson(p){return JSON.parse(await readFile(p,"utf8"))}
async function writeJson(p,v){await writeFile(p,JSON.stringify(v,null,2)+"\n")}