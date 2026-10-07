import { clockNow, fit, guillotineData, listNames, pickLine } from "./context.js";

// League Wire: FAAB bid stories from the guillotine side league's waiver runs
// (guillotine.json's faab, from update-guillotine.js): FAAB PHOTO FINISH (won
// by $5 or less) and FAAB OVERPAY ($100+ more than the next bid, or a big bid
// nobody else matched). Shown for a few days after the run, until Sunday's
// games start (roster talk; see curate in league-wire.js).
const SHOW_FOR_MS = 4 * 24 * 60 * 60 * 1000;
const PHOTO_FINISH_MAX = 5;
const OVERPAY_MIN = 100;
const dollars = n => "$" + Number(n).toLocaleString("en-US");

export function addFaabStories(add) {
  const claims = (guillotineData?.faab?.claims || []).filter(c => {
    const age = clockNow() - Date.parse(c.processedAt);
    return age >= 0 && age <= SHOW_FOR_MS;
  }).map(c => {
    const runnerUp = c.others[0]?.bid ?? null;
    return { ...c, runnerUp, margin: runnerUp == null ? null : c.winner.bid - runnerUp,
      // Everyone tied at the runner-up bid.
      runnersUp: runnerUp == null ? [] : c.others.filter(o => o.bid === runnerUp).map(o => o.team) };
  });
  const label = c => `${c.player}${c.position ? " (" + c.position + ")" : ""}`;

  // The closest win (a real bid on both sides).
  const close = claims.filter(c => c.margin != null && c.margin <= PHOTO_FINISH_MAX && c.runnerUp > 0)
    .sort((a, b) => a.margin - b.margin || b.winner.bid - a.winner.bid)[0];
  if (close) {
    const losers = listNames(close.runnersUp);
    const lead = pickLine("faab-close:" + close.playerId, ["💸 FAAB photo finish", "💸 Closest bid of the week", "💸 Won by a whisker"]);
    const what = `${close.winner.team} landed ${label(close)} for ${dollars(close.winner.bid)}`;
    const by = close.margin === 0 ? `, matching ${losers} and winning the tiebreak` : `, just ${dollars(close.margin)} more than ${losers} bid`;
    add("FAAB PHOTO FINISH", fit(
      `${lead} in the guillotine league: ${what}${by}.`,
      `${lead}: ${what}${by}.`,
      `${lead}: ${close.winner.team} beat ${losers} to ${close.player} by ${dollars(close.margin)}.`
    ), 66 - 2 * close.margin);   // a $1-2 win usually makes the wire's top 8
  }

  // The biggest overpays (one per team, at most two).
  const overpays = claims.map(c => ({ ...c, overpay: c.winner.bid - (c.runnerUp ?? 0) }))
    .filter(c => c.overpay >= OVERPAY_MIN)
    .sort((a, b) => b.overpay - a.overpay)
    .filter((c, i, all) => all.findIndex(x => x.winner.teamId === c.winner.teamId) === i)
    .slice(0, 2);
  for (const c of overpays) {
    const quip = pickLine("faab-over:" + c.playerId, ["Money well spent?", "Somebody check the receipts.", "Hope he was worth it.", "The guillotine league thanks you for your donation."]);
    const vs = c.runnerUp ? `${dollars(c.overpay)} more than the next bid (${listNames(c.runnersUp)}, ${dollars(c.runnerUp)})` : "and nobody else bid a dime";
    add("FAAB OVERPAY", fit(
      `🤑 Overpay alert: ${c.winner.team} spent ${dollars(c.winner.bid)} on ${label(c)}, ${vs}. ${quip}`,
      `🤑 Overpay alert: ${c.winner.team} spent ${dollars(c.winner.bid)} on ${c.player}, ${vs}.`,
      `🤑 ${c.winner.team} paid ${dollars(c.winner.bid)} for ${c.player}, ${c.runnerUp ? dollars(c.overpay) + " over the next bid" : "with no other bids"}.`
    ), 50 + Math.min(15, c.overpay / 40));
  }
}
