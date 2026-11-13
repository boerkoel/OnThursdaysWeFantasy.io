import React, { useEffect, useRef, useState } from "react";
import { money } from "../lib/data.js";
import { oddsMove, shortPlay } from "../lib/playText.js";
import { useWakeLock } from "../lib/wakeLock.js";
import { LOCKED, MiniNeedle, NeedleRace, useSyncFocus, useSyncedPeek } from "./Needle.jsx";
import { chopPeeks } from "../lib/tdPeeks.js";
import { driveRooting } from "../lib/rooting.js";

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

// Sound for the big moments (Jim, 2026-11-02): off until tapped on (browsers only play sound after a tap), then a
// rising chime for a clinch and a softer ping for a team taking a spot. Made with Web Audio, no files; the
// choice is remembered on this device. iPhones stay quiet with the silent switch on.
const CHIMES = { clinch: [[659, 0], [784, 0.12], [988, 0.24], [1319, 0.38]], swap: [[784, 0], [988, 0.14]] };
function useSound() {
  const ctx = useRef(null);
  const [on, setOn] = useState(() => { try { return localStorage.getItem("watchSound") === "1"; } catch { return false; } });
  const toggle = () => {
    const next = !on;
    if (next) {
      try { ctx.current ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.current.resume?.(); } catch {}
    }
    setOn(next);
    try { localStorage.setItem("watchSound", next ? "1" : "0"); } catch {}
    if (next) setTimeout(() => play("swap"), 50);
  };
  const play = kind => {
    const c = ctx.current;
    if (!c || c.state === "closed") return;
    const t0 = c.currentTime + 0.02, loud = kind === "clinch" ? 0.22 : 0.12;
    for (const [freq, at] of CHIMES[kind] || []) {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(loud, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain).connect(c.destination);
      osc.start(t0 + at); osc.stop(t0 + at + 0.75);
    }
  };
  // A remembered "on" needs a tap to wake the audio after a reload: the first tap anywhere does it.
  useEffect(() => {
    if (!on) return;
    const wake = () => { try { ctx.current ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.current.resume?.(); } catch {} };
    window.addEventListener("pointerdown", wake, { once: true });
    return () => window.removeEventListener("pointerdown", wake);
  }, [on]);
  return { on, toggle, play: kind => { if (on) play(kind); } };
}

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
// Also notes when each one was clinched (clinchedAt: matchupId -> time), so the latest keep their tiles longest.
function useClinches(pairs, announce, clinchedAt) {
  const seen = useRef(null);
  const decided = pairs.filter(([a, b]) => Number(a.winProbability) >= LOCKED || Number(b.winProbability) >= LOCKED);
  const key = decided.map(([a]) => a.matchupId).join(",");
  useEffect(() => {
    const now = new Set(decided.map(([a]) => a.matchupId));
    if (seen.current) for (const [a, b] of decided) if (!seen.current.has(a.matchupId)) {
      const [w, l] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
      announce({ icon: "✊", text: `${w.team} has clinched it`, sub: `over ${l.team} · ${money(w.score)}–${money(l.score)}` });
      clinchedAt.current.set(a.matchupId, Date.now());
    }
    seen.current = now;
  }, [key]);
}

const teamIdsOf = g => (g.teamIds || (g.teams || []).map(t => Number(t.id))).map(Number);
const gameText = g => {
  const away = (g.teams || []).find(t => !t.home), home = (g.teams || []).find(t => t.home);
  return away && home ? `${away.abbrev} ${away.score}–${home.score} ${home.abbrev}${g.detail ? " · " + g.detail : ""}` : g.name;
};

const GAME_TURN_MS = 12000;
// One live game's situation (Jim, 2026-11-12): a little field (home end zone on the left, since yardLine counts
// from the home goal line) with the ball, then "BUF 14–10 KC · 4:12 - 2nd · BUF ball · 2nd & 7 at KC 34".
function DriveLine({ game }) {
  const d = game.drive, away = (game.teams || []).find(t => !t.home), home = (game.teams || []).find(t => t.home);
  const ball = d ? (game.teams || []).find(t => Number(t.id) === Number(d.possession)) : null;
  const at = Number.isFinite(d?.yardLine) ? Math.min(100, Math.max(0, d.yardLine)) : null;
  return <p className="tv-drive-line">
    {at != null && home && away ? <span className={"tv-field-strip" + (d.redZone ? " red" : "")} aria-hidden="true">
      <i>{home.abbrev}</i><span><b style={{ left: `${at}%` }}>{ball?.home ? "▶" : "◀"}</b></span><i>{away.abbrev}</i></span> : null}
    <span className="tv-drive-text"><b>{gameText(game)}</b>{ball ? ` · ${ball.abbrev} ball` : ""}{d?.text ? ` · ${d.text}` : ""}</span>
  </p>;
}

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

// A phone or an upright screen (the stacked layout), where the median shows its two with the most at stake
// while 5-6 matchups are open, four once the grid has shrunk (Jim, 2026-11-02).
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
export default function TvView({ forks = { win: () => null, median: () => null, ticket: () => null }, peeks = { win: () => [], median: () => [], ticket: () => [] }, scoreboard, guillotine, livePlays, marquee, logos = {}, onClose }) {
  useWakeLock(true);
  // The page underneath stays put (Jim, 2026-11-08: Watch mode wouldn't scroll back down on a phone, the
  // swipe went to the page under it).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
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
  const [announcement, announceQuiet] = useAnnouncer();
  const sound = useSound();
  const announce = a => { announceQuiet(a); sound.play(a.icon === "✊" ? "clinch" : "swap"); };
  const clinchedAt = useRef(new Map());
  useClinches(pairs, announce, clinchedAt);
  const swapped = icon => (inTeam, outTeam) => announce({ icon, text: `${inTeam} is in`, sub: `taking ${outTeam}'s spot` });
  const isDecided = ([a, b]) => Number(a.winProbability) >= LOCKED || Number(b.winProbability) >= LOCKED;
  const open = pairs.filter(p => !isDecided(p)), done = pairs.filter(isDecided);
  // Decided matchups keep their tiles while there's room (Jim, 2026-11-02: it's fun to see one that wasn't a sure
  // thing locked in), the most recently clinched first; the rest go to the results strip. Six tiles on a wide
  // screen, four on a phone.
  const capacity = narrow ? 4 : 6;
  // When each became decided, from the week's win-odds history (the last time the winner went 99%+ and stayed):
  // the ones clinched tonight show their ride; one decided before the night began (Brock's) waits for the strip.
  const winHistory = scoreboard.winHistory?.week === scoreboard.week ? scoreboard.winHistory.points || [] : [];
  const decidedAt = ([a, b]) => {
    const w = Number(a.winProbability) >= Number(b.winProbability) ? a : b;
    const ps = winHistory.filter(x => Number.isFinite(Number(x.p?.[w.teamId])));
    const below = ps.findLastIndex(x => Number(x.p[w.teamId]) < LOCKED);
    return clinchedAt.current.get(a.matchupId) || (below >= 0 && ps[below + 1] ? Date.parse(ps[below + 1].t) : 0);
  };
  const doneTiles = [...done].sort((x, y) => decidedAt(y) - decidedAt(x)).slice(0, Math.max(0, capacity - open.length));
  const strip = done.filter(p => !doneTiles.includes(p));
  const tiles = [...open, ...doneTiles];
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const liveGames = games.filter(g => g.state === "in");
  // Watch mode is about what's live (Jim, 2026-11-12): the "if X scores" lines only for teams with a starter in a
  // game in progress, so idle matchups and races don't spend a line on them; their needles still quake.
  const liveTeams = new Set(liveGames.flatMap(teamIdsOf));
  const inPlay = (...teams) => teams.some(t => (t.lineup?.starters || []).some(p => liveTeams.has(Number(p.proTeamId))));
  const livePeeks = (peeks, ...teams) => inPlay(...teams) ? peeks : [];
  const teamName = new Map(scores.map(s => [Number(s.teamId), s.team]));
  // Starters yet to play (Jim, 2026-11-12: Gibb showed 10 left with 2 already in the game; ESPN says 8): the
  // feed's startersLeft counts every starter whose game isn't final, so take out those in a game under way.
  const toPlay = t => Math.max(0, (Number(t.startersLeft) || 0) - (t.lineup?.starters || []).filter(p => liveTeams.has(Number(p.proTeamId))).length);
  // A lineup's players on the field this drive (the offense, or the D/ST against it), so the chop's what-ifs stay
  // with the drive like the rest (Jim, 2026-11-12: "if Likely scores" came up with Washington's ball).
  const onDrive = lineup => (lineup || []).filter(p => liveGames.some(g => {
    const ball = Number(g.drive?.possession);
    return ball && teamIdsOf(g).includes(Number(p.proTeamId)) && (p.pos === "D/ST" ? Number(p.proTeamId) !== ball : Number(p.proTeamId) === ball);
  }));

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
  const ticketWinner = scores.find(s => Number(s.topScoreProbability) >= LOCKED);
  // Every needle dances to one outcome at a time, named once in a panel above the ticker (Jim, 2026-11-12), not
  // under each needle, which saves a line per needle. The panel follows that outcome's game: the clock, who has
  // the ball, down and distance and where on the field; then the what-if, or the last play as its needles jump.
  // With several games on (Jim, 2026-11-12: "cycle through score boards"), the panel takes turns through the live
  // games with league starters in them, GAME_TURN_MS each, and the what-ifs come from that game's drive alone; a
  // new last play from any game still cuts in, showing its own game.
  const whatIf = useSyncedPeek();
  const starterTeams = new Set(scores.flatMap(s => (s.lineup?.starters || []).map(p => Number(p.proTeamId))));
  const turnGames = liveGames.filter(g => teamIdsOf(g).some(id => starterTeams.has(id)));
  const rotation = turnGames.length ? turnGames : liveGames;
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (rotation.length < 2) return;
    const id = setInterval(() => setTurn(t => t + 1), GAME_TURN_MS);
    return () => clearInterval(id);
  }, [rotation.length]);
  const turnGame = rotation.length ? rotation[turn % rotation.length] : null;
  useSyncFocus(rotation.length > 1 && turnGame ? String(turnGame.id) : null);
  const shownGame = whatIf?.game ? liveGames.find(g => String(g.id) === String(whatIf.game)) : null;
  const driveGame = shownGame || turnGame;
  // Between what-ifs the line shows that game's last play (Jim, 2026-11-12: "not seeing the latest play"): any play,
  // from the scoreboard, else the newest league play in it.
  const lastInGame = (() => {
    if (!driveGame) return null;
    if (driveGame.drive?.lastPlay) return driveGame.drive.lastPlay;
    const p = plays.filter(x => String(x.eventId) === String(driveGame.id)).sort((x, y) => Date.parse(y.wallclock) - Date.parse(x.wallclock))[0];
    return p ? `${p.player} ${shortPlay(p)}` : null;
  })();
  return (
    <div className={"tv" + (idle ? " idle" : "")}>
      <header className="tv-head">
        <div>{narrow ? null : <span className="section-kicker">ON THURSDAYS WE WATCH FOOTBALL · WEEK {week}</span>}
          {/* On a phone, two or more live games scroll by on one line instead of wrapping (Jim, 2026-11-08). */}
          {narrow && liveGames.length > 1
            ? <h1 className="tv-head-scroll"><span className="needle-live">● LIVE</span><span className="tv-head-window"><span className="tv-head-track" style={{ animationDuration: `${Math.max(12, liveGames.map(gameText).join("").length / 4)}s` }}>
                {[0, 1].map(k => <span key={k}>{liveGames.map(gameText).join("   ·   ")}</span>)}</span></span></h1>
            : <h1>{liveGames.length ? <><span className="needle-live">● LIVE</span> {liveGames.map(gameText).join("   ·   ")}</> : narrow ? `Week ${week} game day` : "Game day"}</h1>}</div>
        <div className="tv-actions">
          {!fullscreen && document.documentElement.requestFullscreen ? <button type="button" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>⛶ Full screen</button> : null}
          <button type="button" onClick={sound.toggle} aria-pressed={sound.on} title={sound.on ? "Sound on: a chime for each clinch" : "Turn on a chime for each clinch"}>{sound.on ? "🔊" : "🔇"} Sound</button>
          <button type="button" onClick={onClose} aria-label="Leave watch mode">✕</button>
        </div>
      </header>
      <div className="tv-body">
        <section className="tv-left">
          {tiles.length ? <div className={"tv-matchups n" + tiles.length} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {tiles.map(([a, b]) => { const settled = isDecided([a, b]), winner = Number(a.winProbability) >= Number(b.winProbability) ? a : b;
              return <div key={a.matchupId} className={"tv-tile" + (flashing.has(a.matchupId) ? " flash" : "") + (settled ? " decided" : "")}>
              <div className="tv-score">
                {[[a, A_COLOR], [b, B_COLOR]].map(([t, c]) => <p key={t.teamId} style={{ color: c }}>
                  <span>{logos[t.teamId] ? <img src={logos[t.teamId]} alt="" /> : null}{t.team}</span>
                  {narrow ? <small className="tv-left-count">{toPlay(t)} left</small> : null}<b>{money(t.score)}</b></p>)}
              </div>
              <MiniNeedle team={b} stakes={[a, b]} fork={settled ? null : forks.win(a, b)} peeks={settled ? [] : livePeeks(peeks.win(a, b), a, b)} p={Number(b.winProbability)} from={b.liveWinFrom} sides={[a.team, b.team]} colors={[A_COLOR, B_COLOR]} short={narrow || settled}
                caption={settled ? `✊ ${winner.team}` : narrow ? false : `${toPlay(a)} left · ${toPlay(b)} left`}
                history={scoreboard.winHistory?.week === scoreboard.week ? scoreboard.winHistory.points : []} games={games} />
              {!settled && !narrow ? (() => {   // what each side roots for on a drive in progress (Jim, 2026-11-02), wide screens
                const r = games.map(g => driveRooting({ game: g, a, b })).find(Boolean);
                if (!r) return null;
                return <p className="tv-root"><small>🏈 {r.offense} ball · root for</small>{r.hopes.map(h => {
                  const pick = h.likely || h.dream;
                  return <span key={h.team} style={{ color: h.team === a.team ? A_COLOR : B_COLOR }}><b>{h.team}:</b> {h.likely ? "" : "dream: "}{pick.label} <em>{pick.from}→{pick.to}%</em></span>;
                })}</p>;
              })() : null}
            </div>; })}
          </div> : <p className="tv-all-done">Every matchup is decided.</p>}
          {strip.length && narrow && !resultsOpen ? <p className="tv-results-line" onClick={() => setResultsOpen(true)}
            title={strip.map(([a, b]) => `${a.team} ${money(a.score)}–${money(b.score)} ${b.team}`).join("\n")}>
            {strip.map(([a, b]) => "✊ " + (Number(a.winProbability) >= Number(b.winProbability) ? a : b).team).join(" · ")}</p>
          : strip.length ? <div className="tv-results" onClick={narrow ? () => setResultsOpen(false) : undefined}>{strip.map(([a, b]) => {
            const [w, l] = Number(a.winProbability) >= Number(b.winProbability) ? [a, b] : [b, a];
            return <span key={a.matchupId}>✊ <b>{w.team}</b> {money(w.score)}–{money(l.score)} {l.team}</span>;
          })}</div> : null}
        </section>
        <aside className="tv-side">
          <NeedleRace label="MEDIAN LINE" compact max={narrow && open.length > 4 ? 2 : 4} pick="stake" onSwap={swapped("📏")} items={scores.map(s => ({ team: s, p: Number(s.aboveMedianProbability), from: s.liveAboveFrom, fork: forks.median(s), peeks: livePeeks(peeks.median(s), s) }))}
            sides={["below", "above"]} colors={MEDIAN_COLORS} band={[30, 70]} words={{ likely: ["likely below", "likely above"], locked: ["❌ below", "✅ above"] }}
            stakes={scores} history={scoreboard.medianHistory?.week === scoreboard.week ? scoreboard.medianHistory.points : []} games={games} />
          {ticketWinner ? null : <NeedleRace minShown={2} label="🎟️ TICKET RACE" compact max={2} onSwap={swapped("🎟️")} items={scores.map(s => ({ team: s, p: Number(s.topScoreProbability), from: s.liveTopFrom, fork: forks.ticket(s), peeks: livePeeks(peeks.ticket(s), s) }))}
            sides={["no ticket", "ticket"]} colors={["#8b8e86", "#e6c85c"]} words={{ likely: ["long shots", "near lock"], locked: ["❌ out", "🎟️ locked"] }} implied="left"
            fixed chipOdds="right" stakes={scores} history={scoreboard.raffleHistory?.week === scoreboard.week ? scoreboard.raffleHistory.points : []} games={games} />}
          {gWeek && guillotine.teams?.length ? <NeedleRace minShown={2} label="🪓 CHOPPING BLOCK" compact max={2} onSwap={swapped("🪓")} items={guillotine.teams.map(t => ({ team: { ...t, lineup: { starters: t.lineup || [] } }, p: Number(t.chopProbability), from: t.liveChopFrom, peeks: livePeeks(chopPeeks({ ...t, lineup: onDrive(t.lineup) }, guillotine.teams, games), { lineup: { starters: t.lineup || [] } }).map(pk => ({ ...pk, sync: true })) }))}
            good="left" sides={["safe", "chopped"]} colors={["#8fd087", "#d98a86"]} words={{ likely: ["likely safe", "likely chopped"], locked: ["✅ safe", "🪓 chopped"] }} implied="left"
            stakes={guillotine.teams.map(t => ({ lineup: { starters: t.lineup || [] } }))} games={games} /> : null}
          {/* Once the ticket is locked, the chopping block takes its place and it's one line below (Jim, 2026-11-09). */}
          {ticketWinner ? <p className="tv-results-line">🎟️ Ticket: {ticketWinner.team}</p> : null}
          {field.length ? <div className="tv-field"><small className="mini-needles-label">ON THE FIELD NOW</small>
            {field.map(f => <p key={f.id}><b>{f.head}</b>{f.on.length ? " — " + f.on.join(", ") : " — no league starters"}</p>)}</div> : null}
        </aside>
      </div>
      {announcement ? <div className="tv-announce" key={announcement.text + announcement.sub}>
        <span>{announcement.icon}</span><b>{announcement.text}</b>{announcement.sub ? <small>{announcement.sub}</small> : null}
      </div> : null}
      {ticker.length || whatIf || driveGame ? <footer className="tv-ticker" aria-label="Key plays and League Wire">
        {driveGame || whatIf ? <div className="tv-drive">
          {driveGame ? <DriveLine game={driveGame} /> : null}
          <p className={"tv-whatif" + (whatIf?.replay ? " replay" : "")} key={whatIf?.text || ""} aria-live="polite">
            {whatIf ? whatIf.replay ? <><small>LAST PLAY</small> {whatIf.text}</> : <><small>WHAT IF</small> {whatIf.text.replace(/^🏈 this drive: /, "")}</>
              : lastInGame ? <span className="tv-lastplay"><small>LAST PLAY</small> {lastInGame}</span> : "\u00a0"}</p>
        </div> : null}
        <div className="tv-ticker-window"><div className="tv-ticker-track" style={{ animationDuration: `${Math.max(40, ticker.join(" ").length / 6)}s` }}>
          {[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}
        </div></div>
      </footer> : null}
    </div>
  );
}
