import React, { useState } from "react";
import { money, pct } from "../lib/data.js";
import { HALF_MEAN_SD, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";
import { ShareButton } from "./LiveBits.jsx";
import { hasObituary } from "./DeathWatch.jsx";
import { TEAM_NAMES, useSurvivorFeed } from "./SurvivorTab.jsx";

// TNF / SNF / MNF What to Watch: every storyline the night game(s) can still
// swing, as one shareable panel. Shown while a night game (7 PM ET or later)
// is live or kicks off within 30 hours.
// - What's at stake, by team (Jim, 2026-11-09): its players in play, bullets for each stake (head to head,
//   median, ticket, chop) after a big or quiet night, and whom to root against. Anything a big or quiet
//   night moves less than MIN_MOVE points is left out.
// - Game script: what a romp, a shootout or a defensive battle would do to the league's odds.
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
      if (danger.length > 1) {
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
  const gameTeams = new Set(slot.flatMap(g => g.teamIds || []).map(Number));
  const label = SLOT_NAMES[etDay(slot[0].kickoff)] || "Primetime";
  const games = slot.map(g => g.name).join(" & ");
  const byId = new Map(scores.map(s => [s.teamId, s]));
  const open = p => Number(p) > 0 && Number(p) < 100;

  // By team (Jim, 2026-11-09): each team with something tonight can still swing 10+ points, its players in
  // play, the stakes (head to head, median, ticket, chop) after a big or quiet night, and whom to root against.
  // A team with nobody playing is left out: its opponent's card already has that matchup.
  const leader = [...scores].sort((x, y) => Number(y.score) - Number(x.score))[0];
  const raffleLocked = scores.find(s => Number(s.topScoreProbability) >= 100) || null;
  const ticketOpen = !raffleLocked && Number(leader?.topScoreProbability) < 99;
  const teams = [];
  for (const s of scores) {
    const opp = byId.get(s.opponentId);
    const mine = tonight(s.lineup?.starters, gameTeams, slot), theirs = tonight(opp?.lineup?.starters, gameTeams, slot);
    const stakes = [];
    if (!mine.list.length) continue;
    if (opp && open(s.winProbability)) {
      const marginSd = Math.hypot(Number(s.projectionSd) || 0, Number(opp.projectionSd) || 0);
      const odds = bigQuiet(Number(s.winProbability), mine.sd, marginSd);
      const needs = !theirs.list.length && Number(opp.startersLeft) === 0 && Number(s.score) < Number(opp.score)
        ? ` · needs ${money(Number(opp.score) - Number(s.score))}` : "";
      if (moves(odds) >= MIN_MOVE) stakes.push({ label: `vs ${opp.team}`, now: s.winProbability, odds, extra: needs });
    }
    if (open(s.aboveMedianProbability)) {
      const odds = bigQuiet(Number(s.aboveMedianProbability), mine.sd, Number(s.projectionSd));
      if (moves(odds) >= MIN_MOVE) stakes.push({ label: "Median", now: s.aboveMedianProbability, odds });
    }
    if (ticketOpen && open(s.topScoreProbability) && Number(s.topScoreProbability) >= 1) {
      const odds = bigQuiet(Number(s.topScoreProbability), mine.sd, Number(s.projectionSd));
      if (moves(odds) >= MIN_MOVE) stakes.push({ label: "🎟️ Ticket", now: s.topScoreProbability, odds });
    }
    if (!stakes.length) continue;
    teams.push({ team: s.team, mine, root: stakes.some(x => x.label.startsWith("vs ")) ? theirs : null, stakes,
      weight: Math.max(...stakes.map(x => moves(x.odds))) });
  }
  // The guillotine league: the chop for each team in danger, rooting against the other teams in danger.
  const doomed = (guillotine?.teams || []).find(t => Number(t.chopProbability) >= 100) || null;
  const danger = doomed || !Number(guillotine?.week) ? [] : (guillotine.teams || []).filter(t => open(t.chopProbability) && Number(t.chopProbability) >= 5);
  for (const t of danger) {
    const mine = tonight(t.lineup, gameTeams, slot);
    if (!mine.list.length) continue;
    const swing = (t.gameSwings || []).find(g => slot.some(x => x.name === g.game));
    const odds = swing ? { big: swing.chopIfAbove, quiet: swing.chopIfBelow } : bigQuiet(Number(t.chopProbability), mine.sd, Number(t.projectionSd), -1);
    if (moves(odds) < MIN_MOVE) continue;
    const rivals = danger.filter(o => o !== t).map(o => tonight(o.lineup, gameTeams, slot));
    const root = { list: rivals.flatMap(r => r.list), key: rivals.flatMap(r => r.key) };
    teams.push({ team: `🪓 ${t.team}`, mine, root: root.list.length ? root : null, stakes: [{ label: "Chop", now: t.chopProbability, odds }], weight: moves(odds) });
  }
  teams.sort((x, y) => y.weight - x.weight);
  const script = gameScripts({ slot, scores, byId, guillotine, open });
  if (!teams.length && !script.length && !raffleLocked && !doomed) return null;
  return { label, games, slot, teams: teams.slice(0, 10), script, raffleLocked, doomed };
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
  const out = { script: st.script || [], teams: [], locked: [], survivor: st.survivor || [] };
  for (const t of st.teams) {
    // "vs Ramosverse 29%: big night 59% · quiet 9%"
    const bullets = t.stakes.map(x => ({ label: `${x.label} ${pct(x.now)}`, text: `big night ${pct(x.odds.big)} · quiet ${pct(x.odds.quiet)}${x.extra || ""}` }));
    out.teams.push({ head: t.team, play: `${keyNames(t.mine)}${proj(t.mine)}`, bullets, root: t.root?.list.length ? keyNames(t.root) : null });
  }
  if (st.raffleLocked) out.locked.push({ head: `🎟️ ${st.raffleLocked.team} has clinched the ticket with ${money(st.raffleLocked.score)} pts` });
  if (st.doomed) {
    const written = hasObituary(st.doomed.team);
    out.locked.push({ head: `🪓 ${st.doomed.team} is doomed: chop guaranteed with ${money(st.doomed.score)} pts`, play: written ? null : "Obituary pending.", rip: written });
  }
  return out;
}

// RIP lives on the Death Watch tab: the hash switches tabs, then open it.
const openRip = () => setTimeout(() => { const d = document.getElementById("rip"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }, 150);

const SECTIONS = [["locked", "🔒 Locked"], ["teams", "📺 What's at stake"], ["script", "🎬 Game script"], ["survivor", "🛡️ Survivor pool"]];
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
  const st = base || { label: SLOT_NAMES[etDay(slot[0].kickoff)] || "Primetime", games: slot.map(g => g.name).join(" & "), slot,
    teams: [], script: [] };
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
          text.teams.length && `${text.teams.length} ${text.teams.length === 1 ? "team" : "teams"} with stakes`,
          text.script.length && "game script",
          st.raffleLocked && "ticket clinched",
          st.doomed && "chop decided",
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
            {item.rip ? <a className="primetime-rip" href="#rip" onClick={openRip}>🪦 Read the obituary</a> : null}
          </div>)}
        </div> : null)}
      </div> : null}
    </section>
  );
}
