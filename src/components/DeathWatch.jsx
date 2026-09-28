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

const SURVIVAL_SORTS = {
  odds: { label: "ODDS", compare: (a, b) => a.chopProbability - b.chopProbability || b.projected - a.projected },
  current: { label: "CURRENT", compare: (a, b) => b.score - a.score },
  projected: { label: "PROJECTED", compare: (a, b) => b.projected - a.projected }
};

// Every surviving team, sortable; collapsed by default.
function SurvivalOdds({ teams }) {
  const [sort, setSort] = useState("odds");
  const sorted = [...teams].sort(SURVIVAL_SORTS[sort].compare);
  return (
    <details className="collapsible">
      <summary>Survival odds <span>{teams.length} teams</span></summary>
      <div className="score-sort-controls" role="group" aria-label="Sort survival odds">
        {Object.entries(SURVIVAL_SORTS).map(([key, option]) =>
          <button key={key} type="button" className={sort === key ? "active" : ""} onClick={() => setSort(key)}>{option.label}</button>)}
      </div>
      <div className="survival-table">
        <div className="survival-row survival-header"><span>#</span><span>Team</span><span>Current</span><span>Projected</span><span>Left</span><span>Survive</span></div>
        {sorted.map((t, i) => <div className="survival-row" key={t.teamId}>
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
          <p>{t.playersLeft ? "Still to play: " + t.remaining.map(p => p.name + (p.game ? ` (${p.game})` : "")).join(", ") : "No players left to play"}</p>
          {t.survivalNeed ? <p>Needs {money(t.survivalNeed.points)} more pts to pass {t.survivalNeed.passTeam}</p> : null}
          <div className="card-actions">
            <ShareButton filename={`death-watch-week-${guillotine.week}-${t.team}`.replace(/[^\w-]+/g, "-")} build={() => ({
              kicker: `${guillotine.leagueName} · Week ${guillotine.week} Death Watch`,
              title: `🪓 ${t.team}`,
              lines: [
                { text: `${money(t.chopProbability)}% chance of being chopped`, size: 48, color: "alert", weight: 800, gap: 40 },
                { text: `${money(t.score)} pts${t.playersLeft ? ` · projected ${money(t.projected)}` : " · final"}`, size: 34 },
                t.playersLeft ? { text: "Still to play: " + t.remaining.map(p => p.name).join(", "), size: 30 } : null,
                t.survivalNeed ? { text: `Needs ${money(t.survivalNeed.points)} more pts to pass ${t.survivalNeed.passTeam}`, size: 30, color: "ink" } : null
              ].filter(Boolean)
            })} />
          </div>
        </article>)}
      </div>
      {guillotine.chopped?.length ? <p className="median-note">Already chopped: {guillotine.chopped.map(c => `${c.team} (Week ${c.week})`).join(" · ")} · <a href="#rip" onClick={openObituaries}>Rest in peace</a></p> : null}
      <SurvivalOdds teams={guillotine.teams} />
      <Obituaries guillotine={guillotine} />
    </section>
  );
}
