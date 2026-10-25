import { DATA, fit, listNames, name, pickLine, pts, readJson } from "./context.js";

// League Wire: TRADE TAUNT (Jim, 2026-10-25). Four weeks after a trade, a
// trade the site suggested, or (when switched on) one of the site login's own
// offers, what each side has scored since (trade-log.js). Runs the week it
// turns four weeks old (and the next), for the most lopsided one.
// Offers are private on ESPN (the login only sees its own team's), so they
// stay off unless Jim switches them on.
export const PUBLISH_OFFERS = false;
const MIN_GAP = 15;
const log = await readJson(`${DATA}/trade-log.json`).catch(() => null);

export function addTradeTauntStory(add) {
  if (!log) return;
  const fresh = x => x.ready && x.weeksSince <= log.tauntAfterWeeks + 1 && Object.keys(x.sides).length === 2;
  const pool = [
    ...(log.trades || []).filter(fresh).map(x => ({ ...x, kind: "trade", base: 78 })),
    ...(log.suggestions || []).filter(fresh).map(x => ({ ...x, kind: "suggestion", base: 70 })),
    ...(PUBLISH_OFFERS ? (log.offers || []).filter(fresh).map(x => ({ ...x, kind: "offer", base: 74 })) : [])
  ].map(x => {
    const [[a, A], [b, B]] = Object.entries(x.sides);
    return { ...x, a: Number(a), A, b: Number(b), B, gap: Math.abs(A.total - B.total) };
  }).filter(x => x.gap >= MIN_GAP).sort((p, q) => q.base + q.gap / 5 - (p.base + p.gap / 5));
  const x = pool[0];
  if (!x) return;
  const players = s => listNames(s.players.map(p => p.name));
  const [win, winSide, lose, loseSide] = x.A.total >= x.B.total ? [x.a, x.A, x.b, x.B] : [x.b, x.B, x.a, x.A];
  const since = `Since: ${players(winSide)} ${pts(winSide.total)}, ${players(loseSide)} ${pts(loseSide.total)}.`;
  const lead = pickLine("taunt" + x.id, ["🤝 TRADE TAUNT", "🤝 TRADE RECEIPTS", "🤝 HINDSIGHT DEPT."]);
  const weeksAgo = `${x.weeksSince} weeks ago`;
  let text;
  if (x.kind === "trade") {
    text = [`${lead}: ${weeksAgo}, ${name(lose)} sent ${players(winSide)} to ${name(win)} for ${players(loseSide)}. ${since} ${name(win)} is winning this one.`,
            `${lead}: ${name(win)} got ${players(winSide)} from ${name(lose)} ${weeksAgo}. ${since}`];
  } else if (x.kind === "suggestion") {
    text = [`${lead}: ${weeksAgo} we said ${name(win)} and ${name(lose)} should swap. They didn't. ${name(win)} would have gotten ${players(winSide)}: ${pts(winSide.total)} since, vs ${pts(loseSide.total)} for ${players(loseSide)}.`,
            `${lead}: ${weeksAgo} we said ${name(win)} should get ${players(winSide)} from ${name(lose)}. ${since}`];
  } else {
    const verb = x.outcome === "declined" ? "turned down" : x.outcome === "vetoed" ? "saw vetoed" : "never took";
    const offeree = x.proposer === x.a ? x.b : x.a;
    text = [`${lead}: In Week ${x.week}, ${name(offeree)} ${verb} ${name(x.proposer)}'s offer. ${since} ${name(win)} would have won it.`,
            `${lead}: ${name(offeree)} ${verb} a Week ${x.week} offer from ${name(x.proposer)}. ${since}`];
  }
  add("TRADE TAUNT", fit(...text), x.base + Math.min(x.gap, 60) / 6);
}
