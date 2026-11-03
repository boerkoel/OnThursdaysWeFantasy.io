import React, { useEffect, useRef, useState } from "react";
import { money } from "../lib/data.js";
import { oddsMove, shortPlay } from "../lib/playText.js";
import { useWakeLock } from "../lib/wakeLock.js";
import { LOCKED, MiniNeedle, NeedleRace } from "./Needle.jsx";

// The league on a TV (Jim, 2026-11-02, for watch parties): everything live on one landscape screen, read from
// across the room, nothing to tap. Six matchup needles, the median, ticket and chop races, who's on the field,
// and a ticker of key plays and League Wire headlines. Keeps the screen awake, hides an idle cursor, and pulses
// a matchup's tile when it gets a new favorite. Watch mode, at #watch (Jim: not tied to a device; #tv still works);
// sized to the screen (vw units) so a laptop or a TV works.
// Space follows what's still in play (Jim, 2026-11-02): decided matchups announce themselves full screen, then
// shrink into a results strip while the open ones grow (3×2, 2×2, side by side, one big needle); the side
// races show only the median's four most at stake and the ticket's and chop's top two, and a new team taking
// one of those spots is announced too.
const A_COLOR = "#7aa6d8", B_COLOR = "#e0a64a";
const MEDIAN_COLORS = ["#d96b67", "#e6c85c", "#72b96a"];
const FLASH_MS = 6000;
const TICKER_PLAYS = 12;
const TICKER_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const ANNOUNCE_MS = 6000;

// Announcements, one at a time: { icon, text, sub }.
function useAnnouncer() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    if (!queue.length) return;
    const id = setTimeout(() => setQueue(q => q.slice(1)), ANNOUNCE_MS);
    return () => clearTimeout(id);
  }, [queue]);
  return [queue[0] || null, a => setQueue(q => [...q, a])];
}

// Announce each matchup the moment it's decided (not the ones already decided when the screen opened).
function useClinches(pairs, announce) {
  const seen = useRef(null);
  const decided = pairs.filter(([a, b]) => Number(a.winProbability) >= LOCKED || Number(b.winProbability) >= LOCKED);
  const key = decided.map(([a]) => a.matchupId).join(",");
  useEffect(() => {
    const now = new Set(decided.map(([a]) => a.matchupId));
    if (seen.current) for (const [a, b] of decided) if (!seen.current.has(a.matchupId)) {
      const [w, l] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
      announce({ icon: "✊", text: `${w.team} has clinched it`, sub: `over ${l.team} · ${money(w.score)}–${money(l.score)}` });
    }
    seen.current = now;
  }, [key]);
}

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

// A phone or an upright screen (the stacked layout), where the median shows its two with the most at stake.
const NARROW = "(max-width: 760px), (orientation: portrait) and (max-width: 1024px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia(NARROW).matches; } catch { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia(NARROW); } catch { return; }
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
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

// On a phone (Jim, 2026-11-02: one always-on snapshot, the detail is in Primetime view): shorter tiles (the
// odds alone under the dial, players left beside the scores), races as compact rows, chip columns on one line
// each, results on one line, a smaller ticker that covers nothing, and no "on the field" list.
export default function TvView({ scoreboard, guillotine, livePlays, marquee, logos = {}, onClose }) {
  useWakeLock(true);
  const idle = useIdleCursor();
  const narrow = useNarrow();
  const [resultsOpen, setResultsOpen] = useState(false);
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
  const [announcement, announce] = useAnnouncer();
  useClinches(pairs, announce);
  const swapped = icon => (inTeam, outTeam) => announce({ icon, text: `${inTeam} is in`, sub: `taking ${outTeam}'s spot` });
  const isDecided = ([a, b]) => Number(a.winProbability) >= LOCKED || Number(b.winProbability) >= LOCKED;
  const open = pairs.filter(p => !isDecided(p)), done = pairs.filter(isDecided);
  const cols = open.length <= 1 ? 1 : open.length <= 4 ? 2 : 3;
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
          <button type="button" onClick={onClose} aria-label="Leave watch mode">✕</button>
        </div>
      </header>
      <div className="tv-body">
        <section className="tv-left">
          {open.length ? <div className={"tv-matchups n" + open.length} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {open.map(([a, b]) => <div key={a.matchupId} className={"tv-tile" + (flashing.has(a.matchupId) ? " flash" : "")}>
              <div className="tv-score">
                {[[a, A_COLOR], [b, B_COLOR]].map(([t, c]) => <p key={t.teamId} style={{ color: c }}>
                  <span>{logos[t.teamId] ? <img src={logos[t.teamId]} alt="" /> : null}{t.team}</span>
                  {narrow ? <small className="tv-left-count">{t.startersLeft ?? 0} left</small> : null}<b>{money(t.score)}</b></p>)}
              </div>
              <MiniNeedle team={b} stakes={[a, b]} p={Number(b.winProbability)} from={b.liveWinFrom} sides={[a.team, b.team]} colors={[A_COLOR, B_COLOR]} short={narrow}
                caption={narrow ? false : `${a.startersLeft ?? 0} left · ${b.startersLeft ?? 0} left`} history={scoreboard.winHistory?.week === scoreboard.week ? scoreboard.winHistory.points : []} games={games} />
            </div>)}
          </div> : <p className="tv-all-done">Every matchup is decided.</p>}
          {done.length && narrow && !resultsOpen ? <p className="tv-results-line" onClick={() => setResultsOpen(true)}
            title={done.map(([a, b]) => `${a.team} ${money(a.score)}–${money(b.score)} ${b.team}`).join("\n")}>
            {done.map(([a, b]) => "✊ " + (Number(a.winProbability) >= Number(b.winProbability) ? a : b).team).join(" · ")}</p>
          : done.length ? <div className="tv-results" onClick={narrow ? () => setResultsOpen(false) : undefined}>{done.map(([a, b]) => {
            const [w, l] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
            return <span key={a.matchupId}>✊ <b>{w.team}</b> {money(w.score)}–{money(l.score)} {l.team}</span>;
          })}</div> : null}
        </section>
        <aside className="tv-side">
          <NeedleRace label="MEDIAN LINE" compact max={narrow ? 2 : 4} pick="stake" onSwap={swapped("📏")} items={scores.map(s => ({ team: s, p: Number(s.aboveMedianProbability), from: s.liveAboveFrom }))}
            sides={["below", "above"]} colors={MEDIAN_COLORS} band={[30, 70]} words={{ likely: ["likely below", "likely above"], locked: ["❌ below", "✅ above"] }}
            stakes={scores} games={games} />
          <NeedleRace label="🎟️ TICKET RACE" compact max={2} onSwap={swapped("🎟️")} items={scores.map(s => ({ team: s, p: Number(s.topScoreProbability), from: s.liveTopFrom }))}
            sides={["no ticket", "ticket"]} colors={["#8b8e86", "#e6c85c"]} words={{ likely: ["long shots", "near lock"], locked: ["❌ out", "🎟️ locked"] }} implied="left"
            chipOdds="right" stakes={scores} history={scoreboard.raffleHistory?.week === scoreboard.week ? scoreboard.raffleHistory.points : []} games={games} />
          {gWeek && guillotine.teams?.length ? <NeedleRace label="🪓 CHOPPING BLOCK" compact max={2} onSwap={swapped("🪓")} items={guillotine.teams.map(t => ({ team: { ...t, lineup: { starters: t.lineup || [] } }, p: Number(t.chopProbability), from: t.liveChopFrom }))}
            good="left" sides={["safe", "chopped"]} colors={["#8fd087", "#d98a86"]} words={{ likely: ["likely safe", "likely chopped"], locked: ["✅ safe", "🪓 chopped"] }} implied="left"
            stakes={guillotine.teams.map(t => ({ lineup: { starters: t.lineup || [] } }))} games={games} /> : null}
          {field.length ? <div className="tv-field"><small className="mini-needles-label">ON THE FIELD NOW</small>
            {field.map(f => <p key={f.id}><b>{f.head}</b>{f.on.length ? " — " + f.on.join(", ") : " — no league starters"}</p>)}</div> : null}
        </aside>
      </div>
      {announcement ? <div className="tv-announce" key={announcement.text + announcement.sub}>
        <span>{announcement.icon}</span><b>{announcement.text}</b>{announcement.sub ? <small>{announcement.sub}</small> : null}
      </div> : null}
      {ticker.length ? <footer className="tv-ticker" aria-label="Key plays and League Wire">
        <div className="tv-ticker-track" style={{ animationDuration: `${Math.max(40, ticker.join(" ").length / 6)}s` }}>
          {[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}
        </div>
      </footer> : null}
    </div>
  );
}
