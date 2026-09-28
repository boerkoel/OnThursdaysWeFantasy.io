import React from "react";
import { formatDay, money } from "../lib/data.js";
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
          <strong>{t.team}</strong>
          <b className="chop-odds">{money(t.chopProbability)}% chance of being chopped</b>
          <p>{money(t.score)} pts{t.playersLeft ? ` · projected ${money(t.projected)}` : " · final"}</p>
          <p>{t.playersLeft ? "Still to play: " + t.remaining.map(p => p.name + (p.game ? ` (${p.game})` : "")).join(", ") : "No players left to play"}</p>
          {t.survivalNeed ? <p>Needs {money(t.survivalNeed.points)} more pts to pass {t.survivalNeed.passTeam}</p> : null}
        </article>)}
      </div>
      <h3 className="survival-heading">Survival odds</h3>
      <div className="standings-table">
        {guillotine.teams.map((t, i) => <div className="standing-row" key={t.teamId}>
          <span>{i + 1}</span>
          <strong>{t.team}</strong>
          <span>{t.playersLeft ? `${money(t.score)} · ${t.playersLeft} left` : `${money(t.score)} · final`}</span>
          <span>{money(100 - t.chopProbability)}% survive</span>
        </div>)}
      </div>
      {guillotine.chopped?.length ? <p className="median-note">Already chopped: {guillotine.chopped.map(c => `${c.team} (Week ${c.week})`).join(" · ")} · <a href="#rip">Rest in peace</a></p> : null}
    </section>
  );
}

export function RestInPeace({ guillotine }) {
  if (!(guillotine.chopped?.length)) return null;
  return (
    <section id="rip" className="section">
      <div className="section-heading">
        <div><span className="section-kicker">{(guillotine.leagueName || "Guillotine league").toUpperCase()}</span><h2>Rest in Peace</h2></div>
        <span className="record-count">{guillotine.chopped.length} CHOPPED</span>
      </div>
      <div className="award-grid rip-grid">
        {guillotine.chopped.map(c => {
          // Handwritten obituaries win over generated ones.
          const obituary = handwrittenObituaries.get(c.team.trim().toLowerCase()) ||
            (obituaryData.obituaries || []).find(o => o.teamId === c.teamId && o.week === c.week)?.text;
          return <article className="award-card" key={c.teamId}>
            <span>🪦</span>
            <small>{formatDay(guillotine.draftDate)} — {formatDay(c.diedOn)}</small>
            <strong>{c.team}</strong>
            <p className="rip-cause">Chopped in Week {c.week} with {money(c.finalScore)} pts{c.survivedBy ? `, ${money(c.margin)} short of ${c.survivedBy.team}` : ""}.</p>
            {obituary
              ? obituary.split(/\n\s*\n/).map((paragraph, i) => <p className="rip-obituary" key={i}>{paragraph.replace(/\s*\n\s*/g, " ")}</p>)
              : <p className="rip-obituary">Obituary pending.</p>}
          </article>;
        })}
      </div>
    </section>
  );
}
