import { normalCdf, normalQuantile } from "../../scripts/lib/simulation.js";

// What to root for on a live drive (Jim, 2026-11-02, Primetime view): for a matchup still in question, the
// plays this drive could realistically produce, what each is worth to the league starters involved (the
// offense's players and the other team's D/ST), and how far it would move each side's win odds. Each side
// gets its best realistic hope and, when it's a bigger swing, its long-shot dream.
//
// Points follow the league's scoring (mSettings): PPR, 0.1 per rushing/receiving yard, 0.04 per passing yard,
// 4 per passing TD, 6 per rushing/receiving TD, −2 per INT or fumble lost, FGs 3 (under 40) / 4 (40s) /
// 5 (50s) / 6 (60+), PAT 1, missed FG −1; D/ST 2 per takeaway, 6 per return TD, 1 per sack, 2 per safety,
// nothing for points allowed (so an offensive score costs the defense nothing).
// Chances are rough per-drive NFL rates, adjusted for field position. A drive that stalls costs the offense's
// players the share of their remaining projection this drive was expected to bring (projected rest ÷ the
// team's drives left), which is what the side facing them roots for.

const lastName = n => /D\/ST/.test(n) ? n : String(n).replace(/^[A-Z]\.\s*/, "");
const fgPoints = yds => yds >= 60 ? 6 : yds >= 50 ? 5 : yds >= 40 ? 4 : 3;
const REALISTIC = 0.08;   // at least this likely on the drive to count as a realistic hope
const MIN_SHOWN = 2;      // win-odds points a play must move to be worth rooting for

// drive: game.drive ({ possession, yardLine, redZone }); game: the NFL game; a, b: the matchup's two teams.
export function driveRooting({ game, a, b }) {
  const drive = game?.drive;
  if (!drive?.possession || game.state !== "in") return null;
  const offense = Number(drive.possession), defense = (game.teams || []).map(t => Number(t.id)).find(id => id !== offense);
  const offenseTeam = (game.teams || []).find(t => Number(t.id) === offense);
  // Yards to the goal line: yardLine counts from the home team's goal line.
  const toGo = Number.isFinite(drive.yardLine) ? (offenseTeam?.home ? 100 - drive.yardLine : drive.yardLine) : null;
  const tdRate = toGo == null ? 0.22 : toGo <= 20 ? 0.5 : toGo <= 40 ? 0.35 : toGo <= 70 ? 0.22 : 0.15;
  const fgRate = toGo == null ? 0.14 : toGo <= 20 ? 0.35 : toGo <= 40 ? 0.3 : toGo <= 70 ? 0.12 : 0.06;
  const fgYds = toGo == null ? 45 : Math.max(20, toGo + 17);

  // This drive's league starters on both sides: [player, fantasy side].
  const on = [];
  for (const [team, sideKey] of [[a, "a"], [b, "b"]]) {
    for (const p of team.lineup?.starters || []) {
      const pro = Number(p.proTeamId);
      if (p.pos === "D/ST" ? pro === defense : pro === offense) on.push({ ...p, side: sideKey });
    }
  }
  if (!on.length) return null;
  const qb = on.find(p => p.pos === "QB"), k = on.find(p => p.pos === "K"), dst = on.find(p => p.pos === "D/ST");
  const catchers = on.filter(p => ["WR", "TE", "RB"].includes(p.pos)), runners = on.filter(p => p.pos === "RB");

  // Each scenario: label, chance on this drive, points by player.
  const scenarios = [];
  const add = (label, chance, pts) => { if (pts.some(([p]) => p)) scenarios.push({ label, chance, pts: pts.filter(([p]) => p) }); };
  const pat = k ? [[k, 1]] : [];
  for (const r of catchers) add(`TD catch by ${lastName(r.name)}`, tdRate * 0.6 * 0.3, [[r, 6 + 1 + 2], [qb, 4.8], ...pat]);
  for (const r of runners) add(`TD run by ${lastName(r.name)}`, tdRate * 0.4 * 0.6, [[r, 6.5], ...pat]);
  if (qb) add(`TD pass by ${lastName(qb.name)}`, tdRate * 0.6, [[qb, 4.8], ...pat]);
  if (k) {
    if (fgYds <= 58) add(`${lastName(k.name)} ${fgYds}-yd FG`, fgRate, [[k, fgPoints(fgYds)]]);
    if (fgYds < 50) add(`${lastName(k.name)} 50+ yd FG`, 0.04, [[k, 5]]);
    add(`${lastName(k.name)} misses a FG`, 0.03, [[k, -1]]);
  }
  // A punt: this drive's expected share of the offense's remaining projections, gone. A team gets about 11 drives.
  const progress = Math.min(1, ((Number(game.period) || 1) - 1 + (900 - (Number(game.clock) || 0)) / 900) / 4);
  const drivesLeft = Math.max(1, 11 * (1 - progress));
  const offensive = on.filter(p => p.pos !== "D/ST");
  const stall = offensive.map(p => [p, -Math.max(0, (Number(p.projection) || 0) - (Number(p.actual) || 0)) / drivesLeft]);
  if (offensive.length) add(`a ${offenseTeam?.abbrev || "stalled"} punt`, toGo != null && toGo <= 40 ? 0.15 : 0.35, stall);
  // Turnovers end the drive too, so they also cost the offense its share of it. Return TDs only matter when
  // the defense is a league starter; otherwise the turnover is named by who gave it up.
  const fumbler = runners[0];
  if (dst) {
    const d = `the ${lastName(dst.name)}`;
    add(`a pick-six by ${d}`, 0.004, [[dst, 8], [qb, -2], ...stall]);
    add(`a fumble return TD by ${d}`, 0.002, [[dst, 8], ...(fumbler ? [[fumbler, -2]] : []), ...stall]);
    add(`an interception by ${d}`, 0.03, [[dst, 2], [qb, -2], ...stall]);
    add(`a fumble recovery by ${d}`, 0.015, [[dst, 2], ...(fumbler ? [[fumbler, -2]] : []), ...stall]);
    add(`a sack by ${d}`, 0.35, [[dst, 1]]);
    add(`a safety by ${d}`, 0.003, [[dst, 2], ...stall]);
  } else {
    const off = offenseTeam?.abbrev || "the offense";
    add(qb ? `a ${lastName(qb.name)} interception` : `an ${off} interception`, 0.03, [[qb, -2], ...stall]);
    add(fumbler ? `a ${lastName(fumbler.name)} fumble` : `an ${off} fumble`, 0.015, [...(fumbler ? [[fumbler, -2]] : []), ...stall]);
  }

  // Win odds after each, from the margin's spread (as the key plays' momentum is judged).
  const pa = Number(a.winProbability) / 100;
  if (!(pa > 0.005 && pa < 0.995)) return null;
  const sd = Math.max(3, Math.hypot(Number(a.projectionSd) || 0, Number(b.projectionSd) || 0));
  const z0 = normalQuantile(pa);
  const rated = scenarios.map(s => {
    const marginA = s.pts.reduce((sum, [p, v]) => sum + (p.side === "a" ? v : -v), 0);
    return { ...s, after: { a: 100 * normalCdf(z0 + marginA / sd) } };
  });
  const hopesFor = (team, key) => {
    const now = key === "a" ? 100 * pa : 100 * (1 - pa);
    const gain = s => (key === "a" ? s.after.a : 100 - s.after.a) - now;
    const good = rated.filter(s => gain(s) >= MIN_SHOWN).sort((x, y) => gain(y) - gain(x));
    const likely = good.filter(s => s.chance >= REALISTIC)[0] || null;
    const dream = good.find(s => s.chance < REALISTIC && gain(s) >= 1.5 * (likely ? gain(likely) : 0)) || null;
    if (!likely && !dream) return null;
    const fmt = s => s && { label: s.label, from: Math.round(now), to: Math.round(now + gain(s)), chance: s.chance };
    return { team: team.team, likely: fmt(likely), dream: fmt(dream) };
  };
  const hopes = [hopesFor(a, "a"), hopesFor(b, "b")].filter(Boolean);
  return hopes.length ? { offense: offenseTeam?.abbrev, toGo, hopes } : null;
}
