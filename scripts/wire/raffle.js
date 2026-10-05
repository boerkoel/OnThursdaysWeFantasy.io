import { currentScores, fit, listNames, liveTeams, money, pct, possessive, pts } from "./context.js";

// League Wire: the raffle ticket race.
// Stories from this week's win-odds history (the swing charts): the biggest
// comeback, and games whose odds keep flipping.
// Raffle race (the week's highest score earns a ticket): a new favorite, a
// live threat to the leader, or a near-lock.
export function addRaffleStories(add, previousScores) {
  const withOdds = currentScores.filter(s => Number.isFinite(Number(s.topScoreProbability)));
  if (!withOdds.length || withOdds.every(s => Number(s.score) === 0)) return;
  const leader = [...withOdds].sort((a, b) => Number(b.score) - Number(a.score))[0];
  const favorite = [...withOdds].sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];
  const previousFavorite = [...previousScores.values()]
    .filter(s => Number.isFinite(Number(s.topScoreProbability)))
    .sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];

  if (previousFavorite && previousFavorite.teamId !== favorite.teamId && favorite.topScoreProbability >= 40) {
    add("RAFFLE FLIP","🎟️ RAFFLE FLIP: " + favorite.team + " is now the favorite for this week's raffle ticket (" + pct(favorite.topScoreProbability) + "), passing " + previousFavorite.team + ".",87);
  }
  const chaser = withOdds
    .filter(s => s.teamId !== leader.teamId && s.startersLeft > 0 && s.topScoreProbability >= 25)
    .sort((a, b) => b.topScoreProbability - a.topScoreProbability)[0];
  if (chaser) {
    const left = (liveTeams.get(chaser.teamId)?.players || []).filter(p => !p.bench && !p.finished).map(p => p.lastName);
    const chase = "🎟️ RAFFLE WATCH: " + chaser.team + " (" + pct(chaser.topScoreProbability) + " to take the ticket) is chasing " + possessive(leader.team) + " " + money(leader.score) + " — " + pts(Number(leader.score) - Number(chaser.score)) + " back";
    add("RAFFLE WATCH",fit(
      chase + (left.length ? " with " + listNames(left) + " still to play" : "") + ".",
      chase + " with " + left.length + " starter" + (left.length === 1 ? "" : "s") + " still to play."
    ),76 + chaser.topScoreProbability / 10);
  } else if (leader.topScoreProbability >= 95 && leader.topScoreProbability < 100) {
    add("RAFFLE LOCK","🎟️ RAFFLE LOCK: " + leader.team + " has all but clinched this week's raffle ticket with " + pts(leader.score) + " (" + pct(leader.topScoreProbability) + ").",62);
  }
}
