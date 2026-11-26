import React, { useEffect, useRef, useState } from "react";
import { money } from "../lib/data.js";
import { oddsMove, shortPlay } from "../lib/playText.js";
import { useWakeLock } from "../lib/wakeLock.js";
import RushField, { RushShift } from "./RushField.jsx";
import { LOCKED, MiniNeedle, NeedleRace, useSyncFocus, useSyncedPeek } from "./Needle.jsx";
import { chopPeeks } from "../lib/tdPeeks.js";
import { driveRooting, driveStakes } from "../lib/rooting.js";
import { feedTeam, lastStanding, survivorModel } from "../../scripts/lib/survivor-model.js";
import nflSeasonOdds from "../../data/current/nfl-season-odds.json";
import managerLinks from "../data/manager-links.json";

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
const TICKER_MAX_AGE_MS = 3 * 60 * 60 * 1000, FRESH_MS = 12000;
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
// A 🏈 beside the team with the ball, in the top ticker too (Jim, 2026-11-15), while the game's in progress.
const gameText = g => {
  const away = (g.teams || []).find(t => !t.home), home = (g.teams || []).find(t => t.home);
  const ball = g.state === "in" ? Number(g.drive?.possession) : null;
  const has = t => ball != null && Number(t.id) === ball;
  return away && home ? `${has(away) ? "🏈 " : ""}${away.abbrev} ${away.score}–${home.score} ${home.abbrev}${has(home) ? " 🏈" : ""}${g.detail ? " · " + g.detail : ""}` : g.name;
};

const GAME_TURN_MS = 12000, HEAT_WINDOW_MS = 15 * 60 * 1000;
// The Rush pop-up (Watch mode): teams a live update moves at least this many yards, the top three, for this long.
const RUSH_POP_YDS = 3, RUSH_POP_MS = 7000, RUSH_SETTLE_MS = 20000;
const ago = at => { const m = Math.round((Date.now() - Date.parse(at)) / 60000); return m < 1 ? "just now" : `${m} min ago`; };
// The strip of screen below what iOS lets the page pin to (Jim, 2026-11-12: "there's still room below, use the part
// of the screen that curves"): the screen's height less the window's, when the page already runs under the status
// bar (so the whole difference is at the bottom); published as --tv-below for the bottom panel to reach into.
function useScreenBelow(on = true) {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const measure = () => {
      const underStatusBar = probe.offsetHeight > 0;
      const gap = Math.round((window.screen?.height || 0) - window.innerHeight);
      const portrait = window.innerHeight > window.innerWidth;
      root.style.setProperty("--tv-below", underStatusBar && portrait && gap > 0 && gap <= 140 ? `${gap}px` : "0px");
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      root.style.removeProperty("--tv-below");
      probe.remove();
    };
  }, [on]);
}
// The Dashboard's dock (Jim, 2026-11-26: "dock the last play / what if hero"): the drive panel and play ticker sit
// fixed just above the phone's tab bar for the whole League view. Publishes the tab bar's height (--tabbar-h, 0
// when it's not pinned to the bottom) and the dock's (--tv-dock, which the page pads by) as they change.
function useDock(on, el) {
  useEffect(() => {
    if (!on || !el) return;
    const root = document.documentElement, bar = document.querySelector(".tab-bar");
    const measure = () => {
      const pinned = bar && getComputedStyle(bar).position === "fixed";
      root.style.setProperty("--tabbar-h", pinned ? `${bar.offsetHeight}px` : "0px");
      root.style.setProperty("--tv-dock", `${el.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (bar) ro.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--tabbar-h");
      root.style.removeProperty("--tv-dock");
    };
  }, [on, el]);
}
// One live game's situation (Jim, 2026-11-12): a little field (home end zone on the left, since yardLine counts
// from the home goal line) with the ball, then "BUF 14–10 KC · 4:12 - 2nd · BUF ball · 2nd & 7 at KC 34".
function DriveLine({ game }) {
  const d = game.drive, away = (game.teams || []).find(t => !t.home), home = (game.teams || []).find(t => t.home);
  const ball = d ? (game.teams || []).find(t => Number(t.id) === Number(d.possession)) : null;
  const at = Number.isFinite(d?.yardLine) ? Math.min(100, Math.max(0, d.yardLine)) : null;
  return <p className="tv-drive-line">
    {at != null && home && away ? <span className={"tv-field-strip" + (d.redZone ? " red" : "")} aria-hidden="true">
      <i>{home.abbrev}</i><span><b style={{ left: `${at}%` }}>🏈</b></span><i>{away.abbrev}</i></span> : null}
    {/* A football beside the team with the ball (Jim, 2026-11-12), in place of "WSH ball". */}
    <span className="tv-drive-text"><b>{away && home ? <>{ball === away ? "🏈 " : ""}{away.abbrev} {away.score}–{home.score} {home.abbrev}{ball === home ? " 🏈" : ""}{game.detail ? " · " + game.detail : ""}</> : gameText(game)}</b>{d?.text ? ` · ${d.text}` : ""}</span>
  </p>;
}

// The survivor pool's last entries, live (Jim, 2026-11-17: "a fun, compact way" in the side panel's open space
// once the guillotine is over). One line per manager: a heart that beats faster as their pick's game turns on them
// (💀 lost, ✅ won), the pick with a life bar at its live win chance, and their expected share of the pot from the
// survivor model's simulation, which moves with every play. Hidden picks show as 🔒 at the model's best guess.
// The gold number is each one's chance to be the last one standing (Jim: everyone takes a safe unused team each
// week, favoring the safest, simulated to the end of the season; lastStanding), with the pot's worth in the tooltip.
const SURVIVOR_MAX = 6;
// First names for the handles (Jim, 2026-11-17: "Jim, Jacob, and Ben if that's cleaner"); others show the handle.
const SURVIVOR_NAMES = { jimreaper: "Jim", mksr: "Jacob", bjm000: "Ben" };
const handleTeam = new Map(Object.entries(managerLinks).flatMap(([id, l]) => (l?.splash || []).map(h => [h.toLowerCase(), Number(id)])));
export function SurvivorLive({ feed, games, week, logos }) {
  if (!feed?.entries?.length) return null;
  const m = survivorModel(feed, games, week);
  if (!m.thisWeek || !m.sim) return null;   // looking ahead (Tue-Wed), every pick is a 🔒 best guess
  const n = m.n;
  const inPlay = feed.entries.filter(e => e.alive || e.eliminatedWeek === n);
  if (!inPlay.length || inPlay.length > SURVIVOR_MAX) return null;
  const gameOf = team => games.find(g => (g.teams || []).some(t => feedTeam(t.abbrev) === team));
  const last = lastStanding(feed, games, week, nflSeasonOdds);
  const rows = [...new Set(inPlay.map(e => e.user))].map(user => {
    const mine = inPlay.filter(e => e.user === user), e = mine[0], pick = e.picks?.[n];
    const g = pick ? gameOf(pick.team) : null;
    let p, state;
    if (!pick) {
      const opts = m.hiddenOptions(e);
      p = opts.length ? opts.reduce((a, o) => a + o.w * o.p, 0) : null;
      state = "hidden";
    } else if (m.settledPick(pick)) {
      p = pick.result === "won" ? 1 : 0;
      state = pick.result;
    } else {
      p = m.chanceOf(pick.team);
      state = g?.state === "in" ? "live" : "pre";
    }
    const win = last?.win[user] ?? null;
    return { user, name: SURVIVOR_NAMES[user.toLowerCase()] || user, n: mine.length, team: pick?.team, p, state, win,
      value: win == null ? m.sim.value[user] || 0 : win * m.pot, teamId: handleTeam.get(user.toLowerCase()) };
  }).sort((a, b) => b.value - a.value);
  const heart = r => r.state === "lost" ? "💀" : r.state === "won" ? "✅" : r.state === "hidden" ? "🔒" : "❤️";
  const beat = r => r.state === "live" || r.state === "pre" ? `${(0.35 + 1.25 * Math.max(0, Math.min(1, r.p ?? 0.5))).toFixed(2)}s` : null;
  return <div className="tv-surv">
    <small className="mini-needles-label">🛡️ SURVIVOR · {inPlay.filter(e => e.picks?.[n]?.result !== "lost" || !m.settledPick(e.picks[n])).length} LEFT · ${Math.round(m.pot)} POT</small>
    {rows.map(r => <p key={r.user} className={"tv-surv-row " + r.state} title={`${r.name}${r.team ? ` on ${r.team}` : ""}: ${r.win == null ? "" : `${Math.round(100 * r.win)}% to be the last one standing, `}worth $${Math.round(r.value)} of the pot`}>
      <span className="tv-surv-heart" style={beat(r) ? { animationDuration: beat(r) } : null}>{heart(r)}</span>
      {logos[r.teamId] ? <img src={logos[r.teamId]} alt="" /> : null}
      <b className="tv-surv-name">{r.name}{r.n > 1 ? ` ×${r.n}` : ""}</b>
      <span className="tv-surv-pick">{r.team || "?"}</span>
      <span className="tv-surv-bar"><i style={{ width: `${Math.round(100 * (r.p ?? 0))}%`, background: r.p == null ? "#8b8e86" : r.p >= 0.7 ? "#72b96a" : r.p >= 0.4 ? "#e6c85c" : "#d96b67" }} /></span>
      <em>{r.p == null ? "—" : `${Math.round(100 * r.p)}%`}</em>
      <strong>{r.win == null ? `$${Math.round(r.value)}` : `🏆${Math.round(100 * r.win)}%`}</strong>
    </p>)}
  </div>;
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
export default function TvView({ forks = { win: () => null, median: () => null, ticket: () => null }, peeks = { win: () => [], median: () => [], ticket: () => [] }, scoreboard, guillotine, livePlays, marquee, survivorFeed, seasonOdds = null, logos = {}, onClose, catchup = null, overlay = null, inline = false, onOpenMatchup = null, onOpenStat = null }) {
  // inline (Jim, 2026-11-21): the Dashboard's League view, a block in the page: no scroll lock, wake lock or controls.
  useWakeLock(!inline);
  useScreenBelow(!inline);
  // The page underneath stays put (Jim, 2026-11-08: Watch mode wouldn't scroll back down on a phone, the
  // swipe went to the page under it).
  useEffect(() => {
    if (inline) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const idle = useIdleCursor();
  // Back after a while (CatchUp.jsx): the needles start where you left them, then swing to now.
  const was = (kind, t, now) => catchup ? catchup.oddsOf(kind, t.teamId, now) : now;
  const narrow = useNarrow();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const scores = scoreboard.scores || [], games = scoreboard.nflGames || [];
  // Inline ticket needles (Jim, 2026-11-21): the top 4 until the top two hold 75%+ of the chance, then those two.
  const ticketTop = scores.map(t => Number(t.topScoreProbability) || 0).sort((x, y) => y - x);
  const ticketShown = ticketTop[0] + (ticketTop[1] || 0) >= 75 ? 2 : 4;
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
  // Inline, tiles always pair up (Jim, 2026-11-23): every open matchup, plus the latest decided one when that count
  // is odd; it stays until another matchup is decided to pair with it.
  const doneTiles = [...done].sort((x, y) => decidedAt(y) - decidedAt(x)).slice(0, inline ? open.length % 2 : Math.max(0, capacity - open.length));
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

  // The ticker: the newest league plays, newest first (Jim, 2026-11-26: "the most recent plays can be in the ticker
  // instead", in place of the Dashboard's Latest plays list), then in Watch mode the League Wire's top stories.
  const plays = Number(livePlays?.week) === week ? livePlays.plays || [] : [];
  const recent = plays.filter(p => p.wallclock && Number(p.points) && Date.now() - Date.parse(p.wallclock) < TICKER_MAX_AGE_MS)
    .sort((x, y) => Date.parse(y.wallclock) - Date.parse(x.wallclock)).slice(0, TICKER_PLAYS)
    .map(p => ({ id: String(p.id || p.wallclock + p.player), text: `${Number(p.points) > 0 ? "+" : ""}${Number(p.points).toFixed(2)} ${p.player} ${shortPlay(p)} · ${teamName.get(Number(p.fantasyTeamId)) || ""}${p.momentum?.shift >= 1 ? ` · ${p.momentum.toward} ${oddsMove(p.momentum.winProbability, p.momentum.shift)}` : ""}` }));
  const stories = inline ? [] : (Number(marquee?.week) === week ? marquee.stories || [] : []).slice(0, 4).map(s => ({ text: s.text }));
  const ticker = [...recent, ...stories];
  // A play that just came in flashes gold (Jim, 2026-11-26), and the ticker starts over so it's the first to scroll by.
  const seenPlays = useRef(null);
  const [fresh, setFresh] = useState(() => new Set());
  const recentKey = recent.map(r => r.id).join("|");
  useEffect(() => {
    const seen = seenPlays.current;
    seenPlays.current = new Set([...(seen || []), ...recent.map(r => r.id)]);
    const added = seen ? recent.map(r => r.id).filter(id => !seen.has(id)) : [];
    if (!added.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [recentKey]);

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
  // Turns go to the drives with the most at stake (Jim, 2026-11-26: "rotate to the drives with most at stake /
  // shifting the odds the most"): a game's heat is what its drive could move in the open matchups (driveStakes)
  // plus a quarter of the win odds its league plays moved in the last 15 minutes. Games under a fifth of the
  // hottest sit out; each turn goes to the highest heat × time since its last turn, so the big drive comes back
  // most often and the rest still get a look.
  const recentShift = g => plays.filter(p => String(p.eventId) === String(g.id) && p.wallclock && Date.now() - Date.parse(p.wallclock) < HEAT_WINDOW_MS)
    .reduce((sum, p) => sum + (Number(p.momentum?.shift) || 0), 0);
  const heat = new Map(turnGames.map(g => [String(g.id), driveStakes({ game: g, pairs: open }) + 0.25 * recentShift(g)]));
  const hottest = Math.max(0, ...heat.values());
  const rotation = turnGames.length ? turnGames.filter(g => !(hottest > 0) || heat.get(String(g.id)) >= 0.2 * hottest)
    .sort((x, y) => heat.get(String(y.id)) - heat.get(String(x.id))) : liveGames;
  const turnRef = useRef({ rotation, heat, last: new Map() });
  turnRef.current.rotation = rotation; turnRef.current.heat = heat;
  const [turnId, setTurnId] = useState(null);
  useEffect(() => {
    if (rotation.length < 2) return;
    const id = setInterval(() => {
      const { rotation: rot, heat: h, last } = turnRef.current, now = Date.now();
      const next = rot.reduce((best, g) => {
        const w = Math.max(0.01, h.get(String(g.id)) || 0) * (now - (last.get(String(g.id)) || 0));
        return !best || w > best.w ? { id: String(g.id), w } : best;
      }, null);
      if (next) setTurnId(next.id);
    }, GAME_TURN_MS);
    return () => clearInterval(id);
  }, [rotation.length]);
  const turnGame = rotation.find(g => String(g.id) === turnId) || rotation[0] || null;
  useEffect(() => { if (turnGame) turnRef.current.last.set(String(turnGame.id), Date.now()); }, [turnGame?.id]);
  useSyncFocus(rotation.length > 1 && turnGame ? String(turnGame.id) : null);
  const shownGame = whatIf?.game ? liveGames.find(g => String(g.id) === String(whatIf.game)) : null;
  const driveGame = shownGame || turnGame;
  // Between what-ifs the line shows that game's last play (Jim, 2026-11-12: "not seeing the latest play"): any play,
  // from the scoreboard, else the newest league play in it.
  const lastInGame = (() => {
    if (!driveGame) return null;
    if (driveGame.drive?.lastPlay) return String(driveGame.drive.lastPlay).trim().replace(/^\([^)]*\)\s*/, "");
    const p = plays.filter(x => String(x.eventId) === String(driveGame.id)).sort((x, y) => Date.parse(y.wallclock) - Date.parse(x.wallclock))[0];
    return p ? `${p.player} ${shortPlay(p)}` : null;
  })();
  // The play hero: the shown game's situation, then the what-if, or the last play as its needles jump. In Watch
  // mode on a wide screen it's a big card in the side column (Jim, 2026-11-26: "is there room for that on the full
  // screen version? Keep it on live action"); on a phone it's the bottom panel, and on the Dashboard it docks.
  const hero = driveGame || whatIf ? <div className="tv-drive">
    {driveGame ? <DriveLine game={driveGame} /> : null}
    <p className={"tv-whatif" + (whatIf?.replay ? " replay" : "")} key={whatIf?.text || ""} aria-live="polite">
      {/* A replay is the last play with a league player in it, not always the game's last play (Jim, 2026-11-12:
          Nabers showed while Washington had the ball), so it says so, and how long ago. */}
      {whatIf ? whatIf.replay ? <><span><small>LEAGUE PLAY{whatIf.at ? ` · ${ago(whatIf.at)}` : ""}</small> {whatIf.text}</span>{whatIf.move ? <em>{whatIf.move}</em> : null}</> : <><small>WHAT IF</small> {whatIf.text.replace(/^🏈 this drive: /, "")}</>
        : lastInGame ? <span className="tv-lastplay"><small>LAST PLAY</small> {lastInGame}</span> : "\u00a0"}</p>
  </div> : null;
  const heroSide = !inline && !narrow;
  // The Rush's field in Watch mode on a wide screen (Jim, 2026-11-26). On a phone it's only the pop-up on a big swing
  // (Jim: "drop the playoff field, and only pop it up on a play"), so the needles fit one screen with the Live Action
  // hero docked at the bottom and the ticker under it, in the curved strip.
  const showRush = !inline && !narrow && Boolean(seasonOdds?.teams?.length);
  const rushPops = !inline && Boolean(seasonOdds?.teams?.length);
  // A big swing pops up the lanes that moved (Jim, 2026-11-26), with the biggest league play since the last update,
  // since the odds move on each refresh rather than on the snap. ?rushdemo in the address shows a made-up one.
  const rushSeen = useRef(null);
  const [rushPop, setRushPop] = useState(null);
  const rushKey = (seasonOdds?.teams || []).map(t => `${t.teamId}:${t.playoffOdds}`).join(",");
  useEffect(() => {
    if (!rushPops) return;
    const now = Object.fromEntries(seasonOdds.teams.map(t => [t.teamId, Number(t.playoffOdds)]));
    const before = rushSeen.current;
    rushSeen.current = { odds: now, at: Date.now(), opened: before?.opened || Date.now() };
    let moves = [];
    // The page shows the saved odds first, then the live ones a few seconds later: that first catch-up isn't a swing.
    if (before && Date.now() - before.opened > RUSH_SETTLE_MS) moves = seasonOdds.teams.map(t => ({ team: t, from: before.odds[t.teamId], to: now[t.teamId] }))
      .filter(m => Number.isFinite(m.from) && Math.abs(m.to - m.from) >= RUSH_POP_YDS);
    else if (!before && /[?&]rushdemo/.test(window.location.search)) moves = seasonOdds.teams.filter(t => now[t.teamId] > 15 && now[t.teamId] < 85).slice(0, 3)
      .map((t, k) => ({ team: t, from: Math.min(99, Math.max(1, now[t.teamId] + [-9, 6, -4][k])), to: now[t.teamId] }));
    if (!moves.length) return;
    const since = before ? before.at - 60000 : Date.now() - 10 * 60000;
    const big = plays.filter(p => p.wallclock && Date.parse(p.wallclock) >= since && Number(p.points)).sort((x, y) => Math.abs(y.points) - Math.abs(x.points))[0];
    setRushPop({ key: Date.now(), cause: big ? `${big.player} ${shortPlay(big)}` : null,
      moves: moves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, 3) });
  }, [rushKey, rushPops]);
  // It waits for a full-screen announcement (a clinch, a swap) to finish, then gets its own seconds.
  useEffect(() => {
    if (!rushPop || announcement) return;
    const t = setTimeout(() => setRushPop(null), RUSH_POP_MS);
    return () => clearTimeout(t);
  }, [rushPop?.key, Boolean(announcement)]);
  const [dockEl, setDockEl] = useState(null);
  useDock(inline, dockEl);
  return (
    <div className={"tv" + (inline ? " tv-inline" : idle ? " idle" : "")}>
      <header className="tv-head">
        <div>{narrow ? null : <span className="section-kicker">ON THURSDAYS WE WATCH FOOTBALL · WEEK {week}</span>}
          {/* On a phone, two or more live games scroll by on one line instead of wrapping (Jim, 2026-11-08). */}
          {narrow && liveGames.length > 1
            ? <h1 className="tv-head-scroll"><span className="needle-live">● LIVE</span><span className="tv-head-window"><span className="tv-head-track" style={{ animationDuration: `${Math.max(12, liveGames.map(gameText).join("").length / 4)}s` }}>
                {[0, 1].map(k => <span key={k}>{liveGames.map(gameText).join("   ·   ")}</span>)}</span></span></h1>
            : <h1>{liveGames.length ? <><span className="needle-live">● LIVE</span> {liveGames.map(gameText).join("   ·   ")}</> : narrow ? `Week ${week} game day` : "Game day"}</h1>}</div>
        {inline ? null : <div className="tv-actions">
          {!fullscreen && document.documentElement.requestFullscreen ? <button type="button" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>⛶ Full screen</button> : null}
          <button type="button" onClick={sound.toggle} aria-pressed={sound.on} title={sound.on ? "Sound on: a chime for each clinch" : "Turn on a chime for each clinch"}>{sound.on ? "🔊" : "🔇"} Sound</button>
          <button type="button" onClick={onClose} aria-label="Leave watch mode">✕</button>
        </div>}
      </header>
      <div className="tv-body">
        <section className="tv-left">
          {tiles.length ? <div className={"tv-matchups n" + tiles.length} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {tiles.map(([a, b]) => { const settled = isDecided([a, b]), winner = Number(a.winProbability) >= Number(b.winProbability) ? a : b;
              // Inline, a tile opens the full matchup (Jim, 2026-11-22).
              return <div key={a.matchupId} className={"tv-tile" + (flashing.has(a.matchupId) ? " flash" : "") + (settled ? " decided" : "")} onClick={inline && onOpenMatchup ? () => onOpenMatchup(a.matchupId) : undefined} style={inline && onOpenMatchup ? { cursor: "pointer" } : undefined}>
              <div className="tv-score">
                {[[a, A_COLOR], [b, B_COLOR]].map(([t, c]) => <p key={t.teamId} style={{ color: c }}>
                  <span>{logos[t.teamId] ? <img src={logos[t.teamId]} alt="" /> : null}{t.team}</span>
                  {narrow ? <small className="tv-left-count">{toPlay(t)} left</small> : null}<b>{money(t.score)}</b></p>)}
              </div>
              <MiniNeedle team={b} stakes={[a, b]} fork={settled ? null : forks.win(a, b)} peeks={settled ? [] : livePeeks(peeks.win(a, b), a, b)} p={was("win", b, Number(b.winProbability))} from={b.liveWinFrom} sides={[a.team, b.team]} colors={[A_COLOR, B_COLOR]} short={narrow || settled}
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
          {/* Inline, the median and ticket needles open them as pop-ups (Jim, 2026-11-22). */}
          <div onClick={inline && onOpenStat ? () => onOpenStat("median") : undefined} style={inline ? { cursor: "pointer" } : undefined}>
          <NeedleRace label="MEDIAN LINE" compact max={inline ? null : narrow ? 2 : 4} even={inline} pick="stake" onSwap={swapped("📏")} items={scores.map(s => ({ team: s, p: was("med", s, Number(s.aboveMedianProbability)), from: s.liveAboveFrom, fork: forks.median(s), peeks: livePeeks(peeks.median(s), s) }))}
            sides={["below", "above"]} colors={MEDIAN_COLORS} band={[30, 70]} words={{ likely: ["likely below", "likely above"], locked: ["❌ below", "✅ above"] }}
            stakes={scores} history={scoreboard.medianHistory?.week === scoreboard.week ? scoreboard.medianHistory.points : []} games={games} />
          </div>
          {ticketWinner ? null : <div onClick={inline && onOpenStat ? () => onOpenStat("ticket") : undefined} style={inline ? { cursor: "pointer" } : undefined}><NeedleRace minShown={inline ? ticketShown : 2} even={inline} label="🎟️ TICKET RACE" compact max={inline ? ticketShown : 2} onSwap={swapped("🎟️")} items={scores.map(s => ({ team: s, p: was("ticket", s, Number(s.topScoreProbability)), from: s.liveTopFrom, fork: forks.ticket(s), peeks: livePeeks(peeks.ticket(s), s) }))}
            sides={["no ticket", "ticket"]} colors={["#8b8e86", "#e6c85c"]} words={{ likely: ["long shots", "near lock"], locked: ["❌ out", "🎟️ locked"] }} implied="left"
            fixed chipOdds="right" stakes={scores} history={scoreboard.raffleHistory?.week === scoreboard.week ? scoreboard.raffleHistory.points : []} games={games} /></div>}
          {gWeek && guillotine.teams?.length ? <NeedleRace minShown={2} label="🪓 CHOPPING BLOCK" compact max={2} onSwap={swapped("🪓")} items={guillotine.teams.map(t => ({ team: { ...t, lineup: { starters: t.lineup || [] } }, p: Number(t.chopProbability), from: t.liveChopFrom, peeks: livePeeks(chopPeeks({ ...t, lineup: onDrive(t.lineup) }, guillotine.teams, games), { lineup: { starters: t.lineup || [] } }).map(pk => ({ ...pk, sync: true })) }))}
            good="left" sides={["safe", "chopped"]} colors={["#8fd087", "#d98a86"]} words={{ likely: ["likely safe", "likely chopped"], locked: ["✅ safe", "🪓 chopped"] }} implied="left"
            stakes={guillotine.teams.map(t => ({ lineup: { starters: t.lineup || [] } }))} games={games} /> : null}
          {/* Once the ticket is locked, the chopping block takes its place and it's one line below (Jim, 2026-11-09). */}
          {ticketWinner ? <p className="tv-results-line">🎟️ Ticket: {ticketWinner.team}</p> : null}
          {heroSide && hero ? <div className="tv-hero"><small className="mini-needles-label">🏈 LIVE ACTION</small>{hero}</div> : null}
          {/* The 100-Yard Rush (Jim, 2026-11-26) takes the room the on-the-field list had; Live Action covers the drive. */}
          {showRush ? <div className="tv-rush"><small className="mini-needles-label">🏈 100-YARD RUSH</small>
            <RushField seasonOdds={seasonOdds} logos={logos} weekStarted={games.some(g => g.state !== "pre")} compact /></div> : null}
          {/* Survivor left Watch mode for room (Jim, 2026-11-21): managers with entries see them in their game-day view. */}
          {field.length && !showRush ? <div className="tv-field"><small className="mini-needles-label">ON THE FIELD NOW</small>
            {field.map(f => <p key={f.id}><b>{f.head}</b>{f.on.length ? " — " + f.on.join(", ") : " — no league starters"}</p>)}</div> : null}
        </aside>
      </div>
      {overlay}
      {rushPop && !announcement && !catchup?.from ? <div className="tv-rushpop" key={rushPop.key}>
        <small className="mini-needles-label">🏈 PLAYOFF RACE SHIFT</small>
        {rushPop.cause ? <p className="tv-rushpop-cause">Biggest play since the last update: <b>{rushPop.cause}</b></p> : null}
        <RushShift moves={rushPop.moves} math={seasonOdds?.math || {}} logos={logos} />
      </div> : null}
      {announcement ? <div className="tv-announce" key={announcement.text + announcement.sub}>
        <span>{announcement.icon}</span><b>{announcement.text}</b>{announcement.sub ? <small>{announcement.sub}</small> : null}
      </div> : null}
      {ticker.length || (hero && !heroSide) ? <footer className="tv-ticker" ref={setDockEl} aria-label="Latest plays and League Wire">
        {heroSide ? null : hero}
        <div className="tv-ticker-window"><div className="tv-ticker-track" key={recent[0]?.id || ""} style={{ animationDuration: `${Math.max(40, ticker.map(t => t.text).join(" ").length / 6)}s` }}>
          {[...ticker, ...ticker].map((t, i) => <span key={i} className={t.id && fresh.has(t.id) ? "fresh" : undefined}>{t.text}</span>)}
        </div></div>
      </footer> : null}
    </div>
  );
}
