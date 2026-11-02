import React, { useEffect, useRef, useState } from "react";
import { money } from "../lib/data.js";
import { oddsMove, shortPlay } from "../lib/playText.js";
import { useWakeLock } from "../lib/wakeLock.js";
import { LOCKED, MiniNeedle, NeedleRace } from "./Needle.jsx";

// The league on a TV (Jim, 2026-11-02, for watch parties): everything live on one landscape screen, read from
// across the room, nothing to tap. Six matchup needles, the median, ticket and chop races, who's on the field,
// and a ticker of key plays and League Wire headlines. Keeps the screen awake, hides an idle cursor, and pulses
// a matchup's tile when it gets a new favorite. At #tv; sized to the screen (vw units) so a laptop or a TV works.
const A_COLOR = "#7aa6d8", B_COLOR = "#e0a64a";
const MEDIAN_COLORS = ["#d96b67", "#e6c85c", "#72b96a"];
const FLASH_MS = 6000;
const TICKER_PLAYS = 12;
const TICKER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const teamIdsOf = g => (g.teamIds || (g.teams || []).map(t => Number(t.id))).map(Number);
const gameText = g => {
  const away = (g.teams || []).find(t => !t.home), home = (g.teams || []).find(t => t.home);
  return away && home ? `${away.abbrev} ${away.score}–${home.score} ${home.abbrev}${g.detail ? " · " + g.detail : ""}` : g.name;
};

// Pulse a matchup when its favorite changes (crossing 50%) between updates.
function useFlashes(pairs) {
  const favorites = useRef(new Map());
  const [flashing, setFlashing] = useState(() => new Set());
  const key = pairs.map(([a, b]) => `${a.matchupId}:${Number(a.winProbability) >= 50 ? a.teamId : b.teamId}`).join(",");
  useEffect(() => {
    const changed = [];
    for (const [a, b] of pairs) {
      const fav = Number(a.winProbability) >= 50 ? a.teamId : b.teamId;
      const before = favorites.current.get(a.matchupId);
      if (before != null && before !== fav) changed.push(a.matchupId);
      favorites.current.set(a.matchupId, fav);
    }
    if (!changed.length) return;
    setFlashing(new Set(changed));
    const id = setTimeout(() => setFlashing(new Set()), FLASH_MS);
    return () => clearTimeout(id);
  }, [key]);
  return flashing;
}

// Hide the mouse after a few idle seconds (a laptop hooked to a TV).
function useIdleCursor() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let id;
    const wake = () => { setIdle(false); clearTimeout(id); id = setTimeout(() => setIdle(true), 3000); };
    wake();
    window.addEventListener("mousemove", wake);
    return () => { clearTimeout(id); window.removeEventListener("mousemove", wake); };
  }, []);
  return idle;
}

export default function TvView({ scoreboard, guillotine, livePlays, marquee, logos = {}, onClose }) {
  useWakeLock(true);
  const idle = useIdleCursor();
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const scores = scoreboard.scores || [], games = scoreboard.nflGames || [];
  const week = Number(scoreboard.week);
  const pairs = [...new Set(scores.map(s => s.matchupId))].map(id => scores.filter(s => s.matchupId === id)).filter(p => p.length === 2);
  const flashing = useFlashes(pairs);
  const liveGames = games.filter(g => g.state === "in");
  const teamName = new Map(scores.map(s => [Number(s.teamId), s.team]));

  // The ticker: the newest key plays (6+ points, or a 3+ point odds move) and the League Wire's top stories.
  const plays = Number(livePlays?.week) === week ? livePlays.plays || [] : [];
  const keyPlays = plays.filter(p => p.wallclock && Date.now() - Date.parse(p.wallclock) < TICKER_MAX_AGE_MS && (Math.abs(Number(p.points)) >= 6 || p.momentum?.shift >= 3))
    .sort((x, y) => Date.parse(y.wallclock) - Date.parse(x.wallclock)).slice(0, TICKER_PLAYS)
    .map(p => `${teamName.get(Number(p.fantasyTeamId)) || ""}: ${p.player} ${shortPlay(p)}${p.momentum?.shift >= 1 ? ` · ${p.momentum.toward} ${oddsMove(p.momentum.winProbability, p.momentum.shift)}` : ""}`);
  const stories = (Number(marquee?.week) === week ? marquee.stories || [] : []).slice(0, 4).map(s => s.text);
  const ticker = [...keyPlays, ...stories];

  // On the field now: each live game's offense and the other side's D/ST, with whose they are.
  const field = liveGames.map(g => {
    const ball = Number(g.drive?.possession);
    const on = scores.flatMap(s => (s.lineup?.starters || []).filter(p => teamIdsOf(g).includes(Number(p.proTeamId))
      && (p.pos === "D/ST" ? Number(p.proTeamId) !== ball : Number(p.proTeamId) === ball)).map(p => `${p.name.replace(/^[A-Z]\.\s*/, "")} (${s.team})`));
    const offense = (g.teams || []).find(t => Number(t.id) === ball);
    return { id: g.id, head: `${offense ? "🏈 " + offense.abbrev + " ball" : gameText(g)}${g.drive?.text ? " · " + g.drive.text : ""}`, on };
  });

  const gWeek = Number(guillotine?.week) === week;
  return (
    <div className={"tv" + (idle ? " idle" : "")}>
      <header className="tv-head">
        <div><span className="section-kicker">ON THURSDAYS WE WATCH FOOTBALL · WEEK {week}</span>
          <h1>{liveGames.length ? <><span className="needle-live">● LIVE</span> {liveGames.map(gameText).join("   ·   ")}</> : "Game day"}</h1></div>
        <div className="tv-actions">
          {!fullscreen && document.documentElement.requestFullscreen ? <button type="button" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>⛶ Full screen</button> : null}
          <button type="button" onClick={onClose} aria-label="Leave the TV view">✕</button>
        </div>
      </header>
      <div className="tv-body">
        <section className="tv-matchups">
          {pairs.map(([a, b]) => {
            const decided = Number(a.winProbability) >= LOCKED || Number(b.winProbability) >= LOCKED;
            const winner = Number(a.winProbability) >= Number(b.winProbability) ? a : b;
            return <div key={a.matchupId} className={"tv-tile" + (flashing.has(a.matchupId) ? " flash" : "") + (decided ? " decided" : "")}>
              <div className="tv-score">
                {[[a, A_COLOR], [b, B_COLOR]].map(([t, c]) => <p key={t.teamId} style={{ color: c }}>
                  <span>{logos[t.teamId] ? <img src={logos[t.teamId]} alt="" /> : null}{t.team}</span><b>{money(t.score)}</b></p>)}
              </div>
              {decided ? <p className="tv-clinched">✊ {winner.team} {a.startersLeft || b.startersLeft ? "has clinched it" : "wins"}</p>
                : <MiniNeedle team={b} stakes={[a, b]} p={Number(b.winProbability)} from={b.liveWinFrom} sides={[a.team, b.team]} colors={[A_COLOR, B_COLOR]}
                  caption={`${a.startersLeft ?? 0} left · ${b.startersLeft ?? 0} left`} history={scoreboard.winHistory?.week === scoreboard.week ? scoreboard.winHistory.points : []} games={games} />}
            </div>;
          })}
        </section>
        <aside className="tv-side">
          <NeedleRace label="MEDIAN LINE" items={scores.map(s => ({ team: s, p: Number(s.aboveMedianProbability), from: s.liveAboveFrom }))}
            sides={["below", "above"]} colors={MEDIAN_COLORS} band={[30, 70]} words={{ likely: ["likely below", "likely above"], locked: ["❌ below", "✅ above"] }}
            stakes={scores} games={games} />
          <NeedleRace label="🎟️ TICKET RACE" items={scores.map(s => ({ team: s, p: Number(s.topScoreProbability), from: s.liveTopFrom }))}
            sides={["no ticket", "ticket"]} colors={["#8b8e86", "#e6c85c"]} words={{ likely: ["long shots", "near lock"], locked: ["❌ out", "🎟️ locked"] }}
            chipOdds="right" stakes={scores} history={scoreboard.raffleHistory?.week === scoreboard.week ? scoreboard.raffleHistory.points : []} games={games} />
          {gWeek && guillotine.teams?.length ? <NeedleRace label="🪓 CHOPPING BLOCK" items={guillotine.teams.map(t => ({ team: { ...t, lineup: { starters: t.lineup || [] } }, p: Number(t.chopProbability), from: t.liveChopFrom }))}
            sides={["safe", "chopped"]} colors={["#8fd087", "#d98a86"]} words={{ likely: ["likely safe", "likely chopped"], locked: ["✅ safe", "🪓 chopped"] }}
            stakes={guillotine.teams.map(t => ({ lineup: { starters: t.lineup || [] } }))} games={games} /> : null}
          {field.length ? <div className="tv-field"><small className="mini-needles-label">ON THE FIELD NOW</small>
            {field.map(f => <p key={f.id}><b>{f.head}</b>{f.on.length ? " — " + f.on.join(", ") : " — no league starters"}</p>)}</div> : null}
        </aside>
      </div>
      {ticker.length ? <footer className="tv-ticker" aria-label="Key plays and League Wire">
        <div className="tv-ticker-track" style={{ animationDuration: `${Math.max(40, ticker.join(" ").length / 6)}s` }}>
          {[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}
        </div>
      </footer> : null}
    </div>
  );
}
