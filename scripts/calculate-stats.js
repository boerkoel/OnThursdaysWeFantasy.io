import { mkdir, readFile, writeFile } from "node:fs/promises";

function money(n){return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00"}

const settings = await readJson("data/current/mSettings.json");
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
const logoMap = await readJson("data/current/logo-map.json").catch(() => ({}));

const teams = new Map((teamData.teams || []).map(t => [t.id, { id:t.id, name:(t.name||"").trim(), abbrev:t.abbrev||"", logo:logoMap[String(t.id)] || t.logo || null }]));
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

// Standings (and therefore playoff seeding) count regular-season games only,
// so playoff results can't reshuffle the seeds.
const regularSeasonWeeks = Number(settings.settings?.scheduleSettings?.matchupPeriodCount || 14);
const standings = [...teams.values()].map(team => {
  const games=completed.filter(m=>m.week<=regularSeasonWeeks&&(m.homeTeamId===team.id||m.awayTeamId===team.id));
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
  // Bad Beat: the narrowest loss of the season.
  narrowestLoss:matchupAward(minBy(completed.filter(m => m.margin > 0), x => x.margin)),
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
const week15Completed = matchups.filter(m=>m.week===15 && m.completed);
// Semifinals are reseeded: once the quarterfinals are final, the #1 seed plays
// the lowest remaining seed (the higher seed number) and #2 plays the other.
const quarterfinalWinnerSeeds = week15Completed
  .map(m => playoffSeeds.find(s => s.id === (m.winner === "HOME" ? m.homeTeamId : m.awayTeamId))?.seed)
  .filter(seed => seed >= 3)
  .sort((a,b) => b - a);
const semifinalOpponentSeed = { 1: quarterfinalWinnerSeeds[0], 2: quarterfinalWinnerSeeds[1] };
const playoffSchedule = [
  {id:"qf1",week:15,round:"Quarterfinal",homeSeed:3,awaySeed:6},
  {id:"qf2",week:15,round:"Quarterfinal",homeSeed:4,awaySeed:5},
  {id:"sf1",week:16,round:"Semifinal",homeSeed:1,homeBye:true,awaySeed:quarterfinalWinnerSeeds.length === 2 ? semifinalOpponentSeed[1] : undefined},
  {id:"sf2",week:16,round:"Semifinal",homeSeed:2,homeBye:true,awaySeed:quarterfinalWinnerSeeds.length === 2 ? semifinalOpponentSeed[2] : undefined},
  {id:"final",week:17,round:"Championship"},
  {id:"third",week:17,round:"Third Place"}
].map(g=>({
  ...g,
  homeTeam:g.homeSeed?playoffSeedMap.get(g.homeSeed)?.name:null,
  awayTeam:g.awaySeed?playoffSeedMap.get(g.awaySeed)?.name:null
}));

const playoffLosers = week15Completed.map(m => {
  const loserId = m.winner === "HOME" ? m.awayTeamId : m.homeTeamId;
  const winnerId = m.winner === "HOME" ? m.homeTeamId : m.awayTeamId;
  const loserSeed = playoffSeeds.find(s=>s.id===loserId)?.seed ?? null;
  return {teamId:loserId,team:name(loserId),playoffSeed:loserSeed,week:15,opponentId:winnerId,opponent:name(winnerId)};
}).filter(x=>x.teamId);

const sortedNonPlayoffTeams = [...nonPlayoffTeams].sort((a,b)=>a.seed-b.seed);
// Lower-ranked loser (higher seed number) first: it becomes Ultimate Loser #7,
// the higher-ranked loser #8.
const sortedPlayoffLosers = [...playoffLosers].sort((a,b)=>(b.playoffSeed??0)-(a.playoffSeed??0));

// The Ultimate Loser field is an 8-team bracket: the six regular-season
// non-playoff teams are seeded first, followed by the two Week 15 playoff
// losers: the lower-ranked one at #7 and the higher-ranked one at #8. Until
// Week 15 is complete, those final two spots remain labeled.
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

// The site runs the Ultimate Loser bracket itself (ESPN doesn't schedule
// these games), so each team's score for the week comes from whatever ESPN
// matchup it played, or else from its starting lineup that week.
const ultimateLoserRosters = new Map();
async function loadUltimateLoserWeek(week) {
  if (!ultimateLoserRosters.has(week)) {
    ultimateLoserRosters.set(week, await readJson(`data/current/mRoster-week-${week}.json`).catch(() => null));
  }
}
function weekIsOver(week) {
  return completedWeeks.includes(week) || week < currentWeek || (week === currentWeek && currentWeekFinal);
}
function teamWeekScore(teamId, week) {
  const game = matchups.find(m => m.week === week && (m.homeTeamId === teamId || m.awayTeamId === teamId));
  if (game) return game.homeTeamId === teamId ? game.homeScore : game.awayScore;
  const team = (ultimateLoserRosters.get(week)?.teams || []).find(t => Number(t.id) === Number(teamId));
  if (!team) return null;
  return round((team.roster?.entries || [])
    .filter(e => ![20, 21].includes(Number(e.lineupSlotId)))
    .reduce((sum, e) => sum + Number((e.playerPoolEntry?.player?.stats || []).find(st =>
      Number(st.scoringPeriodId) === week && Number(st.statSourceId) === 0 && Number(st.statSplitTypeId) === 1
    )?.appliedTotal || 0), 0));
}
function completedUltimateLoserGame(teamAId, teamBId, week) {
  if (!weekIsOver(week)) return null;
  const aScore = teamWeekScore(teamAId, week);
  const bScore = teamWeekScore(teamBId, week);
  if (aScore == null || bScore == null) return null;
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

// The current week counts as over once every NFL game in it is final.
const latestScoreboard = await readJson("data/current/scoreboard.json").catch(() => null);
const currentWeekFinal = Number(latestScoreboard?.week) === currentWeek &&
  (latestScoreboard?.nflGames || []).length > 0 && latestScoreboard.nflGames.every(g => g.completed);
for (const week of [16, 17, 18]) await loadUltimateLoserWeek(week);

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
// Instant regrets: a single bench-for-starter swap (bench player eligible for
// the starter's slot) that would have flipped a loss to a win, or a
// below-median week to above it. The median is recomputed with the swap, since
// the team's own score is part of it. One per team: the swap that flips the
// most, then the biggest gain.
const REGRET_BENCH_SLOT = 20, REGRET_IR_SLOT = 21;
const medianOf = values => {
  const sorted = values.slice().sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
};
function weeklyRegrets(week) {
  const games = completed.filter(m => Number(m.week) === Number(week));
  const sides = games.flatMap(m => [
    {teamId:m.homeTeamId, score:Number(m.homeScore), opponentScore:Number(m.awayScore), won:m.winner === "HOME", matchupId:m.id},
    {teamId:m.awayTeamId, score:Number(m.awayScore), opponentScore:Number(m.homeScore), won:m.winner === "AWAY", matchupId:m.id}
  ]).filter(x => Number.isFinite(x.score));
  if (!sides.length) return [];
  const median = medianOf(sides.map(x => x.score));
  const entries = weeklyTeamEntries(week).filter(e => Number.isFinite(e.score));
  const regrets = [];
  for (const side of sides) {
    const mine = entries.filter(e => e.teamId === Number(side.teamId));
    const starters = mine.filter(e => e.lineupSlotId !== REGRET_BENCH_SLOT && e.lineupSlotId !== REGRET_IR_SLOT);
    const bench = mine.filter(e => e.lineupSlotId === REGRET_BENCH_SLOT);
    let best = null;
    for (const b of bench) for (const s of starters) {
      const gain = round(b.score - s.score);
      if (gain <= 0 || !(b.eligibleSlots || []).includes(s.lineupSlotId)) continue;
      const newScore = side.score + gain;
      const flips = [];
      if (!side.won && newScore > side.opponentScore) flips.push("win");
      if (side.score < median && newScore > medianOf(sides.map(x => x === side ? newScore : x.score))) flips.push("median");
      if (!flips.length) continue;
      if (!best || flips.length > best.flips.length || (flips.length === best.flips.length && gain > best.gain)) {
        best = {teamId:Number(side.teamId), team:name(side.teamId), matchupId:side.matchupId, benchPlayer:b.name, benchPoints:round(b.score), starter:s.name, starterPoints:round(s.score), gain, flips};
      }
    }
    if (best) regrets.push(best);
  }
  return regrets;
}
const regretOutcome = r => r.flips.includes("win") && r.flips.includes("median") ? "won and finished above the median"
  : r.flips.includes("win") ? "won" : "finished above the median";

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
  if (closeGame) {
    const [winnerId, loserId] = closeGame.winner === "AWAY" ? [closeGame.awayTeamId, closeGame.homeTeamId] : [closeGame.homeTeamId, closeGame.awayTeamId];
    add("CLOSEST MATCHUP","⚔️ " + name(winnerId) + " edged " + name(loserId) + " by just " + money(closeGame.margin) + " points.",90);
  }

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

  const luckyWinner = games.flatMap(m => [
    {teamId:m.homeTeamId,score:Number(m.homeScore),won:m.winner==="HOME"},
    {teamId:m.awayTeamId,score:Number(m.awayScore),won:m.winner==="AWAY"}
  ]).filter(x=>x.won && Number.isFinite(median) && x.score < median).sort((a,b)=>a.score-b.score)[0];
  const regret = weeklyRegrets(week).sort((a,b) => b.flips.length - a.flips.length || b.gain - a.gain)[0];
  if (regret) add("INSTANT REGRET","🤦 " + regret.team + " would have " + regretOutcome(regret) + " by starting " + regret.benchPlayer + " (" + money(regret.benchPoints) + ") over " + regret.starter + " (" + money(regret.starterPoints) + ").",88);
  if (luckyWinner) add("LUCKY WIN","🍀 " + name(luckyWinner.teamId) + " won with just " + money(luckyWinner.score) + " points — below the league median.",70);

  return stories.sort((a,b)=>b.priority-a.priority).slice(0,6).map(({type,text})=>({type,text}));
}

const weeklyRecaps = completedWeeks.map(week => ({
  week,
  recap:buildWeeklyRecap(week),
  regrets:weeklyRegrets(week),
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
          position:entry.playerPoolEntry?.player?.defaultPositionId || null,
          eligibleSlots:(entry.playerPoolEntry?.player?.eligibleSlots || []).map(Number)
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
        // The roster's appliedStatTotal is season-to-date; use that week's
        // actual points (none on record, e.g. a bye, counts as 0).
        score:Number((entry.playerPoolEntry?.player?.stats || []).find(st =>
          Number(st.scoringPeriodId) === Number(week) && Number(st.statSourceId) === 0 && Number(st.statSplitTypeId) === 1
        )?.appliedTotal || 0),
        name:entry.playerPoolEntry?.player?.fullName || `Player #${entry.playerId}`,
        position:entry.playerPoolEntry?.player?.defaultPositionId || null,
        eligibleSlots:(entry.playerPoolEntry?.player?.eligibleSlots || []).map(Number)
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

// allowEmpty: a slot nobody can fill scores 0 (used for trades, where giving
// away your only TE leaves a hole) instead of making the lineup impossible.
function lineupEfficiency(weeklyTeam, actualPointsOverride = null, excludedPlayerId = null, allowEmpty = false) {
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
    if (index >= entries.length) return allowEmpty || remaining.every(x => x === 0) ? 0 : -Infinity;
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

// Long-term regrets (League Wire): players still on the bench that the
// manager has rarely or never started. For each week he sat, swap him into
// the manager's actual lineup over the weakest starter he could replace and
// rescore the week against the opponent and the median.
const longTermRegretsByTeam = new Map();
for (const team of teams.values()) {
  const currentTeam = (rosterData.teams || []).find(t => Number(t.id) === Number(team.id));
  const regrets = [];
  for (const entry of currentTeam?.roster?.entries || []) {
    if (Number(entry.lineupSlotId) !== 20) continue;
    const playerId = Number(entry.playerId);
    const history = playerTeamHistory.get(`${team.id}|${playerId}`);
    if (!history?.weekly?.length) continue;
    const startedWeeks = history.weekly.filter(w => w.started).length;
    let points = 0, h2h = 0, median = 0;
    const weeks = [];
    for (const w of history.weekly.filter(w => !w.started)) {
      const entries = weeklyRosterForTeam(w.week, team.id)?.roster?.entries || [];
      const me = entries.find(e => Number(e.playerId) === playerId);
      if (!me || Number(me.lineupSlotId) === 21) continue;
      const myPoints = Number(me.playerPoolEntry?.appliedStatTotal) || 0;
      const eligible = (me.playerPoolEntry?.player?.eligibleSlots || []).map(Number);
      const starters = entries.filter(e => ![20, 21].includes(Number(e.lineupSlotId)));
      const weakest = starters.filter(e => eligible.includes(Number(e.lineupSlotId)))
        .map(e => Number(e.playerPoolEntry?.appliedStatTotal) || 0).sort((a, b) => a - b)[0];
      if (weakest === undefined || myPoints <= weakest) continue;
      const gain = myPoints - weakest;
      const actual = starters.reduce((sum, e) => sum + (Number(e.playerPoolEntry?.appliedStatTotal) || 0), 0);
      const game = completed.find(m => m.week === w.week && (m.homeTeamId === Number(team.id) || m.awayTeamId === Number(team.id)));
      const opponent = game ? Number(game.homeTeamId === Number(team.id) ? game.awayScore : game.homeScore) : NaN;
      const weekMedian = Number(weeklyMedianByWeek.get(w.week));
      const flip = target => Number.isFinite(target) && actual < target && actual + gain > target ? 1 : 0;
      h2h += flip(opponent);
      median += flip(weekMedian);
      points += gain;
      weeks.push(w.week);
    }
    if (h2h + median >= 1) {
      regrets.push({playerId, player:entry.playerPoolEntry?.player?.fullName || history.name, position:positionNames[Number(entry.playerPoolEntry?.player?.defaultPositionId)] || null,
        startedWeeks, rosteredWeeks:history.weekly.length, weeks, points:round(points), h2hWins:h2h, medianWins:median, winsAdded:h2h + median});
    }
  }
  longTermRegretsByTeam.set(Number(team.id), regrets.sort((a, b) => b.winsAdded - a.winsAdded || b.points - a.points).slice(0, 3));
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
      // Only players benched more than half the weeks they've been rostered:
      // a player usually in the starting lineup is part of that team's plans,
      // not a realistic target.
      if (Number(player.startRate) >= 50) continue;
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

        // Wins added compare optimal lineups before and after (not the lineup
        // the team happened to start), so start/sit mistakes don't count.
        if (hypotheticalOptimal.optimalPoints > opponent && baseOptimal.optimalPoints <= opponent) h2hWinsAdded += 1;
        if (Number.isFinite(median) && hypotheticalOptimal.optimalPoints > median && baseOptimal.optimalPoints <= median) medianWinsAdded += 1;
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

            if (hypotheticalOptimal.optimalPoints > opponent && baseOptimal.optimalPoints <= opponent) reciprocalH2hWins += 1;
            if (Number.isFinite(median) && hypotheticalOptimal.optimalPoints > median && baseOptimal.optimalPoints <= median) reciprocalMedianWins += 1;
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

// A team's optimal lineup in a past week, before any trade (reused by every
// trade that team is part of).
const baseOptimalCache = new Map();
function baseOptimalFor(week, teamId, roster) {
  const key = week + "|" + teamId;
  if (!baseOptimalCache.has(key)) baseOptimalCache.set(key, lineupEfficiency(roster));
  return baseOptimalCache.get(key);
}

// Each team's weak spots per week: the starters a newcomer could bump, by
// position. An incoming RB can only displace an RB-slot starter or a FLEX
// starter (a better RB pushes the displaced one into FLEX, never into a WR
// slot); likewise WR and TE. QB, K and D/ST only their own slot. A trade can
// only help a team if its incoming players outscore distinct bumpable
// starters, so trades that can't are skipped before the full lineup solve.
// (Assumes one position per player, true for this league's slots.)
const FLEX_SLOT = 23;
const SLOT_OF = {QB:0, RB:2, WR:4, TE:6, DST:16, K:17};
const weakSpotCache = new Map();
function weakSpots(week, teamId) {
  const key = week + "|" + teamId;
  if (weakSpotCache.has(key)) return weakSpotCache.get(key);
  const counts = settings.settings?.rosterSettings?.lineupSlotCounts || {};
  const n = slot => Number(counts[slot] || 0);
  const byPos = {};
  for (const e of weeklyRosterForTeam(week, teamId)?.roster?.entries || []) {
    if (Number(e.lineupSlotId) === 21) continue;
    const pos = positionNames[Number(e.playerPoolEntry?.player?.defaultPositionId)];
    if (pos) (byPos[pos] ||= []).push(Number(e.playerPoolEntry?.appliedStatTotal) || 0);
  }
  for (const list of Object.values(byPos)) list.sort((a, b) => b - a);
  // Bumpable starters, labelled so two incoming players can't bump the same
  // one (an empty slot counts as a 0-point starter). FLEX labels are shared.
  const starters = (pos, slot, from, label) => {
    const picked = from.slice(0, n(slot));
    while (picked.length < n(slot)) picked.push(0);
    return picked.map((score, i) => ({tag:label + i, score}));
  };
  const flexFrom = ["RB", "WR", "TE"].flatMap(pos => (byPos[pos] || []).slice(n(SLOT_OF[pos]))).sort((a, b) => b - a);
  const flex = starters("FLEX", FLEX_SLOT, flexFrom, "FLEX");
  const spots = {};
  for (const [pos, slot] of Object.entries(SLOT_OF)) {
    const own = starters(pos, slot, byPos[pos] || [], pos);
    spots[pos] = ["RB", "WR", "TE"].includes(pos) ? [...own, ...flex] : own;
  }
  weakSpotCache.set(key, spots);
  return spots;
}
// The most incoming players could add in a week: each bumps a distinct
// starter it can displace (best assignment; packages have at most 2).
function weekGainCap(spots, entries) {
  const players = entries.map(e => ({pos:positionNames[Number(e.playerPoolEntry?.player?.defaultPositionId)], points:Number(e.playerPoolEntry?.appliedStatTotal) || 0}));
  const best = (i, taken) => {
    if (i >= players.length) return 0;
    const {pos, points} = players[i];
    let top = best(i + 1, taken);                       // this one doesn't start
    if (!spots[pos]) return Math.max(top, Math.max(0, points) + best(i + 1, taken));
    for (const {tag, score} of spots[pos]) {
      if (taken.has(tag) || points <= score) continue;
      taken.add(tag);
      top = Math.max(top, points - score + best(i + 1, taken));
      taken.delete(tag);
    }
    return top;
  };
  return best(0, new Set());
}

// Could this trade's optimal-lineup view pass the "helps" test, over the
// season or the last few weeks?
const mightHelpOptimal = (teamId, outgoingPlayerIds, incoming) =>
  mightHelp(teamId, outgoingPlayerIds, incoming) || mightHelp(teamId, outgoingPlayerIds, incoming, recentWeekSet);

// Could this trade possibly pass the "helps" test for this team? Each week
// it can add at most weekGainCap (losing the outgoing players only costs), so
// if even that can't flip a game or the median, or reach the points-per-week
// bar, it can't help. Exact: it only skips trades the full solve would reject.
let tradesScreenedOut = 0;
function mightHelp(teamId, outgoingPlayerIds, incomingEntriesByWeek, onlyWeeks = null) {
  const outgoingIds = new Set(outgoingPlayerIds.map(Number));
  let weeks = 0, boostCap = 0, canFlip = false;
  for (const [week, entries] of incomingEntriesByWeek) {
    if (onlyWeeks && !onlyWeeks.has(week)) continue;
    const roster = weeklyRosterForTeam(week, teamId);
    if (!roster?.roster?.entries || roster.roster.entries.filter(e => outgoingIds.has(Number(e.playerId))).length !== outgoingIds.size) continue;
    const baseOptimal = baseOptimalFor(week, teamId, roster);
    if (!baseOptimal) continue;                         // the full solve skips these weeks too
    weeks++;
    const cap = weekGainCap(weakSpots(week, teamId), entries);
    if (cap <= 0) continue;
    boostCap += cap;
    const base = Number(baseOptimal.optimalPoints);
    const game = completed.find(m => m.week === week && (m.homeTeamId === Number(teamId) || m.awayTeamId === Number(teamId)));
    const opponent = game ? Number(game.homeTeamId === Number(teamId) ? game.awayScore : game.homeScore) : NaN;
    const median = Number(weeklyMedianByWeek.get(week));
    for (const target of [opponent, median]) {
      if (Number.isFinite(target) && base <= target && base + cap >= target) canFlip = true;
    }
  }
  return weeks > 0 && ((canFlip && boostCap > 0) || boostCap >= WIN_WIN_MIN_POINTS_PER_WEEK * weeks);
}

// ---- Trade evaluation: four views ---------------------------------------------
// A trade is judged week by week with two lineups, over two windows:
//   optimal:   the best lineup in hindsight;
//   projected: the lineup a manager would set from ESPN's weekly projections
//              (top-projected players start), scored with actual points, so
//              one streaky boom week doesn't make a player look like a star;
//   season / last 4 weeks (recent form).
// A trade counts when both teams gain under the same view.
const RECENT_WEEKS = 4;
const recentWeekSet = new Set(completedWeeks.slice(-RECENT_WEEKS));
const TRADE_VIEWS = [
  {window:"season", lineup:"optimal"}, {window:"recent", lineup:"optimal"},
  {window:"season", lineup:"projected"}, {window:"recent", lineup:"projected"}
];

function projectionOf(entry, week) {
  const stat = (entry.playerPoolEntry?.player?.stats || []).find(x =>
    Number(x.scoringPeriodId) === Number(week) && Number(x.statSourceId) === 1 && Number(x.statSplitTypeId) === 1);
  return Number(stat?.appliedTotal) || 0;
}
// Actual points of the lineup a manager would set from projections: the
// top-projected players at each slot, FLEX from the remaining RB/WR/TE, an
// empty slot scoring 0. (One position per player, as in this league.)
function projectedLineupPoints(entries, week) {
  const counts = settings.settings?.rosterSettings?.lineupSlotCounts || {};
  const n = slot => Number(counts[slot] || 0);
  const byPos = {};
  for (const e of entries) {
    if (Number(e.lineupSlotId) === 21) continue;
    const pos = positionNames[Number(e.playerPoolEntry?.player?.defaultPositionId)];
    if (pos) (byPos[pos] ||= []).push({proj:projectionOf(e, week), points:Number(e.playerPoolEntry?.appliedStatTotal) || 0});
  }
  for (const list of Object.values(byPos)) list.sort((a, b) => b.proj - a.proj || b.points - a.points);
  let total = 0;
  const leftovers = [];
  for (const [pos, slot] of Object.entries(SLOT_OF)) {
    const list = byPos[pos] || [];
    total += list.slice(0, n(slot)).reduce((sum, p) => sum + p.points, 0);
    if (["RB", "WR", "TE"].includes(pos)) leftovers.push(...list.slice(n(slot)));
  }
  leftovers.sort((a, b) => b.proj - a.proj || b.points - a.points);
  return round(total + leftovers.slice(0, n(FLEX_SLOT)).reduce((sum, p) => sum + p.points, 0));
}
const baseProjectedCache = new Map();

// Week-by-week before/after for one team: optimal lineups (only when asked;
// it's the expensive solve) and projected lineups, with the week's opponent
// score and median. Weeks where a player in the deal wasn't rostered are skipped.
function tradeWeeks(teamId, outgoingPlayerIds, incomingEntriesByWeek, withOptimal) {
  const outgoingIds = new Set(outgoingPlayerIds.map(Number));
  const rows = [];
  for (const week of completedWeeks) {
    const roster = weeklyRosterForTeam(week, teamId);
    if (!roster?.roster?.entries) continue;
    const incoming = incomingEntriesByWeek.get(week);
    if (!incoming || roster.roster.entries.filter(e => outgoingIds.has(Number(e.playerId))).length !== outgoingIds.size) continue;
    const swappedEntries = roster.roster.entries
      .filter(e => !outgoingIds.has(Number(e.playerId)))
      .concat(incoming.map(entry => ({...entry, lineupSlotId:20})));
    const game = completed.find(m => m.week === week && (m.homeTeamId === Number(teamId) || m.awayTeamId === Number(teamId)));
    const row = {
      week,
      opponent:game ? Number(game.homeTeamId === Number(teamId) ? game.awayScore : game.homeScore) : NaN,
      median:Number(weeklyMedianByWeek.get(week))
    };
    const key = week + "|" + teamId;
    if (!baseProjectedCache.has(key)) baseProjectedCache.set(key, projectedLineupPoints(roster.roster.entries, week));
    row.projectedBefore = baseProjectedCache.get(key);
    row.projectedAfter = projectedLineupPoints(swappedEntries, week);
    if (withOptimal) {
      const baseOptimal = baseOptimalFor(week, teamId, roster);
      // A slot only goes empty (0 points) when nobody left can fill it; a
      // lineup can't choose to leave one empty to dodge a negative score.
      const swappedTeam = {id:Number(teamId),roster:{entries:swappedEntries}};
      const swappedOptimal = lineupEfficiency(swappedTeam) || lineupEfficiency(swappedTeam, null, null, true);
      if (baseOptimal && swappedOptimal) {
        row.optimalBefore = Number(baseOptimal.optimalPoints);
        row.optimalAfter = Number(swappedOptimal.optimalPoints);
      }
    }
    rows.push(row);
  }
  return rows;
}

// One view's totals: points added, and head-to-head and median wins added.
function tally(rows, view) {
  const wins = (target, points) => points > target ? 1 : points === target ? 0.5 : 0;
  let boost = 0, h2h = 0, median = 0, weeksEvaluated = 0, fromWeek = null;
  for (const r of rows) {
    if (view.window === "recent" && !recentWeekSet.has(r.week)) continue;
    const before = r[view.lineup + "Before"], after = r[view.lineup + "After"];
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    weeksEvaluated++;
    if (fromWeek === null || r.week < fromWeek) fromWeek = r.week;
    boost += after - before;
    if (Number.isFinite(r.opponent)) h2h += wins(r.opponent, after) - wins(r.opponent, before);
    if (Number.isFinite(r.median)) median += wins(r.median, after) - wins(r.median, before);
  }
  return {boost:round(boost), h2hWinsAdded:round(h2h), medianWinsAdded:round(median), winsAdded:round(h2h + median), weeksEvaluated, fromWeek};
}

// Judge a trade from both sides: the best view where both teams gain (if
// any), and a one-sided view for seeding multi-player trades.
function judgeTrade(rowsA, rowsB) {
  let best = null, seed = null;
  for (const view of TRADE_VIEWS) {
    const impactA = tally(rowsA, view), impactB = tally(rowsB, view);
    if (!impactA.weeksEvaluated || !impactB.weeksEvaluated) continue;
    const helpsA = helpsTeam(impactA), helpsB = helpsTeam(impactB);
    if (helpsA && helpsB) {
      const score = Math.min(impactA.winsAdded, impactB.winsAdded) * 1000 + impactA.boost + impactB.boost;
      if (!best || score > best.score) best = {view, impactA, impactB, score};
    } else if (helpsA !== helpsB && Math.min(impactA.winsAdded, impactB.winsAdded) >= -1) {
      const winner = helpsA ? impactA : impactB;
      const gain = winner.winsAdded + winner.boost / 1000;
      if (!seed || gain > seed.gain) seed = {helpsA, gain};
    }
  }
  return {best, seed};
}
const viewLabel = view => ({window:view.window === "recent" ? `last ${Math.min(RECENT_WEEKS, completedWeeks.length)} weeks` : "season", lineup:view.lineup});

// One-sided 1-for-1 swaps (one team gains, the other doesn't, by at most a
// win) seed the 2-for-1 and 2-for-2 search below.
const tradeSeeds = [];
const helpsTeam = impact =>
  (impact.winsAdded >= 1 && impact.boost > 0) ||
  (impact.winsAdded >= 0 && impact.boost >= WIN_WIN_MIN_POINTS_PER_WEEK * impact.weeksEvaluated);

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
  
          // The optimal-lineup solve only when either side could gain that way
          // (the projected lineups are cheap and always checked).
          const incomingA1 = new Map([...incomingForA].map(([w, e]) => [w, [e]]));
          const incomingB1 = new Map([...incomingForB].map(([w, e]) => [w, [e]]));
          const withOptimal = mightHelpOptimal(teamAId, [playerA.playerId], incomingA1) || mightHelpOptimal(teamBId, [playerB.playerId], incomingB1);
          if (!withOptimal) tradesScreenedOut++;
          const {best, seed} = judgeTrade(
            tradeWeeks(teamAId, [playerA.playerId], incomingA1, withOptimal),
            tradeWeeks(teamBId, [playerB.playerId], incomingB1, withOptimal));
          if (seed && !best) tradeSeeds.push({teamAId, teamBId, playerA, playerB, helpsA:seed.helpsA, gain:seed.gain});
          if (!best) continue;
          const {impactA, impactB} = best;

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
            weeksEvaluated:Math.min(impactA.weeksEvaluated, impactB.weeksEvaluated),
            // The retroactive swap's starting week (both sides counted from here).
            fromWeek:Math.max(impactA.fromWeek, impactB.fromWeek),
            basis:viewLabel(best.view)
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

// ---- 2-for-1 and 2-for-2 win-win trades --------------------------------------
// Built from the one-sided seeds above, per pair of teams (A, B):
//   2-for-2: a swap A gains from plus one B gains from, so each side's gain
//            makes up for the other swap;
//   2-for-1: the side that gains adds a sweetener the other side gains from.
// Kept only if both teams' optimal lineups gain (same test as 1-for-1) and the
// two sides' rest-of-season values are within 30% of each other.
const MULTI_SEEDS_PER_SIDE = 6;
const MULTI_PER_PAIR = 2;
const multiTradesByTeam = new Map([...teams.keys()].map(teamId => [Number(teamId), []]));
{
  const multiStartedAt = Date.now();
  let packagesEvaluated = 0;
  const entriesByWeek = (teamId, playerIds) => {
    const out = new Map();
    for (const week of completedWeeks) {
      const entries = playerIds.map(id => weeklyRosterForTeam(week, teamId)?.roster?.entries?.find(e => Number(e.playerId) === Number(id)));
      if (entries.every(Boolean)) out.set(week, entries);
    }
    return out;
  };
  const rosValue = players => players.reduce((sum, p) => sum + 200 / (Number(p.rosRank) + 20), 0);
  const balanced = (give, get) => { const r = rosValue(give) / rosValue(get); return r >= 0.7 && r <= 1 / 0.7; };
  const side = players => ({
    PlayerId:players.map(p => p.playerId).join("+"),
    Player:players.map(p => p.player).join(" + "),
    Position:players.map(p => p.position).filter(Boolean).join("/") || null,
    RosRank:players.map(p => p.rosRank).join(" + #"),
    Players:players.map(p => p.player)
  });
  const pairs = new Map();
  for (const seed of tradeSeeds) {
    const key = seed.teamAId + "|" + seed.teamBId;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(seed);
  }
  for (const seeds of pairs.values()) {
    const {teamAId, teamBId} = seeds[0];
    const top = list => list.sort((a, b) => b.gain - a.gain).slice(0, MULTI_SEEDS_PER_SIDE);
    const helpA = top(seeds.filter(s => s.helpsA)), helpB = top(seeds.filter(s => !s.helpsA));
    const packages = new Map();
    const offer = (give, get) => {
      const ids = p => p.map(x => x.playerId);
      if (new Set(ids(give)).size !== give.length || new Set(ids(get)).size !== get.length) return;
      const key = ids(give).sort().join("+") + ">" + ids(get).sort().join("+");
      if (!packages.has(key) && balanced(give, get)) packages.set(key, {give, get});
    };
    for (const a of helpA) for (const b of helpB) {
      offer([a.playerA, b.playerA], [a.playerB, b.playerB]);   // 2-for-2
      offer([a.playerA, b.playerA], [a.playerB]);              // A sweetens
      offer([b.playerA], [b.playerB, a.playerB]);              // B sweetens
    }
    const found = [];
    for (const {give, get} of packages.values()) {
      const toA = entriesByWeek(teamBId, get.map(p => p.playerId)), toB = entriesByWeek(teamAId, give.map(p => p.playerId));
      // Both sides have to gain, so for the optimal view both have to clear a weak spot.
      const withOptimal = mightHelpOptimal(teamAId, give.map(p => p.playerId), toA) && mightHelpOptimal(teamBId, get.map(p => p.playerId), toB);
      if (!withOptimal) tradesScreenedOut++;
      packagesEvaluated++;
      const {best} = judgeTrade(
        tradeWeeks(teamAId, give.map(p => p.playerId), toA, withOptimal),
        tradeWeeks(teamBId, get.map(p => p.playerId), toB, withOptimal));
      if (!best) continue;
      found.push({give, get, impactA:best.impactA, impactB:best.impactB, basis:viewLabel(best.view)});
    }
    found.sort((x, y) =>
      Math.min(y.impactA.winsAdded, y.impactB.winsAdded) - Math.min(x.impactA.winsAdded, x.impactB.winsAdded) ||
      (y.impactA.boost + y.impactB.boost) - (x.impactA.boost + x.impactB.boost));
    for (const {give, get, impactA, impactB, basis} of found.slice(0, MULTI_PER_PAIR)) {
      const record = (teamId, otherId, mine, theirs, my, other, perspective) => {
        const g = side(mine), r = side(theirs);
        return {
          kind:`${mine.length}-for-${theirs.length}`,
          otherTeamId:otherId, otherTeam:teams.get(otherId)?.name || `Team ${otherId}`,
          givePlayerId:g.PlayerId, givePlayer:g.Player, givePosition:g.Position, giveRosRank:g.RosRank, givePlayers:g.Players,
          getPlayerId:r.PlayerId, getPlayer:r.Player, getPosition:r.Position, getRosRank:r.RosRank, getPlayers:r.Players,
          yourBoost:my.boost, yourH2hWinsAdded:my.h2hWinsAdded, yourMedianWinsAdded:my.medianWinsAdded, yourWinsAdded:my.winsAdded,
          theirBoost:other.boost, theirH2hWinsAdded:other.h2hWinsAdded, theirMedianWinsAdded:other.medianWinsAdded, theirWinsAdded:other.winsAdded,
          weeksEvaluated:Math.min(my.weeksEvaluated, other.weeksEvaluated),
          fromWeek:Math.max(my.fromWeek, other.fromWeek),
          basis,
          perspective
        };
      };
      multiTradesByTeam.get(teamAId).push(record(teamAId, teamBId, give, get, impactA, impactB, "A"));
      multiTradesByTeam.get(teamBId).push(record(teamBId, teamAId, get, give, impactB, impactA, "B"));
    }
  }
  console.log(`calculate-stats: ${tradesScreenedOut} trades judged on projected lineups only (weak-spot screen)`);
  console.log(`calculate-stats: ${tradeSeeds.length} one-sided seeds, ${packagesEvaluated} multi-player packages evaluated in ${Date.now() - multiStartedAt} ms; ` +
    `${[...multiTradesByTeam.values()].flat().filter(t => t.perspective === "A").length} win-win`);
}


for (const teamId of teams.keys()) {
  const unique = new Map();
  for (const trade of winWinTradesByTeam.get(Number(teamId)) || []) {
    const key = [trade.otherTeamId, trade.givePlayerId, trade.getPlayerId].join("|");
    if (!unique.has(key)) unique.set(key, trade);
  }
  // Up to three 1-for-1 trades, plus the best multi-player one.
  const multi = (multiTradesByTeam.get(Number(teamId)) || []).sort((a,b) =>
    Math.min(b.yourWinsAdded,b.theirWinsAdded) - Math.min(a.yourWinsAdded,a.theirWinsAdded) ||
    (b.yourBoost+b.theirBoost) - (a.yourBoost+a.theirBoost)).slice(0,1);
  winWinTradesByTeam.set(Number(teamId), [...unique.values()]
    .sort((a,b) =>
      Math.max(b.yourWinsAdded,b.theirWinsAdded) - Math.max(a.yourWinsAdded,a.theirWinsAdded) ||
      (b.yourBoost+b.theirBoost) - (a.yourBoost+a.theirBoost)
    )
    .slice(0,3).concat(multi));
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
      longTermRegrets:longTermRegretsByTeam.get(Number(t.id))||[],
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