// Betting-line history (Jim, 2026-10-29): ESPN's scoreboard only carries each
// game's opening and current line, so every LINES_EVERY_MS the scheduled run
// saves the current spread, total and (vig-free) home win chance, and keeps a
// change only when a number moved. Stored per NFL week in the LiveStore
// ("lines": { week, season, games: { [eventId]: { away, home, kickoff, open,
// moves: [{ t, spread, total, homeWin }] } } }) and served at GET /lines for
// the Games tab and the League Wire's line-move stories.
import { storeGet, storePut } from "./live.js";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const LINES_EVERY_MS = 30 * 60 * 1000;

const american = v => { const n = Number(String(v ?? "").replace("+", "")); return Number.isFinite(n) && n !== 0 ? (n > 0 ? 100 / (n + 100) : -n / (-n + 100)) : null; };
const homeWin = (h, a) => { h = american(h); a = american(a); return h && a ? Math.round(h / (h + a) * 1000) / 10 : null; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// One game's line from ESPN's odds: spread is the home team's (−3 = home favored by 3).
function lineOf(odds, which) {
  const ml = odds.moneyline || {}, ps = odds.pointSpread || {}, tot = odds.total || {};
  if (which === "open") {
    return { spread: num(ps.home?.open?.line), total: num(String(tot.over?.open?.line ?? "").replace(/^[ou]/, "")), homeWin: homeWin(ml.home?.open?.odds, ml.away?.open?.odds) };
  }
  return { spread: num(odds.spread ?? ps.home?.close?.line), total: num(odds.overUnder), homeWin: homeWin(ml.home?.close?.odds ?? ml.home?.current?.odds, ml.away?.close?.odds ?? ml.away?.current?.odds) };
}

export async function snapshotLines(env, now = Date.now()) {
  const saved = await storeGet(env, "lines").catch(() => null);
  if (saved?.checkedAt && now - Date.parse(saved.checkedAt) < LINES_EVERY_MS) return saved;
  const board = await fetch(SCOREBOARD, { headers: { Accept: "application/json" } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!board?.week?.number) return saved;
  const week = board.week.number, season = board.season?.year;
  const lines = saved && saved.week === week && saved.season === season ? saved : { week, season, games: {} };
  for (const event of board.events || []) {
    const c = event.competitions?.[0], odds = c?.odds?.[0];
    if (!c || !odds || c.status?.type?.state !== "pre") continue;   // lines freeze at kickoff
    const side = h => c.competitors?.find(x => x.homeAway === h)?.team?.abbreviation;
    const game = lines.games[event.id] ||= { away: side("away"), home: side("home"), kickoff: event.date, open: lineOf(odds, "open"), moves: [] };
    const cur = lineOf(odds, "now"), last = game.moves[game.moves.length - 1] || game.open;
    if (cur.spread !== last.spread || cur.total !== last.total || Math.abs((cur.homeWin ?? 0) - (last.homeWin ?? 0)) >= 1) {
      game.moves.push({ t: new Date(now).toISOString(), ...cur });
    }
  }
  lines.checkedAt = new Date(now).toISOString();
  await storePut(env, "lines", lines);
  return lines;
}

export const readLines = env => storeGet(env, "lines").catch(() => null);
