import React, { useState } from "react";
import { money, pct } from "../lib/data.js";
import { HALF_MEAN_SD, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";
import { ShareButton } from "./LiveBits.jsx";
import { TEAM_NAMES, useSurvivorFeed } from "./SurvivorTab.jsx";

// TNF / SNF / MNF What to Watch: how the night game(s) can swing the league, as one shareable panel.
// Shown while a standalone game (night, or alone in its window: standalone()) is live or kicks off within 30 hours. Each team's own stakes
// sit under its matchup instead (nightStakes), and the needles visit them before kickoff (nightPeeks)
// (Jim, 2026-11-09: the preview stays at the game-script level; details where you need them).
// - Game script: what a romp, a shootout or a defensive battle would do to the league's odds.
// - Survivor pool: how many entries are left, who rode tonight's teams (picks
//   show only once the game kicks off) and who has the most entries left; left out once one entry
//   remains or nobody rides on tonight.
// Big night / quiet night odds use the same normal approximation as the
// server's swing stories: each side's players add about 0.8 SD of their
// points in a big game and lose it in a quiet one.
const PRIMETIME_HOUR = 19;
const AHEAD_MS = 30 * 60 * 60 * 1000;
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, "D/ST": 16 };

const etHour = iso => Number(new Date(iso).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
const SLOT_NAMES = { Thu: "TNF", Sun: "SNF", Mon: "MNF" };
const lastName = n => /D\/ST/.test(n) ? n : n.split(" ").slice(1).join(" ") || n;

// Standalone windows count as prime time (Jim, 2026-11-09: "treat the early morning international games like
// prime time"): night games, plus any game with at most one other kicking off within an hour and nothing else
// within ALONE_MS (international mornings; Thanksgiving's three, Christmas and late-season Saturdays too).
const ALONE_MS = 3 * 60 * 60 * 1000, SLOT_MS = 60 * 60 * 1000;
function standalone(g, games) {
  if (!g.kickoff) return false;
  if (etHour(g.kickoff) >= PRIMETIME_HOUR) return true;
  const gap = o => Math.abs(Date.parse(o.kickoff) - Date.parse(g.kickoff));
  const others = games.filter(o => o !== g && o.kickoff);
  return others.filter(o => gap(o) <= SLOT_MS).length <= 1 && others.every(o => gap(o) <= SLOT_MS || gap(o) >= ALONE_MS);
}
// The window's name: TNF/SNF/MNF at night, else Thanksgiving, Christmas, Morning, or the weekday.
function slotLabel(g) {
  const hour = etHour(g.kickoff), day = etDay(g.kickoff);
  if (hour >= PRIMETIME_HOUR) return SLOT_NAMES[day] || "Primetime";
  const [month, date] = new Date(g.kickoff).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" }).split("/").map(Number);
  if (day === "Thu" && month === 11 && date >= 22 && date <= 28) return "Thanksgiving";
  if (month === 12 && date === 25) return "Christmas";
  if (hour < 12) return "Morning";
  return new Date(g.kickoff).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
}

// The prime-time slot to feature: live standalone games, else the next standalone slot.
function nightSlot(nflGames) {
  const night = nflGames.filter(g => g.kickoff && !g.completed && standalone(g, nflGames));
  const live = night.filter(g => g.state === "in");
  if (live.length) return live;
  const upcoming = night.filter(g => g.state === "pre" && Date.parse(g.kickoff) - Date.now() <= AHEAD_MS).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (!upcoming.length) return [];
  const first = Date.parse(upcoming[0].kickoff);
  return upcoming.filter(g => Date.parse(g.kickoff) - first <= SLOT_MS);
}

// A side's players in tonight's games: names, points still projected, SD.
// games: tonight's nflGames entries (for game script).
function tonight(players, gameTeams, games = []) {
  const list = (players || []).filter(p => gameTeams.has(Number(p.proTeamId)));
  const outlook = list.map(p => playerOutlook({ actual: p.actual, projection: p.projection, positionId: POSITION_IDS[p.pos],
    game: games.find(g => (g.teamIds || []).includes(Number(p.proTeamId))), proTeamId: p.proTeamId }));
  // The players who can move the needle (Jim, 2026-11-09): the biggest spread, plus anyone with at least half of it.
  const top = Math.max(0, ...outlook.map(o => o.sd));
  const key = list.map((p, i) => ({ p, sd: outlook[i].sd })).filter(x => x.sd >= top / 2).sort((a, b) => b.sd - a.sd).slice(0, 3).map(x => x.p);
  return {
    list,
    key,
    outlook,
    rest: outlook.reduce((sum, o) => sum + o.rest, 0),
    sd: Math.hypot(...outlook.map(o => o.sd))
  };
}
// Odds (percent) after a big and a quiet night from players with this SD.
function bigQuiet(probabilityPct, playersSd, outcomeSd, direction = 1) {
  if (!(outcomeSd > 0) || !(playersSd > 0)) return null;
  const z = normalQuantile(Math.min(0.9999, Math.max(0.0001, probabilityPct / 100)));
  const shift = direction * HALF_MEAN_SD * playersSd / outcomeSd;
  return { big: 100 * normalCdf(z + shift), quiet: 100 * normalCdf(z - shift) };
}
const keyNames = side => (side.key?.length ? side.key : side.list).map(p => lastName(p.name)).join(", ");
const proj = side => side.rest > 0 ? ` (proj ${money(side.rest)} more)` : "";
// Big night minus quiet night, in percentage points: below this a storyline can't really move.
const MIN_MOVE = 10;
const moves = odds => odds ? Math.abs(odds.big - odds.quiet) : 0;
// Genuinely undecided (Jim, 2026-11-09): a matchup between 15% and 85%; a ticket race or chop whose favorite is under 90%.
const undecided = p => Number(p) >= 15 && Number(p) <= 85;
const DECIDED = 90;

// 🎬 Game script (Jim, 2026-11-09): how each way a night game could go moves the league. A romp lifts the
// winner's players and D/ST and sinks the loser's; a shootout lifts every offense and sinks both D/STs;
// a defensive battle does the reverse (kickers sit out). Each player in the script moves HALF_MEAN_SD of their
// spread, the same size as a "big night".
const SCRIPT_MOVES = 3;
function scriptSign(p, scenario) {
  const team = Number(p.proTeamId), dst = p.pos === "D/ST";
  if (scenario.romp != null) return team === scenario.romp ? 1 : -1;
  if (scenario.shootout) return dst ? -1 : 1;
  return dst ? 1 : p.pos === "K" ? 0 : -1;
}
// A side's points shift (in points) if game g goes this way.
const shiftOf = (players, g, scenario) => {
  const side = tonight(players, new Set(g.teamIds.map(Number)), [g]);
  return HALF_MEAN_SD * side.list.reduce((sum, p, i) => sum + scriptSign(p, scenario) * side.outlook[i].sd, 0);
};
const move = (from, z) => ({ from, to: 100 * normalCdf(normalQuantile(Math.min(0.9999, Math.max(0.0001, from / 100))) + z) });
const nick = t => TEAM_NAMES[nflAbbrev(t.abbrev)] || t.abbrev;
// chance: how likely each script is, so the needles visit the likely ones more often (Jim, 2026-11-09). A romp is
// winning by 14+, from the team's win chance with an NFL margin SD of about 13.5; a shootout or a defensive
// battle (10+ points off the total either way) about 20% each.
const MARGIN_SD = 13.5, ROMP_BY = 14, TOTAL_SCRIPT_CHANCE = 0.2;
const rompChance = t => {
  const w = Number(t.winChance);
  if (!(w > 0 && w < 1)) return TOTAL_SCRIPT_CHANCE;
  return 1 - normalCdf((ROMP_BY - MARGIN_SD * normalQuantile(w)) / MARGIN_SD);
};
// key: what the needles sync on (Needle.jsx); labels can repeat across games, keys can't.
const scenariosFor = g => {
  if ((g.teams || []).length < 2 || g.completed) return [];
  const game = g.teams.map(nick).join("–");
  return [
    ...g.teams.map(t => ({ label: `${nick(t)} romp`, peek: `🎬 if the ${nick(t)} romp`, key: `${g.id}-romp-${t.id}`, romp: Number(t.id), chance: rompChance(t) })),
    { label: "Shootout", peek: `🎬 if ${game} is a shootout`, key: `${g.id}-shootout`, shootout: true, chance: TOTAL_SCRIPT_CHANCE },
    { label: "Defensive battle", peek: `🎬 if ${game} is a defensive battle`, key: `${g.id}-defense`, defense: true, chance: TOTAL_SCRIPT_CHANCE }
  ];
};
function gameScripts({ slot, scores, byId, guillotine, open }) {
  const out = [];
  for (const g of slot) {
    for (const sc of scenariosFor(g)) {
      const items = [];
      const seen = new Set();
      for (const a of scores) {
        const b = byId.get(a.opponentId);
        if (!b || seen.has(a.matchupId) || !undecided(a.winProbability)) continue;
        seen.add(a.matchupId);
        const marginSd = Math.hypot(Number(a.projectionSd) || 0, Number(b.projectionSd) || 0);
        if (!(marginSd > 0)) continue;
        const m = move(Number(a.winProbability), (shiftOf(a.lineup?.starters, g, sc) - shiftOf(b.lineup?.starters, g, sc)) / marginSd);
        // Name whichever side it helps.
        items.push(m.to >= m.from ? { label: a.team, text: `${pct(m.from)} → ${pct(m.to)}`, size: m.to - m.from }
          : { label: b.team, text: `${pct(100 - m.from)} → ${pct(100 - m.to)}`, size: m.from - m.to });
      }
      for (const s of scores) {
        if (!open(s.aboveMedianProbability) || !(Number(s.projectionSd) > 0)) continue;
        const m = move(Number(s.aboveMedianProbability), shiftOf(s.lineup?.starters, g, sc) / Number(s.projectionSd));
        // Medians rank behind matchups and the chop.
        items.push({ label: `${s.team} median`, text: `${pct(m.from)} → ${pct(m.to)}`, size: Math.abs(m.to - m.from), rank: 0.6 });
      }
      // The chop: the likeliest victim's shift against the other teams still in danger (5%+).
      const danger = (guillotine?.teams || []).filter(t => open(t.chopProbability) && Number(t.chopProbability) >= 5 && Number(t.projectionSd) > 0)
        .sort((x, y) => y.chopProbability - x.chopProbability);
      if (danger.length > 1 && Number(danger[0].chopProbability) < DECIDED) {
        const [t, ...others] = danger;
        const rel = shiftOf(t.lineup, g, sc) - others.reduce((sum, o) => sum + shiftOf(o.lineup, g, sc), 0) / others.length;
        const sd = Math.hypot(Number(t.projectionSd), others.reduce((sum, o) => sum + Number(o.projectionSd), 0) / others.length);
        const m = move(Number(t.chopProbability), -rel / sd);
        items.push({ label: `🪓 ${t.team} chop`, text: `${pct(m.from)} → ${pct(m.to)}`, size: Math.abs(m.to - m.from) });
      }
      const big = items.filter(x => x.size >= MIN_MOVE).sort((x, y) => y.size * (y.rank || 1) - x.size * (x.rank || 1));
      if (big.length) out.push({ head: sc.label, bullets: big.slice(0, SCRIPT_MOVES).map(({ label, text }) => ({ label, text })), weight: big.reduce((s, x) => s + x.size, 0) });
    }
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 4);
}

export function primetimeStories({ scores, nflGames, guillotine }) {
  const slot = nightSlot(nflGames || []);
  if (!slot.length) return null;
  const label = slotLabel(slot[0]);
  const games = slot.map(g => g.name).join(" & ");
  const byId = new Map(scores.map(s => [s.teamId, s]));
  const open = p => Number(p) > 0 && Number(p) < 100;

  const script = gameScripts({ slot, scores, byId, guillotine, open });
  if (!script.length) return null;
  return { label, games, slot, script };
}

// When the needles dance together (Needle.jsx sync): nothing is live and games are still to come (Jim, 2026-11-09:
// "between TNF and kickoff on Sunday"), or a standalone game (night, international morning) is the only thing on.
export function loneNightGame(nflGames) {
  const games = nflGames || [];
  const live = games.filter(g => g.state === "in");
  if (!live.length) return games.some(g => g.state === "pre");
  return live.length === 1 && standalone(live[0], games);
}
export const syncPeeks = (peeks, on) => on ? peeks.map(pk => ({ ...pk, sync: true })) : peeks;

// Tonight's night game, if one is live or kicks off within 30 hours: what the stakes and peeks below need.
function nightContext(scores, nflGames) {
  const slot = nightSlot(nflGames || []);
  if (!slot.length) return null;
  return { slot, gameTeams: new Set(slot.flatMap(g => g.teamIds || []).map(Number)), label: slotLabel(slot[0]),
    byId: new Map(scores.map(s => [s.teamId, s])) };
}

// What's at stake tonight for one team, shown right under its matchup (Jim, 2026-11-09: "right where you need
// them"): its players in the night game and a bullet for each stake (head to head, median, ticket) after a big
// or quiet night. Only for a genuinely undecided matchup or ticket race (a median alone doesn't count), and
// only stakes a big or quiet night moves MIN_MOVE+ points.
export function nightStakes({ scores, nflGames, team: s }) {
  const ctx = nightContext(scores, nflGames);
  if (!ctx) return null;
  const { slot, gameTeams, label, byId } = ctx;
  const opp = byId.get(s.opponentId);
  const mine = tonight(s.lineup?.starters, gameTeams, slot), theirs = tonight(opp?.lineup?.starters, gameTeams, slot);
  if (!mine.list.length) return null;
  const stakes = [];
  if (opp && undecided(s.winProbability)) {
    const odds = bigQuiet(Number(s.winProbability), mine.sd, Math.hypot(Number(s.projectionSd) || 0, Number(opp.projectionSd) || 0));
    const needs = !theirs.list.length && Number(opp.startersLeft) === 0 && Number(s.score) < Number(opp.score)
      ? ` · needs ${money(Number(opp.score) - Number(s.score))}` : "";
    if (moves(odds) >= MIN_MOVE) stakes.push({ label: `Win ${pct(s.winProbability)}`, odds, extra: needs });
  }
  if (Number(s.aboveMedianProbability) >= 10 && Number(s.aboveMedianProbability) <= 90) {
    const odds = bigQuiet(Number(s.aboveMedianProbability), mine.sd, Number(s.projectionSd));
    if (moves(odds) >= MIN_MOVE) stakes.push({ label: `Median ${pct(s.aboveMedianProbability)}`, odds, median: true });
  }
  const ticketOpen = Math.max(...scores.map(x => Number(x.topScoreProbability) || 0)) < DECIDED;
  if (ticketOpen && Number(s.topScoreProbability) >= 10) {
    const odds = bigQuiet(Number(s.topScoreProbability), mine.sd, Number(s.projectionSd));
    if (moves(odds) >= MIN_MOVE) stakes.push({ label: `🎟️ Ticket ${pct(s.topScoreProbability)}`, odds });
  }
  if (!stakes.some(x => !x.median)) return null;
  return { label, team: s.team, play: `${keyNames(mine)}${proj(mine)}`,
    bullets: stakes.map(x => ({ label: x.label, text: `big night ${pct(x.odds.big)} · quiet ${pct(x.odds.quiet)}${x.extra || ""}` })) };
}

// The needles dance with what's to come while nothing is live (Jim, 2026-11-09): peeks (tdPeeks.js shape, with
// pregame: true so the needle visits them before kickoff) at the team's odds if its key players have a big or a
// quiet game, if the opponent's do, and under each upcoming game's script. Over a whole Sunday slate, only the
// PEEKS_KEPT that matter most (the move times how likely it is). kind: "win" (the team's win odds) or
// "median". Live, the touchdown peeks take over.
// A player's big (or quiet) game: the top (or bottom) third or so of his outcomes.
const NIGHT_PLAYER_CHANCE = 0.3, PEEKS_KEPT = 10;
export function nightPeeks({ scores, nflGames, team: s, kind }) {
  const games = nflGames || [];
  if (games.some(g => g.state === "in")) return [];
  const slot = games.filter(g => g.state === "pre");
  if (!slot.length) return [];
  const gameTeams = new Set(slot.flatMap(g => g.teamIds || []).map(Number));
  const opp = kind === "win" ? scores.find(x => x.teamId === s.opponentId) : null;
  const p = Number(kind === "win" ? s.winProbability : s.aboveMedianProbability);
  if (!(p > 0 && p < 100) || (kind === "win" && !opp)) return [];
  const sd = kind === "win" ? Math.hypot(Number(s.projectionSd) || 0, Number(opp.projectionSd) || 0) : Number(s.projectionSd);
  if (!(sd > 0)) return [];
  const peeks = [];
  const add = (key, label, to, chance = NIGHT_PLAYER_CHANCE, pts) => { if (Number.isFinite(to) && Math.abs(to - p) >= MIN_MOVE / 2) peeks.push({ key, label, p: to, chance, pregame: true, pts }); };
  // One pair per key player: "🌙 big night from J. Allen" (a night game) or "☀️ big day from …".
  const players = (side, direction) => {
    for (const pl of side.key) {
      const plSd = side.outlook[side.list.indexOf(pl)].sd;
      const odds = bigQuiet(p, plSd, sd, direction);
      const name = /D\/ST/.test(pl.name) ? `the ${pl.name}` : pl.name;
      const g = slot.find(x => (x.teamIds || []).map(Number).includes(Number(pl.proTeamId)));
      const [icon, when] = g && etHour(g.kickoff) >= PRIMETIME_HOUR ? ["🌙", "night"] : ["☀️", "day"];
      add(`${pl.id}-big`, `${icon} big ${when} from ${name}`, odds?.big, NIGHT_PLAYER_CHANCE, direction * HALF_MEAN_SD * plSd);
      add(`${pl.id}-quiet`, `${icon} quiet ${when} from ${name}`, odds?.quiet, NIGHT_PLAYER_CHANCE, -direction * HALF_MEAN_SD * plSd);
    }
  };
  players(tonight(s.lineup?.starters, gameTeams, slot), 1);
  if (opp) players(tonight(opp.lineup?.starters, gameTeams, slot), -1);
  const involved = new Set([...(s.lineup?.starters || []), ...(opp?.lineup?.starters || [])].map(x => Number(x.proTeamId)));
  for (const g of slot) {
    if (!(g.teamIds || []).some(t => involved.has(Number(t)))) continue;
    for (const sc of scenariosFor(g)) {
      const shift = shiftOf(s.lineup?.starters, g, sc) - (opp ? shiftOf(opp.lineup?.starters, g, sc) : 0);
      if (shift) add(sc.key, sc.peek, move(p, shift / sd).to, sc.chance);
    }
  }
  return peeks.sort((x, y) => Math.abs(y.p - p) * y.chance - Math.abs(x.p - p) * x.chance).slice(0, PEEKS_KEPT);
}

// Survivor pool lines for tonight. Picks come from the survivor feed, which
// only carries picks that locked at kickoff, so before kickoff the panel
// just says they're coming.
const nflAbbrev = a => ({ WSH: "WAS", JAC: "JAX", LA: "LAR" }[String(a || "").toUpperCase()] || String(a || "").toUpperCase());
export function survivorStory(feed, slot, week) {
  const c = feed?.contest;
  // A pool down to one entry is decided (Jim, 2026-11-09).
  if (!c || !c.totalEntries || Number(c.alive) <= 1) return null;
  const entries = feed.entries || [];
  const items = [];
  const total = Number(c.totalEntries);
  items.push({ head: `${c.alive} of ${total} entries still standing (${pct(c.alive / total * 100)})`, detail: [] });

  // This week's most popular picks so far (locked ones), and how they're faring.
  const wk = (feed.weeks || []).find(w => Number(w.week) === week && w.locked);
  // Every pick this week already settled and none hidden: nothing rides on tonight.
  if (wk?.picks?.length && !wk.hidden && wk.picks.every(p => p.result !== "pending")) return null;
  if (wk?.picks?.length) {
    const mark = r => r === "won" ? "✓" : r === "lost" ? "✗" : "⏳";
    const top = [...wk.picks].sort((a, b) => b.count - a.count).slice(0, 3);
    const locked = wk.picks.reduce((sum, p) => sum + p.count, 0);
    const decided = wk.picks.filter(p => p.result !== "pending");
    const won = decided.filter(p => p.result === "won").reduce((sum, p) => sum + p.count, 0);
    const lost = decided.filter(p => p.result === "lost").reduce((sum, p) => sum + p.count, 0);
    items.push({
      head: `Week ${week} top picks: ${top.map(p => `${p.team} ${p.count} ${mark(p.result)}`).join(" · ")}`,
      detail: [`${locked} picks locked so far${won + lost ? `; ${won} survived, ${lost} knocked out (${pct(won / (won + lost) * 100)} survival)` : ""}${wk.hidden ? ` · ${wk.hidden} still hidden` : ""}.`]
    });
  }

  let pending = false, anyRiding = false;
  for (const g of slot) {
    const teams = (g.teams || []).map(t => nflAbbrev(t.abbrev));
    if (teams.length < 2) continue;
    const name = t => TEAM_NAMES[t] || t;
    // Picks stay hidden until kickoff.
    if (g.state === "pre") { pending = true; continue; }
    const sides = teams.map(t => {
      const on = entries.filter(e => e.picks?.[week]?.team === t);
      const users = new Map();
      for (const e of on) users.set(e.user, (users.get(e.user) || 0) + 1);
      return { t, on, who: [...users].map(([u, n]) => n > 1 ? `${u} ×${n}` : u).join(", "), result: on[0]?.picks?.[week]?.result };
    });
    const riding = sides.reduce((sum, x) => sum + x.on.length, 0);
    if (!riding) continue;
    anyRiding = true;
    items.push({
      head: `${riding} ${riding === 1 ? "entry rides" : "entries ride"} on ${g.name || teams.join(" vs ")}`,
      detail: sides.filter(x => x.on.length).map(x => `${name(x.t)} (${x.on.length}${x.result === "won" ? " ✓ survived" : x.result === "lost" ? " ✗ out" : ""}): ${x.who}`)
    });
  }

  // Nothing rides on tonight: leave the pool out.
  if (!pending && !anyRiding) return null;
  const byUser = new Map();
  for (const e of entries) if (e.alive) byUser.set(e.user, (byUser.get(e.user) || 0) + 1);
  const ranked = [...byUser].sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const top = ranked.filter(([, n]) => n === ranked[0][1]).map(([u]) => u);
    items.push({ head: `Most entries left: ${top.join(", ")} (${ranked[0][1]})`, detail: [] });
  }
  return items;
}

// Plain-text lines for the panel and the share card.
const lines = st => ({ script: st.script || [], survivor: st.survivor || [] });

const SECTIONS = [["script", "🎬 Game script"], ["survivor", "🛡️ Survivor pool"]];
// One item's lines, for the share card.
const itemLines = item => [item.play && `In play: ${item.play}`, ...(item.bullets || []).map(b => `• ${b.label}: ${b.text}`),
  item.root && `Root against: ${item.root}`, ...(item.detail || [])].filter(Boolean);

export default function PrimetimeWatch({ scores, nflGames, guillotine, logos, week }) {
  // Starts collapsed to a one-line summary; the share image is always full.
  const [open, setOpen] = useState(false);
  const { feed } = useSurvivorFeed();
  const base = primetimeStories({ scores, nflGames, guillotine });
  const slot = base?.slot || nightSlot(nflGames || []);
  const survivor = slot.length ? survivorStory(feed, slot, Number(week)) : null;
  if (!base && !survivor) return null;
  const st = base || { label: slotLabel(slot[0]), games: slot.map(g => g.name).join(" & "), slot,
    script: [] };
  st.survivor = survivor;
  const text = lines(st);
  const when = st.slot[0].state === "in" ? "live now" : new Date(st.slot[0].kickoff).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const share = () => ({
    kicker: `Week ${week} · ${st.label} What to Watch`,
    title: `${st.label}: ${st.games}`,
    lines: SECTIONS.flatMap(([key, title]) => text[key].length ? [
      { text: title, size: 28, color: "accent", weight: 800, gap: 26 },
      ...text[key].flatMap(item => [{ text: item.head, size: 24, color: "ink", weight: 800, gap: 10 }, ...itemLines(item).map(d => ({ text: d, size: 21, gap: 2 }))])
    ] : [])
  });
  return (
    <section id="primetime" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">{st.games} · {when}</span><h2>{st.label} What to Watch</h2></div>
        <ShareButton section="primetime" iconOnly label={`Share the ${st.label} What to Watch`} filename={`week-${week}-${st.label.toLowerCase()}-what-to-watch`} build={share} />
      </div>
      <div className="primetime-summary">
        <span>{[
          text.script.length && "game script",
          text.survivor.length && "survivor pool"
        ].filter(Boolean).join(" · ")}</span>
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "Hide ▴" : "Show ▾"}</button>
      </div>
      {open ? <div className="primetime-grid">
        {SECTIONS.map(([key, title]) => text[key].length ? <div className="primetime-card" key={key}>
          <h3>{title}</h3>
          {text[key].map((item, i) => <div className="primetime-item" key={i}>
            <b>{item.head}</b>
            {item.play ? <p className="primetime-play"><span>In play</span> {item.play}</p> : null}
            {item.bullets?.length ? <ul>{item.bullets.map((x, j) => <li key={j}><span>{x.label}</span> {x.text}</li>)}</ul> : null}
            {item.root ? <p className="primetime-root"><span>Root against</span> {item.root}</p> : null}
            {(item.detail || []).map((d, j) => <p key={j}>{d}</p>)}
          </div>)}
        </div> : null)}
      </div> : null}
    </section>
  );
}
