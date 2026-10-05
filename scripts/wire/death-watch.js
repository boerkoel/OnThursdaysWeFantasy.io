import { currentWeek, guillotineData, money, name, playersWithGames, pts, surname } from "./context.js";

// League Wire: the guillotine Death Watch headline.
// The guillotine side league's most endangered team this week.
export function addDeathWatchStory(add) {
  if (Number(guillotineData?.week) !== currentWeek) return;
  const atRisk = (guillotineData.teams || []).filter(t => t.chopProbability > 0);
  const [first, second] = atRisk;
  if (!first) return;
  const left = t => playersWithGames((t.remaining || []).map(p => ({name:surname(p.name), game:p.game})));
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
