import { currentWeek, fit, nflGames, pickLine, readJson } from "./context.js";

// League Wire: the league's Splash survivor pool (Jim, 2026-10-25).
// - SURVIVOR PICKS: once this week's picks are revealed (a pick shows once its
//   game kicks off), who rode whom: the most popular team, lone wolves, and
//   each manager's mix.
// - SURVIVOR SCARE: a pick whose game is going badly (ESPN's live win
//   probability under 40%), with the entries riding it.
// The feed is the notification worker's /survivor (the Survivor tab's source);
// it only ever holds revealed picks.
const FEED = process.env.SURVIVOR_FEED || "https://otwf-notify.otwf.workers.dev/survivor";
const SCARE_BELOW = 0.4;
const FEED_ABBR = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
const team = a => FEED_ABBR[a] || a;
const feed = process.env.SURVIVOR_FEED_FILE   // tests: a saved feed
  ? await readJson(process.env.SURVIVOR_FEED_FILE).catch(() => null)
  : await fetch(FEED, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null);
const week = Number(feed?.contest?.currentWeek);
const entries = feed?.entries || [];
const revealed = week !== currentWeek ? [] : entries.map(e => ({ user: e.user, pick: e.picks?.[week] })).filter(x => x.pick);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function gameOf(t) {
  for (const g of nflGames) {
    const us = (g.teams || []).find(x => team(x.abbrev) === t), them = (g.teams || []).find(x => team(x.abbrev) !== t);
    if (us && them) return { g, us, them };
  }
  return null;
}

export function addSurvivorPicksStory(add) {
  if (!revealed.length) return;
  const byTeam = new Map();
  for (const x of revealed) byTeam.set(x.pick.team, [...(byTeam.get(x.pick.team) || []), x.user]);
  const teams = [...byTeam].sort((a, b) => b[1].length - a[1].length);
  // Quiet once every revealed pick's game is final (the week's results take over).
  if (teams.every(([t]) => gameOf(t)?.g.completed)) return;
  const [top, riders] = teams[0];
  const wolves = teams.filter(([, users]) => users.length === 1).map(([t, [u]]) => `${u} on ${t}`);
  const hidden = entries.filter(e => e.alive && !e.picks?.[week]).length;
  const mix = teams.map(([t, users]) => `${t} ${users.length}`).join(", ");
  const lead = pickLine("svpicks" + week + revealed.length, [
    `🛡️ SURVIVOR PICKS: Week ${week}'s picks are in.`,
    `🛡️ SURVIVOR PICKS: The Week ${week} cards are on the table.`,
    `🛡️ SURVIVOR PICKS: Here's who's riding whom in Week ${week}.`
  ]);
  add("SURVIVOR PICKS", fit(
    `${lead} ${plural(riders.length, "entry", "entries")} on ${top}${wolves.length ? `; lone wolf${wolves.length > 1 ? "s" : ""}: ${wolves.join(", ")}` : ""}. All revealed: ${mix}.${hidden ? ` ${plural(hidden, "pick")} still hidden until kickoff.` : ""}`,
    `${lead} ${plural(riders.length, "entry", "entries")} on ${top}${wolves.length ? `; lone wolf: ${wolves[0]}` : ""}. Revealed: ${mix}.`,
    `🛡️ SURVIVOR PICKS: Week ${week}: ${mix}.`
  ), 70);
}

export function addSurvivorScareStory(add) {
  const risky = [];
  const counted = new Map();
  for (const x of revealed) {
    if (x.pick.result && x.pick.result !== "pending") continue;
    const gm = gameOf(x.pick.team);
    if (!gm || gm.g.state !== "in" || gm.us.winChance == null || gm.us.winChance >= SCARE_BELOW) continue;
    counted.set(x.pick.team, [...(counted.get(x.pick.team) || []), x.user]);
  }
  for (const [t, users] of counted) {
    const { g, us, them } = gameOf(t);
    risky.push({ t, users, g, us, them, risk: users.length * (1 - us.winChance) });
  }
  const r = risky.sort((a, b) => b.risk - a.risk)[0];
  if (!r) return;
  const who = [...new Set(r.users)].map(u => { const k = r.users.filter(x => x === u).length; return k > 1 ? `${u} ×${k}` : u; }).join(", ");
  const score = `${r.us.score}–${r.them.score}`;
  add("SURVIVOR SCARE", fit(
    `😬 SURVIVOR SCARE: ${r.t} is down to ${Math.round(r.us.winChance * 100)}% to win (${score} vs ${team(r.them.abbrev)}, ${r.g.detail}). ${plural(r.users.length, "entry", "entries")} on the brink: ${who}.`,
    `😬 SURVIVOR SCARE: ${r.t} ${Math.round(r.us.winChance * 100)}% to win (${score}). ${plural(r.users.length, "entry", "entries")} on the brink: ${who}.`,
    `😬 SURVIVOR SCARE: ${r.t} ${Math.round(r.us.winChance * 100)}% to win; ${plural(r.users.length, "entry", "entries")} at risk.`
  ), 85 + Math.min(r.users.length, 10));
}
