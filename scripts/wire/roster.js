import { round } from "../lib/simulation.js";
import { BENCH_SLOT } from "../lib/lineup.js";
import { DATA, currentScores, fit, listNames, name, readJson, rosterData } from "./context.js";

// League Wire: injury wards, bold strategies and thin depth.
// ---- Roster stories ----------------------------------------------------------
// Injury wards (a team missing a lot of draft capital) and bold roster
// constructions (piles of onesies, no depth where it counts). Neither depends
// on the games, so they run all week.
export const draftData = await readJson(`${DATA}/mDraftDetail.json`).catch(() => null);
export const draftRound = new Map((draftData?.draftDetail?.picks || []).map(p => [Number(p.playerId), Number(p.roundId)]));
export const settingsData = await readJson(`${DATA}/mSettings.json`).catch(() => null);
export const slotCounts = settingsData?.settings?.rosterSettings?.lineupSlotCounts || {};
export const startersAt = slot => Number(slotCounts[slot] ?? 1);
export const OUT_STATUSES = new Set(["OUT", "INJURY_RESERVE", "DOUBTFUL", "SUSPENSION"]);
// Draft capital lost to injury: a 1st-rounder counts 8, a 2nd 7, ... an 8th 1.
export const draftValue = round => round ? Math.max(0, 9 - round) : 0;
export const INJURY_WARD_MIN_VALUE = 12;
export const ONESIE_LABEL = {1:"QB", 4:"TE", 5:"K", 16:"D/ST"};
export const BOLD_MIN_SCORE = 4;

export function rosterReport(t) {
  const players = (t.roster?.entries || []).filter(e => e.playerPoolEntry?.player).map(e => {
    const player = e.playerPoolEntry.player;
    const status = player.injuryStatus || e.injuryStatus || "ACTIVE";
    return {
      name:player.fullName,
      lastName:(player.lastName || player.fullName).replace(/\s+(Jr\.|Sr\.|II|III|IV)$/, ""),
      positionId:Number(player.defaultPositionId),
      slot:Number(e.lineupSlotId),
      round:draftRound.get(Number(e.playerId)) || null,
      out:OUT_STATUSES.has(status)
    };
  });
  const healthy = players.filter(p => !p.out);
  const count = pos => healthy.filter(p => p.positionId === pos);

  const injured = players.filter(p => p.out && draftValue(p.round) > 0).sort((a, b) => a.round - b.round);
  const injuryValue = injured.reduce((sum, p) => sum + draftValue(p.round), 0);

  // Quirks, each with a weight for how bold it is. Onesie stockpiles count
  // healthy players only, so an injury-forced backup QB isn't "bold".
  const quirks = [];
  const tes = count(4), qbs = count(1), ks = count(5), dsts = count(16);
  if (tes.length >= 3) quirks.push({weight:2 + tes.length - 3, text:tes.length + " TEs", detail:tes.map(p => p.lastName)});
  if (qbs.length >= 3) quirks.push({weight:2 + qbs.length - 3, text:qbs.length + " QBs", detail:qbs.map(p => p.lastName)});
  if (ks.length >= 2) quirks.push({weight:3, text:ks.length + " kickers"});
  if (dsts.length >= 2) quirks.push({weight:1, text:dsts.length + " defenses"});
  const bench = players.filter(p => p.slot === BENCH_SLOT);
  const benchOnesies = bench.filter(p => ONESIE_LABEL[p.positionId]);
  if (bench.length >= 3 && benchOnesies.length === bench.length) quirks.push({weight:3, text:"a bench made entirely of onesies (" + listNames([...new Set(benchOnesies.map(p => ONESIE_LABEL[p.positionId]))]) + ")"});
  else if (bench.length >= 3 && benchOnesies.length / bench.length >= 0.6) quirks.push({weight:1, text:benchOnesies.length + " of " + bench.length + " bench spots on onesies"});
  // No healthy depth behind the starters at RB or WR.
  const thin = [];
  for (const [pos, slot, label] of [[2, 2, "RB"], [3, 4, "WR"]]) {
    const healthyAt = count(pos);
    if (healthyAt.length > startersAt(slot)) continue;
    thin.push({label, healthy:healthyAt.map(p => p.lastName), short:healthyAt.length < startersAt(slot)});
    quirks.push({weight:2, text:(healthyAt.length ? "just " + healthyAt.length : "no") + " healthy " + label + (healthyAt.length === 1 ? "" : "s")});
  }
  quirks.sort((a, b) => b.weight - a.weight);
  return {teamId:Number(t.id), team:name(Number(t.id)), injured, injuryValue, quirks, thin, boldness:quirks.reduce((sum, q) => sum + q.weight, 0)};
}

export function addRosterStories(add) {
  const reports = (rosterData.teams || []).map(rosterReport);
  // Roster stories lead the week-ahead wire and sit behind live game stories.
  const pregame = currentScores.every(s => Number(s.score) === 0);
  const COTTON = " It's a bold strategy, Cotton. Let's see if it pays off for 'em.";
  const injuredList = (r, n) => listNames(r.injured.slice(0, n).map(p => p.lastName + " (Rd " + p.round + ")"));
  const injuredNames = (r, n) => listNames(r.injured.slice(0, n).map(p => p.lastName));
  const quirkList = (r, n, withDetail) => listNames(r.quirks.slice(0, n).map(q => q.text + (withDetail && q.detail ? " (" + listNames(q.detail) + ")" : "")));

  const slammed = reports.filter(r => r.injuryValue >= INJURY_WARD_MIN_VALUE).sort((a, b) => b.injuryValue - a.injuryValue)[0];
  const bold = reports.filter(r => r.boldness >= BOLD_MIN_SCORE).sort((a, b) => b.boldness - a.boldness)[0];
  if (slammed) {
    const n = slammed.injured.length;
    add("INJURY WARD",fit(
      "🚑 INJURY WARD: " + slammed.team + " is absolutely slammed — " + injuredList(slammed, 4) + (n > 4 ? " and " + (n - 4) + " more" : "") + (n === 1 ? " is" : " are") + " out.",
      "🚑 INJURY WARD: " + slammed.team + " is without " + injuredList(slammed, 3) + ".",
      "🚑 INJURY WARD: " + slammed.team + " is without " + injuredNames(slammed, 3) + "."
    ),(pregame ? 62 : 32) + slammed.injuryValue / 4);
  }
  if (bold) {
    add("BOLD STRATEGY",fit(
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 3, true) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 2, true) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 2, false) + "." + COTTON,
      "🎲 " + bold.team + " is rolling with " + quirkList(bold, 1, false) + "." + COTTON
    ),(pregame ? 60 : 30) + bold.boldness);
  }

  // Thin ice: no healthy backup at RB or WR (or already a hole in the
  // lineup). The bold team already got its depth called out.
  const thin = reports.filter(r => r !== bold).flatMap(r => r.thin.map(x => ({...x, team:r.team})))
    .sort((a, b) => b.short - a.short || a.healthy.length - b.healthy.length);
  if (thin.length) {
    const describe = (x, withNames) => x.short
      ? x.team + " is down to " + (x.healthy.length ? x.healthy.length + " healthy " + x.label + (withNames ? " (" + listNames(x.healthy) + ")" : "") : "zero healthy " + x.label + "s")
      : x.team + " has no healthy backup " + x.label + (withNames ? " behind " + listNames(x.healthy) : "");
    const tail = thin[0].short ? " That's already a hole in the lineup." : " One more injury and there's a hole in the lineup.";
    add("THIN ICE",fit(
      "🧊 THIN ICE: " + listNames(thin.slice(0, 2).map(x => describe(x, true))) + "." + tail,
      "🧊 THIN ICE: " + listNames(thin.slice(0, 2).map(x => describe(x, false))) + "." + tail,
      "🧊 THIN ICE: " + describe(thin[0], true) + "." + tail,
      "🧊 THIN ICE: " + describe(thin[0], false) + "." + tail
    ),(pregame ? 58 : 28) + (thin[0].short ? 4 : 0));
  }
}
