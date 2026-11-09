import React, { useState } from "react";
import { money, pct } from "../lib/data.js";
import { HALF_MEAN_SD, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";
import { ShareButton } from "./LiveBits.jsx";
import { hasObituary } from "./DeathWatch.jsx";
import { TEAM_NAMES, useSurvivorFeed } from "./SurvivorTab.jsx";

// TNF / SNF / MNF What to Watch: every storyline the night game(s) can still
// swing, as one shareable panel. Shown while a night game (7 PM ET or later)
// is live or kicks off within 30 hours.
// - Game script: what a romp, a shootout or a defensive battle would do to the league's odds.
// - Head-to-head: matchups ranked by how much tonight can move them, with only the players who
//   can move it and the team's median odds alongside (Jim, 2026-11-09: cut the clutter).
// - Median (teams not already under Head to head), ticket race and Death Watch: undecided teams
//   with players tonight. Head-to-head, median and Death Watch drop anything a big or quiet night
//   moves less than MIN_MOVE points.
// - Survivor pool: how many entries are left, who rode tonight's teams (picks
//   show only once the game kicks off) and who has the most entries left.
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

// The night slot to feature: live night games, else the next night slot.
function nightSlot(nflGames) {
  const night = nflGames.filter(g => g.kickoff && !g.completed && etHour(g.kickoff) >= PRIMETIME_HOUR);
  const live = night.filter(g => g.state === "in");
  if (live.length) return live;
  const upcoming = night.filter(g => g.state === "pre" && Date.parse(g.kickoff) - Date.now() <= AHEAD_MS).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (!upcoming.length) return [];
  const first = Date.parse(upcoming[0].kickoff);
  return upcoming.filter(g => Date.parse(g.kickoff) - first <= 60 * 60 * 1000);
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
const names = side => side.list.map(p => lastName(p.name)).join(", ");
const keyNames = side => (side.key?.length ? side.key : side.list).map(p => lastName(p.name)).join(", ");
const proj = side => side.rest > 0 ? ` (proj ${money(side.rest)} more)` : "";
// Big night minus quiet night, in percentage points: below this a storyline can't really move.
const MIN_MOVE = 10;
const moves = odds => odds ? Math.abs(odds.big - odds.quiet) : 0;

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
function gameScripts({ slot, scores, byId, guillotine, open }) {
  const out = [];
  const shiftOf = (players, games, scenario) => {
    const side = tonight(players, new Set(games.teamIds.map(Number)), [games]);
    return HALF_MEAN_SD * side.list.reduce((sum, p, i) => sum + scriptSign(p, scenario) * side.outlook[i].sd, 0);
  };
  const move = (from, z) => ({ from, to: 100 * normalCdf(normalQuantile(Math.min(0.9999, Math.max(0.0001, from / 100))) + z) });
  for (const g of slot) {
    const teams = g.teams || [];
    if (teams.length < 2 || g.completed) continue;
    const nick = t => TEAM_NAMES[nflAbbrev(t.abbrev)] || t.abbrev;
    const scenarios = [
      ...teams.map(t => ({ label: `${nick(t)} romp`, romp: Number(t.id) })),
      { label: "Shootout", shootout: true },
      { label: "Defensive battle", defense: true }
    ];
    for (const sc of scenarios) {
      const items = [];
      const seen = new Set();
      for (const a of scores) {
        const b = byId.get(a.opponentId);
        if (!b || seen.has(a.matchupId) || !open(a.winProbability)) continue;
        seen.add(a.matchupId);
        const marginSd = Math.hypot(Number(a.projectionSd) || 0, Number(b.projectionSd) || 0);
        if (!(marginSd > 0)) continue;
        const m = move(Number(a.winProbability), (shiftOf(a.lineup?.starters, g, sc) - shiftOf(b.lineup?.starters, g, sc)) / marginSd);
        // Name whichever side it helps.
        items.push(m.to >= m.from ? { text: `${a.team} ${pct(m.from)}→${pct(m.to)}`, size: m.to - m.from }
          : { text: `${b.team} ${pct(100 - m.from)}→${pct(100 - m.to)}`, size: m.from - m.to });
      }
      for (const s of scores) {
        if (!open(s.aboveMedianProbability) || !(Number(s.projectionSd) > 0)) continue;
        const m = move(Number(s.aboveMedianProbability), shiftOf(s.lineup?.starters, g, sc) / Number(s.projectionSd));
        // Medians rank behind matchups and the chop.
        items.push({ text: `${s.team} median ${pct(m.from)}→${pct(m.to)}`, size: Math.abs(m.to - m.from), rank: 0.6 });
      }
      // The chop: the likeliest victim's shift against the other teams still in danger (5%+).
      const danger = (guillotine?.teams || []).filter(t => open(t.chopProbability) && Number(t.chopProbability) >= 5 && Number(t.projectionSd) > 0)
        .sort((x, y) => y.chopProbability - x.chopProbability);
      if (danger.length > 1) {
        const [t, ...others] = danger;
        const rel = shiftOf(t.lineup, g, sc) - others.reduce((sum, o) => sum + shiftOf(o.lineup, g, sc), 0) / others.length;
        const sd = Math.hypot(Number(t.projectionSd), others.reduce((sum, o) => sum + Number(o.projectionSd), 0) / others.length);
        const m = move(Number(t.chopProbability), -rel / sd);
        items.push({ text: `🪓 ${t.team} chop ${pct(m.from)}→${pct(m.to)}`, size: Math.abs(m.to - m.from) });
      }
      const big = items.filter(x => x.size >= MIN_MOVE).sort((x, y) => y.size * (y.rank || 1) - x.size * (x.rank || 1));
      if (big.length) out.push({ head: sc.label, detail: [big.slice(0, SCRIPT_MOVES).map(x => x.text).join(" · ")], weight: big.reduce((s, x) => s + x.size, 0) });
    }
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 4);
}

export function primetimeStories({ scores, nflGames, guillotine }) {
  const slot = nightSlot(nflGames || []);
  if (!slot.length) return null;
  const gameTeams = new Set(slot.flatMap(g => g.teamIds || []).map(Number));
  const label = SLOT_NAMES[etDay(slot[0].kickoff)] || "Primetime";
  const games = slot.map(g => g.name).join(" & ");
  const byId = new Map(scores.map(s => [s.teamId, s]));
  const open = p => Number(p) > 0 && Number(p) < 100;

  // Head-to-head.
  const seen = new Set();
  const h2h = [];
  for (const a of scores) {
    const b = byId.get(a.opponentId);
    if (!b || seen.has(a.matchupId) || !open(a.winProbability)) continue;
    seen.add(a.matchupId);
    const sa = tonight(a.lineup?.starters, gameTeams, slot), sb = tonight(b.lineup?.starters, gameTeams, slot);
    if (!sa.list.length && !sb.list.length) continue;
    const marginSd = Math.hypot(Number(a.projectionSd) || 0, Number(b.projectionSd) || 0);
    const [fav, dog] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
    // Only the sides whose players can really move it (Jim, 2026-11-09); each carries its median odds too,
    // so a team isn't listed twice.
    const sides = [[a, sa], [b, sb]].filter(([, s]) => s.list.length).map(([team, s]) => {
      const odds = bigQuiet(Number(team.winProbability), s.sd, marginSd);
      const median = open(team.aboveMedianProbability) ? bigQuiet(Number(team.aboveMedianProbability), s.sd, Number(team.projectionSd)) : null;
      return { team, s, odds, median: moves(median) >= MIN_MOVE ? median : null };
    }).filter(x => moves(x.odds) >= MIN_MOVE);
    // Down to one side: what the trailing team needs.
    const trailing = Number(a.score) < Number(b.score) ? [a, sa, b, sb] : [b, sb, a, sa];
    const needs = !trailing[3].list.length && trailing[1].list.length && Number(trailing[2].startersLeft) === 0
      ? `${trailing[0].team} needs ${money(Number(trailing[2].score) - Number(trailing[0].score))} from ${names(trailing[1])}${proj(trailing[1])}.` : null;
    if (!sides.length) continue;
    const upForGrabs = Math.max(...sides.map(x => moves(x.odds)));
    h2h.push({ a, b, fav, dog, sides, needs, upForGrabs });
  }
  // Most up for grabs first.
  h2h.sort((x, y) => y.upForGrabs - x.upForGrabs);
  const matchups = h2h.slice(0, 5);
  const shown = new Set(matchups.flatMap(m => m.sides.map(x => x.team.teamId)));

  // Median races the night can still swing, for teams not already under Head to head.
  const median = scores.filter(s => open(s.aboveMedianProbability) && !shown.has(s.teamId)).map(s => {
    const side = tonight(s.lineup?.starters, gameTeams, slot);
    return side.list.length ? { s, side, odds: bigQuiet(Number(s.aboveMedianProbability), side.sd, Number(s.projectionSd)) } : null;
  }).filter(x => x && moves(x.odds) >= MIN_MOVE).sort((x, y) => moves(y.odds) - moves(x.odds)).slice(0, 4);
  const script = gameScripts({ slot, scores, byId, guillotine, open });

  // Ticket race: the leader, and everyone who can still catch them; or who
  // has already clinched it.
  const leader = [...scores].sort((x, y) => Number(y.score) - Number(x.score))[0];
  const raffleLocked = scores.find(s => Number(s.topScoreProbability) >= 100) || null;
  // Nothing to watch once the leader is all but certain (Jim, 2026-11-09).
  const raffle = raffleLocked || Number(leader?.topScoreProbability) >= 99 ? [] : scores.filter(s => open(s.topScoreProbability) && (Number(s.topScoreProbability) >= 1 || s === leader)).map(s => ({ s, side: tonight(s.lineup?.starters, gameTeams, slot) }))
    .filter(x => x.side.list.length || x.s === leader).sort((x, y) => Number(y.s.topScoreProbability) - Number(x.s.topScoreProbability)).slice(0, 4);

  // Death Watch: still in danger with players tonight; or already doomed.
  const doomed = (guillotine?.teams || []).find(t => Number(t.chopProbability) >= 100) || null;
  const death = doomed ? [] : Number(guillotine?.week) && (guillotine.teams || []).filter(t => open(t.chopProbability)).map(t => {
    const side = tonight(t.lineup, gameTeams, slot);
    if (!side.list.length) return null;
    const swing = (t.gameSwings || []).find(g => slot.some(s => s.name === g.game));
    return { t, side, swing };
  }).filter(x => x && (x.swing ? Math.abs(x.swing.chopIfAbove - x.swing.chopIfBelow) >= MIN_MOVE : Number(x.t.chopProbability) >= 5)).sort((x, y) => y.t.chopProbability - x.t.chopProbability).slice(0, 4) || [];

  if (!matchups.length && !median.length && !raffle.length && !death.length && !script.length && !raffleLocked && !doomed) return null;
  return { label, games, slot, matchups, median, raffle, death, script, leader, raffleLocked, doomed };
}

// Survivor pool lines for tonight. Picks come from the survivor feed, which
// only carries picks that locked at kickoff, so before kickoff the panel
// just says they're coming.
const nflAbbrev = a => ({ WSH: "WAS", JAC: "JAX", LA: "LAR" }[String(a || "").toUpperCase()] || String(a || "").toUpperCase());
export function survivorStory(feed, slot, week) {
  const c = feed?.contest;
  if (!c || !c.totalEntries) return null;
  const entries = feed.entries || [];
  const items = [];
  const total = Number(c.totalEntries);
  items.push({ head: `${c.alive} of ${total} entries still standing (${pct(c.alive / total * 100)})`, detail: [] });

  // This week's most popular picks so far (locked ones), and how they're faring.
  const wk = (feed.weeks || []).find(w => Number(w.week) === week && w.locked);
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

  for (const g of slot) {
    const teams = (g.teams || []).map(t => nflAbbrev(t.abbrev));
    if (teams.length < 2) continue;
    const name = t => TEAM_NAMES[t] || t;
    if (g.state === "pre") {
      items.push({ head: `${teams.join(" vs ")}: picks revealed at kickoff`, detail: ["Who rode which side stays hidden until the game starts."] });
      continue;
    }
    const sides = teams.map(t => {
      const on = entries.filter(e => e.picks?.[week]?.team === t);
      const users = new Map();
      for (const e of on) users.set(e.user, (users.get(e.user) || 0) + 1);
      return { t, on, who: [...users].map(([u, n]) => n > 1 ? `${u} ×${n}` : u).join(", "), result: on[0]?.picks?.[week]?.result };
    });
    const riding = sides.reduce((sum, x) => sum + x.on.length, 0);
    if (!riding) { items.push({ head: `${teams.join(" vs ")}: nobody's survival rides on this one`, detail: [] }); continue; }
    items.push({
      head: `${riding} ${riding === 1 ? "entry rides" : "entries ride"} on ${g.name || teams.join(" vs ")}`,
      detail: sides.filter(x => x.on.length).map(x => `${name(x.t)} (${x.on.length}${x.result === "won" ? " ✓ survived" : x.result === "lost" ? " ✗ out" : ""}): ${x.who}`)
    });
  }

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
function lines(st) {
  const out = { script: st.script || [], h2h: [], median: [], raffle: [], death: [], survivor: st.survivor || [] };
  for (const m of st.matchups) {
    const head = `${m.fav.team} ${pct(m.fav.winProbability)} vs ${m.dog.team} (${money(m.fav.score)}–${money(m.dog.score)})`;
    // "TDsMaGee: Jefferson, Cook III · big night 59% (median 90%) · quiet 9% (33%)"
    const med = (median, k, label = "") => median ? ` (${label}${pct(median[k])})` : "";
    const detail = m.sides.map(({ team, s, odds, median }) =>
      `${team.team}: ${keyNames(s)} · big night ${pct(odds.big)}${med(median, "big", "median ")} · quiet ${pct(odds.quiet)}${med(median, "quiet")}`);
    out.h2h.push({ head, detail: m.needs ? [m.needs] : detail });
  }
  for (const { s, side, odds } of st.median) {
    out.median.push({ head: `${s.team} · ${pct(s.aboveMedianProbability)} to beat the median`, detail: [`${keyNames(side)}${proj(side)}: big night → ${pct(odds.big)}, quiet → ${pct(odds.quiet)}`] });
  }
  if (st.raffleLocked) out.raffle.push({ head: `🔒 ${st.raffleLocked.team} has clinched the ticket with ${money(st.raffleLocked.score)} pts`, detail: ["Nobody left can catch them."] });
  if (st.doomed) {
    const written = hasObituary(st.doomed.team);
    out.death.push({ head: `🔒 ${st.doomed.team} is doomed: chop guaranteed with ${money(st.doomed.score)} pts`, detail: ["Nothing tonight can save them." + (written ? "" : " Obituary pending.")], rip: written });
  }
  for (const { s, side } of st.raffle) {
    const back = Number(st.leader.score) - Number(s.score);
    out.raffle.push({ head: `${s.team} · ${pct(s.topScoreProbability)} for the ticket`, detail: [s === st.leader
      ? `Leads with ${money(s.score)}${side.list.length ? `, plus ${names(side)} tonight` : ", and nobody left to play"}`
      : `${money(back)} back with ${names(side)} tonight${proj(side)}`] });
  }
  for (const { t, side, swing } of st.death) {
    out.death.push({ head: `${t.team} · ${pct(t.chopProbability)} chop odds`, detail: [`${keyNames(side)}${proj(side)}${swing ? `: big night → ${pct(swing.chopIfAbove)}, quiet → ${pct(swing.chopIfBelow)}` : ""}`] });
  }
  return out;
}

// RIP lives on the Death Watch tab: the hash switches tabs, then open it.
const openRip = () => setTimeout(() => { const d = document.getElementById("rip"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }, 150);

const SECTIONS = [["script", "🎬 Game script"], ["h2h", "⚔️ Head to head"], ["median", "🎯 Median races"], ["raffle", "🎟️ Ticket race"], ["death", "🪓 Death Watch"], ["survivor", "🛡️ Survivor pool"]];

export default function PrimetimeWatch({ scores, nflGames, guillotine, logos, week }) {
  // Starts collapsed to a one-line summary; the share image is always full.
  const [open, setOpen] = useState(false);
  const { feed } = useSurvivorFeed();
  const base = primetimeStories({ scores, nflGames, guillotine });
  const slot = base?.slot || nightSlot(nflGames || []);
  const survivor = slot.length ? survivorStory(feed, slot, Number(week)) : null;
  if (!base && !survivor) return null;
  const st = base || { label: SLOT_NAMES[etDay(slot[0].kickoff)] || "Primetime", games: slot.map(g => g.name).join(" & "), slot,
    matchups: [], median: [], raffle: [], death: [], script: [] };
  st.survivor = survivor;
  const text = lines(st);
  const when = st.slot[0].state === "in" ? "live now" : new Date(st.slot[0].kickoff).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const share = () => ({
    kicker: `Week ${week} · ${st.label} What to Watch`,
    title: `${st.label}: ${st.games}`,
    lines: SECTIONS.flatMap(([key, title]) => text[key].length ? [
      { text: title, size: 28, color: "accent", weight: 800, gap: 26 },
      ...text[key].flatMap(item => [{ text: item.head, size: 24, color: "ink", weight: 800, gap: 10 }, ...item.detail.map(d => ({ text: d, size: 21, gap: 2 }))])
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
          text.h2h.length && `${text.h2h.length} ${text.h2h.length === 1 ? "matchup" : "matchups"}`,
          text.median.length && `${text.median.length} median ${text.median.length === 1 ? "race" : "races"}`,
          text.raffle.length && (st.raffleLocked ? "ticket clinched" : "ticket race"),
          text.death.length && (st.doomed ? "Death Watch decided" : "Death Watch"),
          text.survivor.length && "survivor pool"
        ].filter(Boolean).join(" · ")}</span>
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "Hide ▴" : "Show ▾"}</button>
      </div>
      {open ? <div className="primetime-grid">
        {SECTIONS.map(([key, title]) => text[key].length ? <div className="primetime-card" key={key}>
          <h3>{title}</h3>
          {text[key].map((item, i) => <div className="primetime-item" key={i}>
            <b>{item.head}</b>
            {item.detail.map((d, j) => <p key={j}>{d}</p>)}
            {item.rip ? <a className="primetime-rip" href="#rip" onClick={openRip}>🪦 Read the obituary</a> : null}
          </div>)}
        </div> : null)}
      </div> : null}
    </section>
  );
}
