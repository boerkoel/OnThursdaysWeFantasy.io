// Clinched and eliminated, mathematically (Jim, 2026-11-09: "which teams could be officially mathematically
// eliminated", "Brock could lock up a playoff spot with 2 wins"). Sure things, not odds: the season simulation's
// "all but" stories live in wire/stock.js.
//
// Records count head-to-head and median wins, 2 a week, and points for breaks ties, so a tie counts as still
// possible either way. The check is the simple, sound one: it lets every other team win (or lose) all its games
// at once, ignoring that they play each other, so it never calls a clinch or an elimination early (it may call
// one a week late).
//
// teams: [{ teamId, wins, open }]: wins locked so far, and this week's results still open (0-2), which may go
// either way; gamesLeft: wins still possible after this week (2 per week); spots: 6 for the playoffs, 2 for byes.
const ceiling = (t, gamesLeft) => t.wins + (t.open || 0) + gamesLeft;
export function mathStatus({ teams, gamesLeft, spots }) {
  const out = new Map();
  for (const x of teams) {
    const others = teams.filter(t => t.teamId !== x.teamId);
    // Clinched: even losing everything left, fewer than `spots` others can reach (or tie) its wins.
    const clinched = others.filter(t => ceiling(t, gamesLeft) >= x.wins).length < spots;
    // Eliminated: `spots` others already have more wins than it can reach.
    const eliminated = others.filter(t => t.wins > ceiling(x, gamesLeft)).length >= spots;
    // Magic number: the fewest more wins that clinch, whatever anyone else does (null if even winning out won't).
    let magic = null;
    for (let n = 0; n <= (x.open || 0) + gamesLeft; n++) if (others.filter(t => ceiling(t, gamesLeft) >= x.wins + n).length < spots) { magic = n; break; }
    // The soonest it could be eliminated: it loses everything from here, and the teams above it win everything.
    let soonest = null;
    if (!eliminated) for (let k = 1; 2 * k <= gamesLeft; k++) {
      const top = others.filter(t => t.wins + (t.open || 0) + 2 * k > x.wins + gamesLeft - 2 * k).length;
      if (top >= spots) { soonest = k; break; }
    }
    out.set(x.teamId, { clinched, eliminated, magic, soonest });
  }
  return out;
}
