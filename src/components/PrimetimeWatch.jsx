import React, { useState } from "react";
import { money } from "../lib/data.js";
import { HALF_MEAN_SD, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";
import { ShareButton } from "./LiveBits.jsx";
import { hasObituary } from "./DeathWatch.jsx";

// TNF / SNF / MNF What to Watch: every storyline the night game(s) can still
// swing, as one shareable panel. Shown while a night game (7 PM ET or later)
// is live or kicks off within 30 hours.
// - Head-to-head: TNF ranks matchups by how much is up for grabs; SNF/MNF
//   list every undecided matchup with someone playing tonight.
// - Median, ticket race and Death Watch: undecided teams with players tonight.
// Big night / quiet night odds use the same normal approximation as the
// server's swing stories: each side's players add about 0.8 SD of their
// points in a big game and lose it in a quiet one.
const PRIMETIME_HOUR = 19;
const AHEAD_MS = 30 * 60 * 60 * 1000;
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, "D/ST": 16 };
const MIN_SWING = 2;

const etHour = iso => Number(new Date(iso).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
const etDay = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
const SLOT_NAMES = { Thu: "TNF", Sun: "SNF", Mon: "MNF" };
const lastName = n => /D\/ST/.test(n) ? n : n.split(" ").slice(1).join(" ") || n;
const pct = p => Math.round(p) + "%";

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
function tonight(players, gameTeams) {
  const list = (players || []).filter(p => gameTeams.has(Number(p.proTeamId)));
  const outlook = list.map(p => playerOutlook({ actual: p.actual, projection: p.projection, positionId: POSITION_IDS[p.pos] }));
  return {
    list,
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
const proj = side => side.rest > 0 ? ` (proj ${money(side.rest)} more)` : "";

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
    const sa = tonight(a.lineup?.starters, gameTeams), sb = tonight(b.lineup?.starters, gameTeams);
    if (!sa.list.length && !sb.list.length) continue;
    const marginSd = Math.hypot(Number(a.projectionSd) || 0, Number(b.projectionSd) || 0);
    const [fav, dog] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
    const sides = [[a, sa], [b, sb]].filter(([, s]) => s.list.length).map(([team, s]) => {
      const odds = bigQuiet(Number(team.winProbability), s.sd, marginSd);
      return { team, s, odds };
    });
    // Down to one side: what the trailing team needs.
    const trailing = Number(a.score) < Number(b.score) ? [a, sa, b, sb] : [b, sb, a, sa];
    const needs = !trailing[3].list.length && trailing[1].list.length && Number(trailing[2].startersLeft) === 0
      ? `${trailing[0].team} needs ${money(Number(trailing[2].score) - Number(trailing[0].score))} from ${names(trailing[1])}${proj(trailing[1])}.` : null;
    const upForGrabs = Math.max(...sides.map(x => x.odds ? x.odds.big - x.odds.quiet : 0));
    h2h.push({ a, b, fav, dog, sides, needs, upForGrabs });
  }
  const isTnf = label === "TNF";
  h2h.sort((x, y) => isTnf ? y.upForGrabs - x.upForGrabs : Math.abs(Number(x.a.winProbability) - 50) - Math.abs(Number(y.a.winProbability) - 50));
  const matchups = (isTnf ? h2h.filter(m => m.upForGrabs >= MIN_SWING) : h2h).slice(0, 6);

  // Median races.
  const median = scores.filter(s => open(s.aboveMedianProbability)).map(s => {
    const side = tonight(s.lineup?.starters, gameTeams);
    return side.list.length ? { s, side, odds: bigQuiet(Number(s.aboveMedianProbability), side.sd, Number(s.projectionSd)) } : null;
  }).filter(Boolean).sort((x, y) => Math.abs(Number(x.s.aboveMedianProbability) - 50) - Math.abs(Number(y.s.aboveMedianProbability) - 50)).slice(0, 5);

  // Ticket race: the leader, and everyone who can still catch them; or who
  // has already clinched it.
  const leader = [...scores].sort((x, y) => Number(y.score) - Number(x.score))[0];
  const raffleLocked = scores.find(s => Number(s.topScoreProbability) >= 100) || null;
  const raffle = raffleLocked ? [] : scores.filter(s => open(s.topScoreProbability) && (Number(s.topScoreProbability) >= 1 || s === leader)).map(s => ({ s, side: tonight(s.lineup?.starters, gameTeams) }))
    .filter(x => x.side.list.length || x.s === leader).sort((x, y) => Number(y.s.topScoreProbability) - Number(x.s.topScoreProbability)).slice(0, 4);

  // Death Watch: still in danger with players tonight; or already doomed.
  const doomed = (guillotine?.teams || []).find(t => Number(t.chopProbability) >= 100) || null;
  const death = doomed ? [] : Number(guillotine?.week) && (guillotine.teams || []).filter(t => open(t.chopProbability)).map(t => {
    const side = tonight(t.lineup, gameTeams);
    if (!side.list.length) return null;
    const swing = (t.gameSwings || []).find(g => slot.some(s => s.name === g.game));
    return { t, side, swing };
  }).filter(Boolean).sort((x, y) => y.t.chopProbability - x.t.chopProbability).slice(0, 4) || [];

  if (!matchups.length && !median.length && !raffle.length && !death.length && !raffleLocked && !doomed) return null;
  return { label, games, slot, matchups, median, raffle, death, leader, raffleLocked, doomed };
}

// Plain-text lines for the panel and the share card.
function lines(st) {
  const out = { h2h: [], median: [], raffle: [], death: [] };
  for (const m of st.matchups) {
    const head = `${m.fav.team} ${pct(m.fav.winProbability)} vs ${m.dog.team} (${money(m.fav.score)}–${money(m.dog.score)})`;
    const detail = m.needs ? [m.needs] : m.sides.map(({ team, s, odds }) =>
      `${names(s)} for ${team.team}${proj(s)}${odds ? `: big night → ${team.team.split(" ")[0]} ${pct(odds.big)}, quiet → ${pct(odds.quiet)}` : ""}`);
    out.h2h.push({ head, detail });
  }
  for (const { s, side, odds } of st.median) {
    out.median.push({ head: `${s.team} · ${pct(s.aboveMedianProbability)} to beat the median`, detail: [`${names(side)}${proj(side)}${odds ? `: big night → ${pct(odds.big)}, quiet → ${pct(odds.quiet)}` : ""}`] });
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
    out.death.push({ head: `${t.team} · ${pct(t.chopProbability)} chop odds`, detail: [`${names(side)}${proj(side)}${swing ? `: big night → ${pct(swing.chopIfAbove)}, quiet → ${pct(swing.chopIfBelow)}` : ""}`] });
  }
  return out;
}

// RIP lives on the Death Watch tab: the hash switches tabs, then open it.
const openRip = () => setTimeout(() => { const d = document.getElementById("rip"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }, 150);

const SECTIONS = [["h2h", "⚔️ Head to head"], ["median", "🎯 Median races"], ["raffle", "🎟️ Ticket race"], ["death", "🪓 Death Watch"]];

export default function PrimetimeWatch({ scores, nflGames, guillotine, logos, week }) {
  // Starts collapsed to a one-line summary; the share image is always full.
  const [open, setOpen] = useState(false);
  const st = primetimeStories({ scores, nflGames, guillotine });
  if (!st) return null;
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
          text.h2h.length && `${text.h2h.length} ${text.h2h.length === 1 ? "matchup" : "matchups"}`,
          text.median.length && `${text.median.length} median ${text.median.length === 1 ? "race" : "races"}`,
          text.raffle.length && (st.raffleLocked ? "ticket clinched" : "ticket race"),
          text.death.length && (st.doomed ? "Death Watch decided" : "Death Watch")
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
