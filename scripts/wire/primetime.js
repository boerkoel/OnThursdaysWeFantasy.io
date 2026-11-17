import { round } from "../lib/simulation.js";
import { currentScores, fit, isNearMedian, listNames, liveTeams, money, name, pct, playersWithGames, possessive, pts, seasonOddsData } from "./context.js";

// When one player's points decide a matchup whose two teams sit on either side of the median line, the same points
// flip the median too: two wins one way or the other (Jim, 2026-11-16: one Andrews catch gave Stacey both wins over
// Ruffing). Returns each team's playoff odds with 0 and 2 wins this week (season-odds.js byWins), as scores stand
// otherwise, or null.
const medianOf = values => { const v = [...values].sort((x, y) => x - y), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
function twoWinSwing(leader, trailer, deficit) {
  const others = currentScores.filter(s => s.teamId !== leader.teamId && s.teamId !== trailer.teamId).map(s => Number(s.score));
  if (others.length + 2 < 4) return null;
  const L = Number(leader.score), T = Number(trailer.score), hitT = T + deficit + 0.01;
  const short = medianOf([...others, L, T]), hit = medianOf([...others, L, hitT]);
  if (!(L > short && T <= short && hitT > hit && L <= hit)) return null;
  const odds = (id, wins) => Number(seasonOddsData?.byWins?.[String(id)]?.[wins]?.playoffOdds);
  const swing = { trailer0: odds(trailer.teamId, 0), trailer2: odds(trailer.teamId, 2), leader0: odds(leader.teamId, 0), leader2: odds(leader.teamId, 2) };
  return Object.values(swing).every(Number.isFinite) ? swing : null;
}

// League Wire: down-to-the-wire storylines.
// Down-to-the-wire storylines once a matchup comes down to a few players
// (typically Sunday and Monday night), plus which matchups and median races
// are still live.
export function addPrimetimeStories(add, matchupStates) {
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
    const odds = pct(trailerOdds);

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
      const swing = twoWinSwing(leader, trailer, deficit);
      // Only when it moves the playoff race a lot: 20+ points of playoff odds between the two.
      if (swing && (swing.trailer2 - swing.trailer0) + (swing.leader2 - swing.leader0) >= 20) {
        const r = n => Math.round(n) + "%";
        storylines.push({type:"TWO-WIN SWING", text:fit(
          "🎯 TWO-WIN SWING: if " + p.lastName + " tops " + pts(target) + ", " + trailer.team + " wins twice (" + leader.team + " and the median) and " + leader.team + " loses twice. Playoff odds: " + trailer.team + " " + r(swing.trailer0) + " → " + r(swing.trailer2) + ", " + leader.team + " " + r(swing.leader2) + " → " + r(swing.leader0) + ".",
          "🎯 TWO-WIN SWING: " + p.lastName + " tops " + pts(target) + " and " + trailer.team + " wins twice, " + leader.team + " loses twice. Playoff odds " + r(swing.trailer0) + " → " + r(swing.trailer2) + " and " + r(swing.leader2) + " → " + r(swing.leader0) + "."
        ), score:urgency + 5});
      }
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
    const describe = m => m.x.a.team + " vs " + m.x.b.team + " (" + m.fav.team + " " + pct(m.odds) + ")";
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
    add("MEDIAN STAKES","🎯 MEDIAN STAKES: " + possessive(s.team) + " shot at a median win (" + pct(s.aboveMedianProbability) + ") rides on " + withGames(left) + ".",74);
  }
}
