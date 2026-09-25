import { mkdir, readFile, writeFile } from "node:fs/promises";

const settings = await readJson("data/current/mSettings.json");
const teamData = await readJson("data/current/mTeam.json");
const matchupData = await readJson("data/current/mMatchup.json");
const rosterData = await readJson("data/current/mRoster.json");

const teams = new Map((teamData.teams || []).map(t => [t.id, { id:t.id, name:(t.name||"").trim(), abbrev:t.abbrev||"", logo:t.logo||null }]));
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
const currentScores = currentWeekMatchups.flatMap(m => [
  { teamId:m.homeTeamId, opponentId:m.awayTeamId, score:m.homeScore, opponentScore:m.awayScore, matchupId:m.id },
  { teamId:m.awayTeamId, opponentId:m.homeTeamId, score:m.awayScore, opponentScore:m.homeScore, matchupId:m.id }
]).map(x => ({...x, team:name(x.teamId), opponent:name(x.opponentId), logo:teams.get(x.teamId)?.logo || null,
  status: currentWeekMatchups.find(m => m.id === x.matchupId)?.completed ? "FINAL" : "LIVE"}))
.sort((a,b)=>b.score-a.score);
const median = currentScores.length % 2
  ? currentScores[Math.floor(currentScores.length / 2)].score
  : currentScores.length ? round((currentScores[currentScores.length / 2 - 1].score + currentScores[currentScores.length / 2].score) / 2) : null;
const currentScoreboard = { week:currentWeek, scores:currentScores, median };

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

const awards={highestScore:scoreAward(highestScore),lowestScore:scoreAward(lowestScore),
  highestScoringLoser:scoreAward(highestScoringLoser),lowestScoringWinner:scoreAward(lowestScoringWinner),
  blowoutKing:matchupAward(blowout),
  benchWarmerChampion:bench[0]?{week:currentWeek,teamId:bench[0].teamId,team:name(bench[0].teamId),points:bench[0].points,players:bench[0].players}:null};

await mkdir("data/current",{recursive:true});
await writeJson("data/current/standings.json",{season:settings.seasonId,currentWeek,completedWeeks,standings});
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