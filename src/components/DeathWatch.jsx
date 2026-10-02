import React, { useState } from "react";
import { formatDay, money } from "../lib/data.js";
import { ShareButton, TeamLogo } from "./LiveBits.jsx";
import obituaryData from "../../data/current/obituaries.json";
import obituariesMarkdown from "../../content/obituaries.md?raw";

// Handwritten obituaries from content/obituaries.md: one "## Team name"
// section each, keyed by lowercase team name. HTML comments are notes only.
const handwrittenObituaries = new Map(
  obituariesMarkdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/^## /m)
    .slice(1)
    .map(section => {
      const [heading, ...body] = section.split("\n");
      return [heading.trim().toLowerCase(), body.join("\n").trim()];
    })
    .filter(([, text]) => text)
);

// Team logo, or the team's initials when there's no logo yet (custom ESPN
// uploads are cached by the daily update and can't be linked directly).
function DwLogo({ team, size = "sm" }) {
  if (team.logo) return <TeamLogo src={team.logo} size={size} />;
  const initials = team.team.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).slice(0, 2).map(w => w.match(/[A-Za-z0-9]/)[0]).join("").toUpperCase();
  return <span className={`inline-team-logo ${size} logo-initials`} aria-hidden="true">{initials}</span>;
}

const obituaryFor = chop => handwrittenObituaries.get(chop.team.trim().toLowerCase()) ||
  (obituaryData.obituaries || []).find(o => o.teamId === chop.teamId && o.week === chop.week)?.text;

// Survival zones. The chopping zone is the fewest teams, most at risk first,
// whose chop odds add up to half: a 50% chance the chopped team is one of
// them. It's wide when the week is wide open and shrinks as it resolves.
// Safe is under 5% chop odds; everyone else is at risk.
const CHOPPING_ZONE_SHARE = 50;
const SAFE_BELOW = 5;
function choppingZone(teams) {
  const zone = new Set();
  let covered = 0;
  for (const t of [...teams].sort((a, b) => b.chopProbability - a.chopProbability)) {
    if (covered >= CHOPPING_ZONE_SHARE || t.chopProbability <= 0) break;
    zone.add(t.teamId);
    covered += t.chopProbability;
  }
  return zone;
}
const ZONE_COLORS = { "zone-chop": "#ef9a96", "zone-risk": "#e6c85c", "zone-safe": "#8fd087" };
const zoneOf = (t, zone) => zone.has(t.teamId) ? "zone-chop" : t.chopProbability < SAFE_BELOW ? "zone-safe" : "zone-risk";

// Card lines from the simulations: the player whose game matters most, the
// team they're really racing (once one stands out), and who's left.
const RIVAL_SHOWN_AT = 30;
// Last name, except defenses ("Rams D/ST").
const short = n => /D\/ST/.test(n) ? n : n.split(" ").slice(1).join(" ") || n;
// "a big game (~33 pts) drops the chop odds to 9%; a quiet one (~13 pts) raises them to 26%"
const swingLine = t => {
  const p = t.swingPlayer;
  if (!p) return null;
  const where = p.game ? ` (${p.game})` : "";
  return p.bigGame != null
    ? `${short(p.name)} decides it${where}: a big game (~${Math.round(p.bigGame)} pts) drops the chop odds to ${Math.round(p.chopIfAbove)}%; a quiet one (~${Math.round(p.quietGame)} pts) raises them to ${Math.round(p.chopIfBelow)}%.`
    : `${short(p.name)} decides it${where}: ${Math.round(p.chopIfAbove)}% chop odds if he tops his projection, ${Math.round(p.chopIfBelow)}% if he doesn't.`;
};
// All of a team's starters in one NFL game, when that's a bigger swing.
const gameLine = t => {
  const g = t.swingGame;
  if (!g) return null;
  return `${g.game} is the difference maker (${g.players.map(short).join(", ")}): a big game (~${Math.round(g.bigGame)} pts) drops the chop odds to ${Math.round(g.chopIfAbove)}%; a quiet one (~${Math.round(g.quietGame)} pts) raises them to ${Math.round(g.chopIfBelow)}%.`;
};
const rivalLine = t => t.rival?.share >= RIVAL_SHOWN_AT
  ? `Racing ${t.rival.team}: they're the team just above in ${Math.round(t.rival.share)}% of the simulated chops.`
  : null;
const leftLine = t => {
  if (!t.playersLeft) return "No players left to play";
  const top = [...t.remaining].sort((a, b) => b.projectedRest - a.projectedRest);
  const names = top.slice(0, 2).map(p => short(p.name)).join(", ") + (top.length > 2 ? ` +${top.length - 2}` : "");
  return `${t.playersLeft} left, ${money(t.projected - t.score)} projected pts (${names})`;
};

const SURVIVAL_SORTS = {
  odds: { label: "ODDS", compare: (a, b) => b.chopProbability - a.chopProbability || a.projected - b.projected },
  current: { label: "CURRENT", compare: (a, b) => b.score - a.score },
  projected: { label: "PROJECTED", compare: (a, b) => b.projected - a.projected }
};

// Every surviving team, sortable; collapsed by default.
function SurvivalOdds({ teams, guillotine }) {
  const [sort, setSort] = useState("odds");
  const sorted = [...teams].sort(SURVIVAL_SORTS[sort].compare);
  const zone = choppingZone(teams);
  return (
    <details className="collapsible" id="survival">
      <summary>Survival odds <span>{teams.length} teams</span></summary>
      <div className="score-sort-controls" role="group" aria-label="Sort survival odds">
        {Object.entries(SURVIVAL_SORTS).map(([key, option]) =>
          <button key={key} type="button" className={sort === key ? "active" : ""} onClick={() => setSort(key)}>{option.label}</button>)}
      </div>
      <div className="survival-share">
        <ShareButton iconOnly label="Share the survival odds table" filename={`survival-odds-week-${guillotine.week}`} build={() => ({
          kicker: `${guillotine.leagueName} · Week ${guillotine.week} survival odds`,
          title: "Who survives?",
          lines: [
            ...sorted.map((t, i) => ({
              text: `${i + 1}. ${t.team} · ${money(100 - t.chopProbability)}% to survive`,
              size: sorted.length > 10 ? 26 : 30, weight: 800, gap: i ? 6 : 20,
              color: ZONE_COLORS[zoneOf(t, zone)]
            })),
            { text: `Red: a ${CHOPPING_ZONE_SHARE}% chance one of these teams gets chopped · Green: under ${SAFE_BELOW}% chop odds`, size: 22, color: "faint", gap: 28 }
          ]
        })} />
      </div>
      <p className="survival-legend"><span className="zone-chop">Chopping zone: a {CHOPPING_ZONE_SHARE}% chance one of these teams gets chopped</span><span className="zone-risk">At risk</span><span className="zone-safe">Safe (under {SAFE_BELOW}%)</span></p>
      <div className="survival-table">
        <div className="survival-row survival-header"><span>#</span><span>Team</span><span>Current</span><span>Projected</span><span>Left</span><span>Survive</span></div>
        {sorted.map((t, i) => <div className={`survival-row ${zoneOf(t, zone)}`} key={t.teamId}>
          <span>{i + 1}</span>
          <strong><DwLogo team={t} /><span>{t.team}</span></strong>
          <span>{money(t.score)}</span>
          <span>{money(t.projected)}</span>
          <span>{t.playersLeft ? t.playersLeft : "final"}</span>
          <b>{money(100 - t.chopProbability)}%</b>
        </div>)}
      </div>
    </details>
  );
}

// Obituaries for chopped teams, one at a time; collapsed by default. All
// cards share one grid cell so the box keeps the height of the longest one.
function Obituaries({ guillotine }) {
  const chopped = guillotine.chopped || [];
  const [index, setIndex] = useState(0);
  if (!chopped.length) return null;
  const active = index % chopped.length;
  const step = delta => setIndex((active + delta + chopped.length) % chopped.length);
  return (
    <details className="collapsible" id="rip">
      <summary>Rest in peace <span>{chopped.length} chopped</span></summary>
      <div className="obit-carousel">
        <div className="obit-stack">
          {chopped.map((c, i) => {
            const obituary = obituaryFor(c);
            return <article className={i === active ? "obit-card active" : "obit-card"} aria-hidden={i !== active} key={c.teamId}>
              <span className="obit-icon">🪦</span>
              <small>{formatDay(guillotine.draftDate)} — {formatDay(c.diedOn)}</small>
              <strong className="dw-team"><DwLogo team={c} size="md" />{c.team}</strong>
              <p className="rip-cause">Chopped in Week {c.week} with {money(c.finalScore)} pts{c.survivedBy ? `, ${money(c.margin)} short of ${c.survivedBy.team}` : ""}.</p>
              {obituary
                ? obituary.split(/\n\s*\n/).map((paragraph, p) => <p className="rip-obituary" key={p}>{paragraph.replace(/\s*\n\s*/g, " ")}</p>)
                : <p className="rip-obituary">Obituary pending.</p>}
              <div className="card-actions">
                <ShareButton filename={`rip-${c.team}`.replace(/[^\w-]+/g, "-")} build={() => ({
                  kicker: `Rest in peace · ${guillotine.leagueName}`,
                  title: `🪦 ${c.team}`,
                  lines: [
                    { text: `${formatDay(guillotine.draftDate)} — ${formatDay(c.diedOn)}`, size: 30, color: "accent", weight: 800, gap: 30 },
                    { text: `Chopped in Week ${c.week} with ${money(c.finalScore)} pts${c.survivedBy ? `, ${money(c.margin)} short of ${c.survivedBy.team}` : ""}.`, size: 30, color: "ink" },
                    { text: obituary || "Obituary pending.", size: obituary && obituary.length > 700 ? 24 : 27, gap: 30 }
                  ]
                })} />
              </div>
            </article>;
          })}
        </div>
        {chopped.length > 1 ? <div className="obit-controls">
          <button type="button" onClick={() => step(-1)} aria-label="Previous obituary">‹</button>
          <div className="marquee-dots">{chopped.map((c, i) => <button key={c.teamId} type="button" className={i === active ? "active" : ""} aria-label={"Show " + c.team} onClick={() => setIndex(i)}></button>)}</div>
          <button type="button" onClick={() => step(1)} aria-label="Next obituary">›</button>
        </div> : null}
      </div>
    </details>
  );
}

const openObituaries = () => {
  const details = document.getElementById("rip");
  if (details) details.open = true;
};

export function DeathWatch({ guillotine }) {
  if (!(guillotine.teams?.length)) return null;
  return (
    <section id="death-watch" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">{(guillotine.leagueName || "Guillotine league").toUpperCase()}</span><h2>Week {guillotine.week} Death Watch</h2></div>
        <span className="record-count">{guillotine.teams.length} TEAMS ALIVE</span>
      </div>
      <p className="raffle-intro">Our guillotine side league: the lowest score each week gets chopped. Chop odds come from {Number(guillotine.simulations || 0).toLocaleString()} simulations of the rest of the week.</p>
      <div className="award-grid">
        {guillotine.teams.filter(t => t.chopProbability > 0).slice(0, 3).map((t, i) => <article className="award-card" key={t.teamId}>
          <span>{i === 0 ? "🪓" : "😰"}</span>
          <small>{i === 0 ? "ON THE CHOPPING BLOCK" : `#${i + 1} MOST AT RISK`}</small>
          <strong className="dw-team"><DwLogo team={t} size="md" />{t.team}</strong>
          <b className="chop-odds">{money(t.chopProbability)}% chance of being chopped</b>
          <p>{money(t.score)} pts{t.playersLeft ? ` · projected ${money(t.projected)}` : " · final"}</p>
          {t.survivalNeed ? <p>Needs {money(t.survivalNeed.points)} more pts to pass {t.survivalNeed.passTeam}</p> : null}
          {gameLine(t) ? <p className="dw-insight">🏟️ {gameLine(t)}</p> : null}
          {swingLine(t) ? <p className="dw-insight">🎲 {swingLine(t)}</p> : null}
          {rivalLine(t) ? <p className="dw-insight">🏁 {rivalLine(t)}</p> : null}
          <p className="dw-left">{leftLine(t)}</p>
          <div className="card-actions">
            <ShareButton filename={`death-watch-week-${guillotine.week}-${t.team}`.replace(/[^\w-]+/g, "-")} build={() => ({
              kicker: `${guillotine.leagueName} · Week ${guillotine.week} Death Watch`,
              title: `🪓 ${t.team}`,
              lines: [
                { text: `${money(t.chopProbability)}% chance of being chopped`, size: 48, color: "alert", weight: 800, gap: 40 },
                { text: `${money(t.score)} pts${t.playersLeft ? ` · projected ${money(t.projected)}` : " · final"}`, size: 34 },
                t.survivalNeed ? { text: `Needs ${money(t.survivalNeed.points)} more pts to pass ${t.survivalNeed.passTeam}`, size: 30, color: "ink" } : null,
                gameLine(t) ? { text: "🏟️ " + gameLine(t), size: 28, color: "ink", gap: 24 } : null,
                swingLine(t) ? { text: "🎲 " + swingLine(t), size: 28, color: "ink", gap: gameLine(t) ? 8 : 24 } : null,
                rivalLine(t) ? { text: "🏁 " + rivalLine(t), size: 28 } : null,
                { text: leftLine(t), size: 26, color: "muted" }
              ].filter(Boolean)
            })} />
          </div>
        </article>)}
      </div>
      {guillotine.chopped?.length ? <p className="median-note">Already chopped: {guillotine.chopped.map(c => `${c.team} (Week ${c.week})`).join(" · ")} · <a href="#rip" onClick={openObituaries}>Rest in peace</a></p> : null}
      <SurvivalOdds teams={guillotine.teams} guillotine={guillotine} />
      <Obituaries guillotine={guillotine} />
    </section>
  );
}
