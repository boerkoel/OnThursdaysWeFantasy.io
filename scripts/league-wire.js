import { round } from "./lib/simulation.js";
import { settledLineupRegret } from "./lib/lineup.js";
import { DATA, OUT, STORY_MAX_CHARS, currentScores, currentWeek, currentWeekMatchups, fit, isNearMedian, listNames, liveTeams, money, name, possessive, previousScoreboard, projectedMedian, pts, readJson, recentGameIds, writeJson } from "./wire/context.js";
import { addDeathWatchStory } from "./wire/death-watch.js";
import { addEarlyMomentumStories } from "./wire/early-momentum.js";
import { addInjuryStories } from "./wire/injuries.js";
import { buildKeyPlays } from "./wire/key-plays.js";
import { addLineupMistakeStories } from "./wire/lineup-mistakes.js";
import { addPickupStories } from "./wire/pickups.js";
import { addPrimetimeStories } from "./wire/primetime.js";
import { addRaffleStories } from "./wire/raffle.js";
import { interleave, weekHeadlines, weekInReview } from "./wire/review.js";
import { addRosterStories } from "./wire/roster.js";
import { addStockWatchStory } from "./wire/stock.js";
import { addMiscueStory, addShrewdSwapStory } from "./wire/swaps.js";
import { addSwingStories } from "./wire/swings.js";
import { addWeekAheadStories } from "./wire/week-ahead.js";
import { addGameToWatchStory, addWhatToWatchStories } from "./wire/what-to-watch.js";
import { addZombieStories } from "./wire/zombies.js";

// League Wire: the rotating live stories and each matchup's key plays. Runs
// on every live update (after update-live-scoreboard.js, which it reads) and
// in the daily update. Only needs the current week's data. The stories live
// in scripts/wire/ (one file per family); scripts/test-wire.js replays a
// captured snapshot to check them.
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
  // Newest stories; a bug in one shouldn't take down the whole wire.
  try { addGameToWatchStory(add, matchupStates); } catch (error) { console.warn("League Wire: game to watch failed: " + error.message); }
  try { addInjuryStories(add); } catch (error) { console.warn("League Wire: injury stories failed: " + error.message); }
  try { addMiscueStory(add); } catch (error) { console.warn("League Wire: manager miscue failed: " + error.message); }
  try { addShrewdSwapStory(add); } catch (error) { console.warn("League Wire: shrewd swap failed: " + error.message); }
  try { addZombieStories(add); } catch (error) { console.warn("League Wire: zombie starters failed: " + error.message); }
  try { addStockWatchStory(add); } catch (error) { console.warn("League Wire: stock watch failed: " + error.message); }

  const biggestLead=matchupStates.filter(x=>!x.m.completed).sort((a,b)=>b.diff-a.diff)[0];
  if(biggestLead&&biggestLead.diff>=20){const leader=biggestLead.currentDiff>0?biggestLead.a.team:biggestLead.b.team;const trailer=biggestLead.currentDiff>0?biggestLead.b.team:biggestLead.a.team;add("LEAGUE GOSSIP","👀 League gossip: " + leader + " has " + money(biggestLead.diff) + " pts to play with against " + trailer + ".",28);}
  else if(regret?.bestSwap) add("LEAGUE GOSSIP","👀 League gossip: " + regret.team + " may be wishing they trusted " + regret.bestSwap.benchPlayer.name + " — " + pts(regret.bestSwap.benchPlayer.actual) + " are sitting on the bench.",regret.bestSwap.benchPlayer.actual+5);
  else if(close && Number(close.a.score) + Number(close.b.score) > 0) add("LEAGUE GOSSIP","👀 League gossip: " + close.a.team + " and " + close.b.team + " are separated by " + money(close.diff) + " pts. Somebody's Sunday just got interesting.",26-close.diff);
  return stories.filter((story,i,arr)=>arr.findIndex(x=>x.text===story.text)===i).sort((a,b)=>b.score-a.score);
}

const keyPlays = await buildKeyPlays();
await writeJson(`${OUT}/key-plays.json`, {
  week: currentWeek,
  updatedAt: new Date().toISOString(),
  plays: keyPlays
});


const previousMarquee = await readJson(`${DATA}/marquee.json`).catch(() => null);
const headlines = weekHeadlines() || previousMarquee?.headlines || null;
const review = await weekInReview(previousMarquee, headlines);
const marqueeStories = interleave(review.stories, buildMarqueeStories());
await writeJson(`${OUT}/marquee.json`,{week:currentWeek,lastUpdated:new Date().toISOString(),stories:marqueeStories,headlines,review:review.meta});
