import { round } from "../lib/simulation.js";
import { BENCH_SLOT } from "../lib/lineup.js";
import { DATA, currentScores, fit, listNames, name, readJson, rosterData, teamData } from "./context.js";

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
      out:OUT_STATUSES.has(status),
      owned:Number(player.ownership?.percentOwned)
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
  // Bench quality: how widely its healthy players are rostered across ESPN
  // leagues (the depth a team can actually use; injured spots called out apart).
  const ownedBench = bench.filter(p => !p.out && Number.isFinite(p.owned));
  const benchOwned = ownedBench.length ? ownedBench.reduce((sum, p) => sum + p.owned, 0) / ownedBench.length : null;
  const scrubs = ownedBench.filter(p => p.owned < 25).sort((a, b) => a.owned - b.owned);
  return {teamId:Number(t.id), team:name(Number(t.id)), injured, injuryValue, quirks, thin, boldness:quirks.reduce((sum, q) => sum + q.weight, 0),
    bench, benchOwned, scrubs, benchOut:bench.filter(p => p.out)};
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

  // Bargain bin: the bench least rostered across ESPN (average % rostered),
  // with injured bench spots and position pile-ups called out. Needs a real gap.
  const binned = reports.filter(r => r.benchOwned != null && r.bench.filter(p => !p.out).length >= 3).sort((a, b) => a.benchOwned - b.benchOwned);
  console.log("League Wire: healthy-bench % rostered:", binned.map(r => `${r.team} ${Math.round(r.benchOwned)}%`).join(", "));
  const bin = binned[0], next = binned[1];
  if (bin && next && bin.benchOwned <= 45 && next.benchOwned - bin.benchOwned >= 5) {
    const record = (() => { const t = (teamData.teams || []).find(x => Number(x.id) === bin.teamId); const r = t?.record?.overall; return r ? ` (${r.wins}-${r.losses})` : ""; })();
    const extras = [
      bin.benchOut.length ? "plus " + bin.benchOut.length + " injured bench spot" + (bin.benchOut.length === 1 ? "" : "s") : "",
      ...bin.quirks.filter(q => /TEs|QBs|kickers|defenses/.test(q.text)).slice(0, 1).map(q => q.text)
    ].filter(Boolean);
    const names = listNames(bin.scrubs.slice(0, 2).map(p => p.lastName + " (" + Math.round(p.owned) + "%)"));
    add("BARGAIN BIN",fit(
      "🗑️ BARGAIN BIN: " + bin.team + record + " has the league's least-wanted healthy bench, " + Math.round(bin.benchOwned) + "% rostered across ESPN on average" + (extras.length ? ", " + listNames(extras) : "") + (names ? ". Featuring " + names : "") + ".",
      "🗑️ BARGAIN BIN: " + bin.team + record + "'s healthy bench averages " + Math.round(bin.benchOwned) + "% rostered across ESPN" + (extras.length ? ", " + listNames(extras) : "") + ".",
      "🗑️ BARGAIN BIN: " + bin.team + "'s bench averages " + Math.round(bin.benchOwned) + "% rostered across ESPN."
    ),(pregame ? 61 : 31) + Math.min(10, (next.benchOwned - bin.benchOwned) / 2));
  }
  // Dead weight: bench spots doing nothing: injured players hardly anyone
  // rosters (under 20% across ESPN), and onesies beyond what a team can use
  // (a 3rd TE or QB, a 2nd kicker or defense).
  const ONESIE_KEEP = {1:2, 4:2, 5:1, 16:1};
  const dead = reports.map(r => {
    const hurt = r.bench.filter(p => p.out && Number.isFinite(p.owned) && p.owned < 20);
    const extra = Object.entries(ONESIE_KEEP).flatMap(([pos, keep]) => {
      const all = r.bench.concat([]).filter(p => p.positionId === Number(pos));
      const onRoster = (rosterData.teams || []).find(t => Number(t.id) === r.teamId)?.roster?.entries?.filter(e => Number(e.playerPoolEntry?.player?.defaultPositionId) === Number(pos)).length || 0;
      return onRoster > keep ? [{label: ONESIE_LABEL[pos], count: onRoster}] : [];
    });
    return {...r, hurt, extra, weight: hurt.length + extra.reduce((sum, x) => sum + x.count - ONESIE_KEEP[{QB:1, TE:4, K:5, "D/ST":16}[x.label]], 0)};
  }).sort((a, b) => b.weight - a.weight);
  console.log("League Wire: dead weight:", dead.map(r => `${r.team} ${r.weight}`).join(", "));
  for (const r of dead.slice(0, 2)) console.log("League Wire: bench of " + r.team + ":", r.bench.map(p => `${p.lastName} pos${p.positionId} ${p.out ? "OUT" : "ok"} ${Math.round(p.owned)}%`).join(", "));
  const dw = dead[0];
  if (dw && dw.weight >= 3 && dw.weight > (dead[1]?.weight || 0)) {
    const record = (() => { const t = (teamData.teams || []).find(x => Number(x.id) === dw.teamId); const r = t?.record?.overall; return r ? ` (${r.wins}-${r.losses})` : ""; })();
    const parts = [...dw.extra.map(x => x.count + " " + x.label + "s"), ...(dw.hurt.length ? [dw.hurt.length + " injured long shot" + (dw.hurt.length === 1 ? "" : "s") + " (" + listNames(dw.hurt.slice(0, 2).map(p => p.lastName + " " + Math.round(p.owned) + "%")) + ")"] : [])];
    add("DEAD WEIGHT",fit(
      "🧱 DEAD WEIGHT: " + dw.team + record + " needs help and is clogging its bench with " + listNames(parts) + ".",
      "🧱 DEAD WEIGHT: " + dw.team + record + "'s bench: " + listNames(parts) + ".",
      "🧱 DEAD WEIGHT: " + dw.team + " is carrying " + listNames(parts.slice(0, 1)) + "."
    ),(pregame ? 63 : 33) + dw.weight);
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
