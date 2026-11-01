// Live betting markets for NFL games in progress (Games tab, Jim 2026-11-01). ESPN's sportsbook line freezes at
// kickoff, so in game the spread, over/under and win odds come from Kalshi's public NFL markets (free, no login):
// a winner market per team, "wins by over X" markets at many strikes, and "over X points" markets at many strikes.
// The live line is where the market crosses 50%.
const API = "https://api.elections.kalshi.com/trade-api/v2/markets";
const KALSHI_ABBR = { JAX: "JAC", WSH: "WAS" };
const kalshi = abbrev => KALSHI_ABBR[abbrev] || abbrev;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// "26NOV01": the kickoff's date in New York, as Kalshi's event tickers spell it.
function tickerDate(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "numeric", day: "2-digit" })
    .formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.year}${MONTHS[Number(parts.month) - 1]}${parts.day}`;
}

// A market's chance: the bid/ask midpoint when the book is tight, otherwise the last trade.
function chance(m) {
  const bid = Number(m.yes_bid_dollars), ask = Number(m.yes_ask_dollars), last = Number(m.last_price_dollars);
  if (Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
  return Number.isFinite(last) && last > 0 ? last : null;
}

// The x where P(value > x) crosses 50%, from [x, P] points (made non-increasing first).
function median(points) {
  const pts = points.filter(([x, p]) => Number.isFinite(x) && p != null).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < pts.length; i++) pts[i][1] = Math.min(pts[i][1], pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, p0] = pts[i - 1], [x1, p1] = pts[i];
    if (p0 >= 0.5 && p1 <= 0.5) return p0 === p1 ? (x0 + x1) / 2 : x0 + (p0 - 0.5) / (p0 - p1) * (x1 - x0);
  }
  return null;
}
const half = x => x == null ? null : Math.round(x * 2) / 2;

async function markets(event, retry = true) {
  try {
    const r = await fetch(`${API}?event_ticker=${event}&limit=200`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (r.status === 429 && retry) { await new Promise(done => setTimeout(done, 1500)); return markets(event, false); }
    if (!r.ok) console.warn(`Kalshi ${event}: HTTP ${r.status}`);
    return r.ok ? (await r.json()).markets || [] : [];
  } catch (e) { console.warn(`Kalshi ${event}: ${e.message}`); return []; }
}

// { spread (home team's, like ESPN's), total, homeWin (0-100) } for one game in progress, or null.
// Call it for one game at a time: the public API rate-limits bursts.
export async function liveMarket(game) {
  const home = (game.teams || []).find(t => t.home), away = (game.teams || []).find(t => !t.home);
  if (!home || !away || !game.kickoff) return null;
  const h = kalshi(home.abbrev), a = kalshi(away.abbrev);
  const suffix = `-${tickerDate(game.kickoff)}${a}${h}`;
  const [winner, spreads, totals] = await Promise.all(["KXNFLGAME", "KXNFLSPREAD", "KXNFLTOTAL"].map(s => markets(s + suffix)));
  const homeWin = chance(winner.find(m => m.ticker.endsWith(`-${h}`)) || {});
  // Home margin M: a home "wins by over s" market is P(M > s); an away one is P(M < -s), so P(M > -s) is its complement.
  const margin = median(spreads.map(m => {
    const p = chance(m), s = Number(m.floor_strike), team = m.ticker.split("-").pop().replace(/\d+$/, "");
    return p == null ? null : team === h ? [s, p] : team === a ? [-s, 1 - p] : null;
  }).filter(Boolean));
  const total = median(totals.map(m => [Number(m.floor_strike), chance(m)]));
  if (homeWin == null && margin == null && total == null) return null;
  return { spread: margin == null ? null : half(-margin), total: half(total), homeWin: homeWin == null ? null : Math.round(homeWin * 100) };
}
