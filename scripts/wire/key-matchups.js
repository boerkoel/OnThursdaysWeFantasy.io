import { fit, liveTeams, money, nflGames, pct, pts } from "./context.js";

// League Wire: KEY MATCHUP, Sunday's closest matchups. From the end of
// Thursday night's game until Sunday's first kickoff (the stretch the week-
// ahead stories and WHAT TO WATCH don't cover): the tightest matchups by win
// odds, any lead from TNF, and each side's biggest Sunday starter.
const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
const KEY_MATCHUPS = 2;
const CLOSE_ODDS = 35;   // the underdog's odds, at least

export function addKeyMatchupStories(add, matchupStates) {
  const thursday = nflGames.filter(g => g.kickoff && etDay(g.kickoff) === "Thu");
  const sunday = nflGames.filter(g => g.kickoff && etDay(g.kickoff) === "Sun");
  if (!thursday.length || !thursday.every(g => g.completed) || !sunday.length || sunday.some(g => g.state !== "pre")) return;

  const sundayStar = teamId => (liveTeams.get(teamId)?.players || [])
    .filter(p => !p.bench && p.game?.kickoff && etDay(p.game.kickoff) === "Sun" && p.projection != null)
    .sort((a, b) => b.projection - a.projection)[0];
  const close = matchupStates.filter(x => !x.m.completed).map(x => {
    const odds = Number(x.a.winProbability);
    return { x, odds, underdog: Math.min(odds, 100 - odds) };
  }).filter(m => Number.isFinite(m.odds) && m.underdog >= CLOSE_ODDS)
    .sort((a, b) => b.underdog - a.underdog)
    .slice(0, KEY_MATCHUPS);

  close.forEach(({ x, odds }, i) => {
    const [fav, dog] = odds >= 50 ? [x.a, x.b] : [x.b, x.a];
    const favOdds = Math.max(odds, 100 - odds);
    const lead = Math.abs(Number(x.a.score) - Number(x.b.score));
    const leader = Number(x.a.score) >= Number(x.b.score) ? x.a : x.b;
    const tnf = lead >= 1 ? ` ${leader.team} leads by ${money(lead)} after TNF.` : "";
    const stars = [fav, dog].map(t => ({ t, p: sundayStar(t.teamId) })).filter(s => s.p);
    const watch = stars.length === 2 ? ` Watch ${stars[0].p.lastName} (${pts(stars[0].p.projection)}) vs ${stars[1].p.lastName} (${pts(stars[1].p.projection)}).` : "";
    const opener = i === 0 ? "🗓️ Sunday's key matchup" : "🗓️ Another tight one Sunday";
    const matchup = `${fav.team} ${pct(favOdds)} vs ${dog.team}`;
    add("KEY MATCHUP", fit(
      `${opener}: ${matchup}.${tnf}${watch}`,
      `${opener}: ${matchup}.${watch}`,
      `${opener}: ${matchup}.${tnf}`,
      `${opener}: ${matchup}.`
    ), 75 - i * 3 - Math.abs(favOdds - 50) / 5);
  });
}
