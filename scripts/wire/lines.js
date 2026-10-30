import { DATA, clockNow, currentScores, currentWeek, fit, nflGames, readJson } from "./context.js";

// League Wire: LINE MOVE (Jim, 2026-10-29). The betting line on a game that
// hasn't kicked off has moved 3+ points since opening (or the favorite
// flipped), from the notification worker's /lines history. Names the league's
// biggest starter in that game, or the latest injury/status headline about
// either team.
// Opens the Games tab.
const FEED = process.env.LINES_FEED || "https://otwf-notify.otwf.workers.dev/lines";
const MIN_SHIFT = 3;
const MAX_STORIES = 2;
const NEWS_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;
// Only news that could move a line (injuries, who's playing); a team's other headlines would read as the reason.
const MOVES_LINES = /\b(out|injur\w*|questionable|doubtful|ruled|inactive|start(s|ing|er)?|IR|concussion|surgery|benched|return\w*|week-to-week|limited|sidelined|suspend\w*)\b/i;
const NICKNAMES = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns",
  DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs",
  LAC: "Chargers", LAR: "Rams", LV: "Raiders", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants",
  NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WSH: "Commanders"
};

const lines = process.env.LINES_FEED_FILE   // tests: a saved feed
  ? await readJson(process.env.LINES_FEED_FILE).catch(() => null)
  : await fetch(FEED, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null);
const news = (await readJson(`${DATA}/news.json`).catch(() => null))?.items || [];

const spreadText = (s, home, away) => s === 0 ? "a pick'em" : s < 0 ? `${home} −${-s}` : `${away} −${s}`;

export function addLineMoveStory(add) {
  if (Number(lines?.week) !== currentWeek) return;
  const moves = [];
  for (const [id, g] of Object.entries(lines.games || {})) {
    const game = nflGames.find(x => String(x.id) === String(id));
    if (!game || game.state !== "pre") continue;
    const now = g.moves?.[g.moves.length - 1];
    if (!now || now.spread == null || g.open?.spread == null) continue;
    const shift = Math.abs(now.spread - g.open.spread);
    const flipped = Math.sign(now.spread) !== Math.sign(g.open.spread) && now.spread !== 0 && g.open.spread !== 0;
    if (shift < MIN_SHIFT && !flipped) continue;
    moves.push({ id, g, game, now, shift, flipped });
  }
  moves.sort((a, b) => b.shift - a.shift);
  for (const m of moves.slice(0, MAX_STORIES)) {
    const { g, now } = m;
    const ids = new Set((m.game.teamIds || []).map(Number));
    const starters = currentScores.flatMap(s => (s.lineup?.starters || []).map(p => ({ ...p, owner: s.team })))
      .filter(p => ids.has(Number(p.proTeamId))).sort((a, b) => (b.projection || 0) - (a.projection || 0));
    const names = [NICKNAMES[g.home], NICKNAMES[g.away]].filter(Boolean);
    const headline = news.filter(n => clockNow() - Date.parse(n.published) <= NEWS_MAX_AGE_MS && names.some(x => n.headline.includes(x)) && MOVES_LINES.test(n.headline))
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))[0]?.headline;
    const move = `${g.away} @ ${g.home}: ${spreadText(g.open.spread, g.home, g.away)} at open, ${spreadText(now.spread, g.home, g.away)} now.`;
    const total = now.total != null && g.open.total != null && now.total !== g.open.total ? ` Total ${g.open.total} → ${now.total}.` : "";
    const who = starters.length ? ` ${starters.length} league ${starters.length === 1 ? "starter" : "starters"} in it, led by ${starters[0].name} (${starters[0].owner}).` : "";
    add("LINE MOVE", fit(
      `📈 LINE MOVE: ${move}${headline ? ` News: "${headline}"` : who}`,
      `📈 LINE MOVE: ${move}${who}`,
      `📈 LINE MOVE: ${move}${total}`,
      `📈 LINE MOVE: ${move}`
    ), Math.min(80, 60 + Math.round(m.shift * 2) + (m.flipped ? 6 : 0)));
  }
}
