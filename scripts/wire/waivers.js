import { DATA, clockNow, fit, listNames, name, pickLine, pts, readJson } from "./context.js";

// League Wire: waiver stories after the big Wednesday-morning waiver run
// (WAIVER WIRE, WAIVER TUG-OF-WAR, SHOPPING SPREE), from waivers.json
// (fetch-drops.js). Traditional waivers: priority order, no bids. Shown
// until Sunday's games start (roster talk; see curate in league-wire.js).
const waiversData = await readJson(`${DATA}/waivers.json`).catch(() => null);
const SHOW_FOR_MS = 5 * 24 * 60 * 60 * 1000;
const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
// Players these stories cover, so FRESH OFF THE WIRE doesn't repeat them.
export const waiverPlayers = new Set();

export function addWaiverStories(add) {
  // The latest Wednesday run.
  const wednesday = (waiversData?.claims || []).filter(c => {
    const age = clockNow() - Date.parse(c.processedAt);
    return etDay(c.processedAt) === "Wed" && age >= 0 && age <= SHOW_FOR_MS;
  });
  const latestDay = wednesday.map(c => c.processedAt.slice(0, 10)).sort().pop();
  const run = wednesday.filter(c => c.processedAt.slice(0, 10) === latestDay);
  const won = run.filter(c => c.won);
  if (!won.length) return;
  for (const c of won) waiverPlayers.add(c.player);
  const label = c => `${c.player} (${c.position}${c.projection != null ? ", proj " + pts(c.projection) : ""})`;

  // The headline: how many claims, and the best-projected prize.
  const prize = [...won].sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1))[0];
  const lead = pickLine("waivers:" + latestDay, ["🧾 Waivers have cleared", "🧾 Wednesday waivers are in", "🧾 The waiver dust has settled"]);
  add("WAIVER WIRE", fit(
    `${lead}: ${won.length} claim${won.length === 1 ? "" : "s"} went through. Top prize: ${label(prize)} to ${name(prize.teamId)}` + (prize.dropped ? `, who cut ${prize.dropped} to make room.` : "."),
    `${lead}: ${won.length} claim${won.length === 1 ? "" : "s"}. Top prize: ${label(prize)} to ${name(prize.teamId)}.`,
    `${lead}: ${prize.player} to ${name(prize.teamId)} leads ${won.length} claim${won.length === 1 ? "" : "s"}.`
  ), 44);

  // A player more than one team wanted (when ESPN shows the losing claims).
  const contested = won.map(c => ({ c, losers: [...new Set(run.filter(x => !x.won && x.playerId === c.playerId).map(x => name(x.teamId)))] }))
    .filter(x => x.losers.length).sort((a, b) => b.losers.length - a.losers.length)[0];
  if (contested) {
    const { c, losers } = contested;
    add("WAIVER TUG-OF-WAR", fit(
      `🥊 Waiver tug-of-war: ${name(c.teamId)} beat ${listNames(losers)} to ${c.player}. ${losers.length === 1 ? "Better luck next week" : "Condolences to the rest"}.`,
      `🥊 ${name(c.teamId)} beat ${listNames(losers)} to ${c.player} on waivers.`,
      `🥊 ${name(c.teamId)} won the ${c.player} sweepstakes (${losers.length} other claim${losers.length === 1 ? "" : "s"}).`
    ), 40 + losers.length);
  }

  // Someone who went on a spree.
  const byTeam = new Map();
  for (const c of won) byTeam.set(c.teamId, [...(byTeam.get(c.teamId) || []), c]);
  const [spreeTeam, spree] = [...byTeam].sort((a, b) => b[1].length - a[1].length)[0];
  if (spree.length >= 2) {
    const quip = pickLine("spree:" + spreeTeam, ["Rebuild in progress", "Retail therapy", "New phone, who dis"]);
    add("SHOPPING SPREE", fit(
      `🛍️ ${name(spreeTeam)} went waiver shopping: ${listNames(spree.map(c => c.player))}. ${quip}.`,
      `🛍️ ${name(spreeTeam)} went waiver shopping: ${listNames(spree.map(c => c.player))}.`,
      `🛍️ ${name(spreeTeam)} claimed ${spree.length} players off waivers.`
    ), 30 + spree.length);
  }
}
