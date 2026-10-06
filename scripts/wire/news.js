import { BENCH_SLOT, IR_SLOT } from "../lib/lineup.js";
import { DATA, clockNow, currentScores, fit, name, nflGameByProTeam, pickLine, possessive, previousScoreboard, readJson, rosterData, currentWeek } from "./context.js";
import { backupLine } from "./sleeper.js";
import { kickoffLabel } from "./what-to-watch.js";

// League Wire: NEWS (a fresh breaking headline about a player rostered in the
// league, and whose he is) and RULED OUT (a starter whose status just flipped
// to OUT before his game, which is how inactives show up: a manager needs to
// swap before kickoff).
const newsData = await readJson(`${DATA}/news.json`).catch(() => null);
const NEWS_FRESH_MS = 12 * 60 * 60 * 1000;
const BIG_NEWS = /\b(out|ruled|injur|torn|tear|IR|surgery|questionable|doubtful|inactive|suspend|traded|trade|released|waived|benched|starting|start)\b/i;
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };

// Fresh headlines (published in the last 12 hours, not in the future).
export const freshNews = () => (newsData?.items || [])
  .filter(n => clockNow() - Date.parse(n.published) <= NEWS_FRESH_MS && clockNow() >= Date.parse(n.published));

// Starters ({s: team score, p: starter}) whose status flipped to OUT since the
// last update, before their game kicked off.
export function newlyRuledOut() {
  if (Number(previousScoreboard?.week) !== currentWeek) return [];
  const before = new Map((previousScoreboard.scores || []).flatMap(s => (s.lineup?.starters || []).map(p => [s.teamId + ":" + p.id, p.injury])));
  return currentScores.flatMap(s => (s.lineup?.starters || []).map(p => ({ s, p })))
    .filter(({ s, p }) => p.injury === "O" && before.has(s.teamId + ":" + p.id) && before.get(s.teamId + ":" + p.id) !== "O")
    .filter(({ p }) => nflGameByProTeam.get(Number(p.proTeamId))?.state === "pre");
}

export function addNewsStories(add) {
  // Who rosters whom.
  const rostered = new Map();
  for (const t of rosterData.teams || []) {
    for (const e of t.roster?.entries || []) {
      const p = e.playerPoolEntry?.player;
      if (!p) continue;
      const slot = Number(e.lineupSlotId);
      rostered.set(Number(e.playerId), { teamId: Number(t.id), starter: slot !== BENCH_SLOT && slot !== IR_SLOT, pos: POSITIONS[Number(p.defaultPositionId)] || "" });
    }
  }

  const news = freshNews()
    .flatMap(n => n.players.filter(p => rostered.has(p.id)).map(p => ({ n, p, r: rostered.get(p.id) })))
    .map(x => ({ ...x, weight: (x.r.starter ? 2 : 1) + (BIG_NEWS.test(x.n.headline) ? 2 : 0) }))
    .sort((a, b) => b.weight - a.weight || Date.parse(b.n.published) - Date.parse(a.n.published))[0];
  if (news) {
    const { n, r } = news;
    const headline = n.headline.replace(/[.!?]+$/, "");
    const whose = `${possessive(name(r.teamId))} ${r.starter ? "starting " : ""}${r.pos}`.trim();
    const quip = pickLine("news:" + n.headline, ["Take note", "Developing", "Phones are buzzing"]);
    add("NEWS", fit(
      `📰 ${headline}. That's ${whose}. ${quip}.`,
      `📰 ${headline}. That's ${whose}.`,
      `📰 ${headline}.`
    ), 40 + news.weight * 6);
  }

  // RULED OUT: a starter newly OUT since the last update, game not started.
  const ruledOut = newlyRuledOut()[0];
  if (ruledOut) {
    const { s, p } = ruledOut;
    const game = nflGameByProTeam.get(Number(p.proTeamId));
    // Where his backup is (Sleeper's depth chart), when known.
    const backup = backupLine(p.id, s.teamId);
    add("RULED OUT", fit(
      ...(backup ? [
        `🚨 RULED OUT: ${p.name} won't play, and he's in ${possessive(s.team)} lineup. ${backup}. Kickoff's ${kickoffLabel(game.kickoff)}.`,
        `🚨 RULED OUT: ${p.name} is out, and he starts for ${s.team}. ${backup}.`
      ] : []),
      `🚨 RULED OUT: ${p.name} won't play, and he's in ${possessive(s.team)} starting lineup. Kickoff's ${kickoffLabel(game.kickoff)}. Clock's ticking.`,
      `🚨 RULED OUT: ${p.name} is out, and he's in ${possessive(s.team)} starting lineup.`
    ), 95);
  }
}
