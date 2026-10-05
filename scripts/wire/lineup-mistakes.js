import { fit, money, name, pts } from "./context.js";

// League Wire: start/sit mistakes that cost (or are costing) a matchup.
// Settled start/sit mistakes that cost (or are costing) a team its matchup.
export function addLineupMistakeStories(add, matchupStates, regrets) {
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
