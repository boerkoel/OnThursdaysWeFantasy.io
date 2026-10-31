import React, { useEffect, useState } from "react";
import { NOTIFY_SERVICE, money } from "../lib/data.js";
import { feedTeam } from "../../scripts/lib/survivor-model.js";
import { Field } from "./SurvivorTab.jsx";

// Games tab (Jim, 2026-10-29): the NFL slate through the league's eyes.
// - All games: every game with score, clock, win odds, possession and the
//   betting line (open → now, from the worker's /lines history); open a game
//   for everyone in the league with players in it (main league and 🪓
//   guillotine), survivor riders, and the game's latest league plays.
// - My players: one manager's starters in both leagues and survivor picks,
//   grouped by NFL game, with the latest plays they've made.
// - Opponent: the same for that manager's head-to-head opponent this week.
// All games sorts by kickoff, 🔥 drama (Jim, 2026-10-31, after 538's bracket
// excitement index: see rateGame), closest line, over/under, fantasy stakes
// or NFL playoff stakes.
const LINES_POLL_MS = 10 * 60 * 1000;
const FEED_PLAYS = 12;
const GAME_PLAYS = 5;
const SORTS = [["drama", "🔥 Drama"], ["kickoff", "Kickoff"], ["line", "Closest line"], ["total", "O/U"], ["fantasy", "Fantasy stakes"], ["playoff", "Playoff stakes"]];
// The league's NFL rooting interests (Jim, 2026-10-31): fans per team; the Rams' hometown fans count at a
// fair-weather discount.
const LEAGUE_FANS = { LV: 1, KC: 2, SF: 3, LAR: 1.5, DET: 1 };
const FAN_NAMES = { LV: "Raiders", KC: "Chiefs", SF: "Niners", LAR: "Rams", DET: "Lions" };
const lev = p => 4 * p * (1 - p);   // 1 at a coin flip, 0 when decided
const clamp01 = x => Math.max(0, Math.min(1, x));
const readPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const logo = abbrev => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbrev).toLowerCase()}.png`;

function useLines() {
  const [lines, setLines] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${NOTIFY_SERVICE}/lines`).then(r => r.ok ? r.json() : null).then(d => { if (alive && d) setLines(d); }).catch(() => {});
    load();
    const timer = setInterval(load, LINES_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return lines;
}

// "BUF −3" (spread is the home team's), "PK" for a pick'em.
const spreadText = (s, home, away) => s == null ? "—" : s === 0 ? "PK" : s < 0 ? `${home} −${-s}` : `${away} −${s}`;
function LineMove({ line, home, away }) {
  if (!line?.open) return null;
  const now = line.moves?.[line.moves.length - 1] || line.open;
  const moved = now.spread !== line.open.spread;
  const totalMoved = now.total !== line.open.total;
  const shift = now.spread != null && line.open.spread != null ? Math.abs(now.spread - line.open.spread) : 0;
  return <div className={"gm-line" + (shift >= 3 ? " big" : "")} title="Betting line: the opening line, then the latest (ESPN, DraftKings). Saved every 30 minutes until kickoff">
    <span>Line {moved ? <>{spreadText(line.open.spread, home, away)} → <b>{spreadText(now.spread, home, away)}</b></> : <b>{spreadText(now.spread, home, away)}</b>}</span>
    {now.total != null ? <span>O/U {totalMoved ? <>{line.open.total} → <b>{now.total}</b></> : <b>{now.total}</b>}</span> : null}
  </div>;
}

const playTimeText = p => p.period ? `Q${p.period > 4 ? "OT" : p.period} ${p.clock || ""}`.trim() : "";
function PlayRow({ play, tag }) {
  return <div className="gm-play">
    <strong className={play.points < 0 ? "negative" : ""}>{play.points > 0 ? "+" : ""}{money(play.points)}</strong>
    <span><b>{play.player}</b>{tag ? <em className="gm-tag">{tag}</em> : null} {play.text}</span>
    <small>{playTimeText(play)}</small>
  </div>;
}

export default function GamesTab({ scoreboard, guillotine, livePlays, survivorFeed, teams, logos, managerLinks, myTeamId }) {
  const [view, setView] = useState("all");
  const [managerId, setManagerId] = useState(myTeamId || null);
  const [open, setOpen] = useState(() => new Set());
  const [sort, setSortState] = useState(() => readPref("gamesSort", "drama"));
  const setSort = v => { setSortState(v); writePref("gamesSort", v); };
  useEffect(() => { if (managerId == null && myTeamId) setManagerId(myTeamId); }, [myTeamId]);
  const lines = useLines();
  const week = Number(scoreboard.week);
  const games = scoreboard.nflGames || [];
  const scores = scoreboard.scores || [];
  const gThisWeek = Number(guillotine?.week) === week;
  const playsThisWeek = Number(livePlays?.week) === week;
  const lineOf = g => lines && Number(lines.week) === week ? lines.games?.[g.id] : null;

  // Every league starter, tagged with its NFL game.
  const gameOfTeam = new Map(games.flatMap(g => (g.teams || []).map(t => [Number(t.id), g])));
  const abbrevOf = (g, proTeamId) => (g?.teams || []).find(t => Number(t.id) === Number(proTeamId))?.abbrev || "";
  const starters = [
    ...scores.flatMap(s => (s.lineup?.starters || []).map(p => ({ ...p, league: "main", teamId: Number(s.teamId), owner: s.team }))),
    ...(gThisWeek ? (guillotine.teams || []).flatMap(t => (t.lineup || []).map(p => ({ ...p, league: "g", teamId: Number(t.teamId), owner: t.team }))) : [])
  ].map(p => ({ ...p, game: gameOfTeam.get(Number(p.proTeamId)) })).filter(p => p.game);

  // Survivor picks this week (feed abbreviations → ESPN's).
  const svWeek = Number(survivorFeed?.contest?.currentWeek);
  const svPicks = svWeek === week ? (survivorFeed?.entries || []).filter(e => e.alive || e.eliminatedWeek === svWeek)
    .map(e => ({ user: e.user, team: e.picks?.[svWeek]?.team })).filter(x => x.team) : [];
  const gameOfAbbrev = abbrev => games.find(g => (g.teams || []).some(t => feedTeam(t.abbrev) === abbrev));

  const mainPlays = playsThisWeek ? (livePlays.plays || []) : [];
  const gPlays = playsThisWeek ? (livePlays.guillotinePlays || []) : [];
  const newestFirst = (a, b) => Date.parse(b.wallclock || 0) - Date.parse(a.wallclock || 0);

  // Who we're following: a main-league team, plus the same manager's guillotine team and survivor entries.
  const myScore = scores.find(s => Number(s.teamId) === Number(managerId));
  const followId = view === "opp" ? Number(myScore?.opponentId) : Number(managerId);
  const followScore = scores.find(s => Number(s.teamId) === followId);
  const link = managerLinks[String(followId)] || {};
  const gid = link.guillotine != null && gThisWeek && (guillotine.teams || []).some(t => Number(t.teamId) === Number(link.guillotine)) ? Number(link.guillotine) : null;
  const gTeam = gid != null ? guillotine.teams.find(t => Number(t.teamId) === gid) : null;
  const handles = new Set(link.splash || []);
  const isFollowed = p => (p.league === "main" && p.teamId === followId) || (p.league === "g" && p.teamId === gid);

  // Each game's stakes and drama (0-100). Pieces, each 0-1:
  // - close: a coin flip before kickoff (the betting line); live, how close it is weighted by how late it is
  // - upset: how far the pregame favorite has fallen
  // - fantasy: league starters' projections weighted by how undecided their matchups (or chop races) are, vs the week's biggest
  // - playoff: how much both NFL teams' playoff odds are still in play (FPI)
  // - survivor: survivor entries riding a side, weighted by its chance to lose
  // - breakout: a starter under 50% rostered beating his projection by 6+ points
  // - shootout: the over/under (pregame only)
  // - surprise: live, on pace to blow past the over/under (a game nobody circled turning wild)
  // - fans: the league's own rooting interests (LEAGUE_FANS)
  const scoreOf = new Map(scores.map(s => [Number(s.teamId), s]));
  const chopOf = new Map(gThisWeek ? (guillotine.teams || []).map(t => [Number(t.teamId), Number(t.chopProbability) || 0]) : []);
  const rateGame = g => {
    const home = (g.teams || []).find(t => t.home), away = (g.teams || []).find(t => !t.home);
    if (!home || !away) return null;
    const line = lineOf(g), latest = line?.moves?.[line.moves.length - 1] || line?.open;
    const preHome = latest?.homeWin != null ? latest.homeWin / 100 : g.state === "pre" ? home.winChance : null;
    const inGame = starters.filter(p => p.game === g);
    let fantasyRaw = 0;
    for (const p of inGame) {
      const w = p.league === "main" ? lev((Number(scoreOf.get(p.teamId)?.winProbability) || 50) / 100) : lev((chopOf.get(p.teamId) || 0) / 100);
      fantasyRaw += (p.projection || 0) * w;
    }
    // The H2H matchup and the chop race this game could swing most: undecided (leverage) × the league
    // points riding on this game.
    const ptsBy = new Map();
    for (const x of inGame) { const k = x.league + x.teamId; const v = ptsBy.get(k) || { pts: 0, names: [] }; v.pts += x.projection || 0; v.names.push(x.name); ptsBy.set(k, v); }
    let h2h = null, chop = null;
    for (const sc of scores) {
      if (Number(sc.teamId) > Number(sc.opponentId)) continue;   // each matchup once
      const a = ptsBy.get("main" + Number(sc.teamId)), b = ptsBy.get("main" + Number(sc.opponentId));
      if (!a && !b) continue;
      const wp = (Number(sc.winProbability) || 50) / 100;
      const v = lev(wp) * clamp01(((a?.pts || 0) + (b?.pts || 0)) / 30);
      if (!h2h || v > h2h.v) h2h = { v, text: `Could swing ${sc.team} vs ${sc.opponent} (${Math.round(wp * 100)}–${Math.round((1 - wp) * 100)}): ${[...(a?.names || []), ...(b?.names || [])].slice(0, 3).join(", ")}` };
    }
    for (const t of gThisWeek ? guillotine.teams || [] : []) {
      const mine = ptsBy.get("g" + Number(t.teamId)), c = (Number(t.chopProbability) || 0) / 100;
      if (!mine || c < 0.05) continue;
      const v = clamp01(lev(Math.min(c, 0.5)) * clamp01(mine.pts / 20) * 1.2);
      if (!chop || v > chop.v) chop = { v, text: `🪓 Could decide the chop: ${t.team} (${Math.round(c * 100)}% chop odds) has ${mine.names.slice(0, 2).join(", ")}` };
    }
    const riders = svPicks.filter(x => gameOfAbbrev(x.team) === g);
    const sideOf = abbrev => [home, away].find(t => feedTeam(t.abbrev) === abbrev);
    const svRisk = riders.reduce((a, x) => a + (g.completed ? 0 : 1 - (sideOf(x.team)?.winChance ?? 0.5)), 0) / Math.max(1, svPicks.length);
    const playoff = [home, away].reduce((a, t) => a + (t.playoffOdds == null ? 0 : lev(t.playoffOdds / 100)), 0) / 2;
    const progress = g.state === "in" ? clamp01(((Number(g.period) || 1) - 1 + (900 - (Number(g.clock) || 0)) / 900) / 4) : g.completed ? 1 : 0;
    const p = home.winChance ?? 0.5;
    const close = g.state === "pre" ? (preHome == null ? 0 : lev(preHome)) : g.completed ? 0 : lev(p) * (0.4 + 0.6 * progress);
    const favHome = preHome != null && preHome >= 0.5;
    const upset = preHome == null || g.state === "pre" ? 0 : clamp01((favHome ? preHome - (g.completed ? (home.score > away.score ? 1 : 0) : p) : (1 - preHome) - (g.completed ? (away.score > home.score ? 1 : 0) : 1 - p)) * 1.4);
    const boomer = inGame.filter(x => x.owned != null && x.owned < 50 && x.projection != null && x.actual - x.projection >= 6).sort((a, b) => (b.actual - b.projection) - (a.actual - a.projection))[0];
    const breakout = boomer ? clamp01((boomer.actual - boomer.projection) / 15) : 0;
    const shootout = latest?.total != null ? clamp01((latest.total - 38) / 16) : 0;
    const pace = progress >= 0.25 ? (home.score + away.score) / progress : null;
    const surprise = pace != null && latest?.total != null ? clamp01((pace - latest.total) / 20) : 0;
    const fanTeams = [away, home].filter(t => LEAGUE_FANS[t.abbrev]);
    const fans = clamp01(fanTeams.reduce((a, t) => a + LEAGUE_FANS[t.abbrev], 0) / 3);
    const fav = favHome ? home : away;
    return { g, home, away, spread: latest?.spread ?? null, total: latest?.total ?? null, fantasyRaw, playoff, svRisk, close, upset, breakout, shootout, surprise, fans, inGame, riders,
      why: [
        [h2h?.v || 0, h2h?.text || ""],
        [chop?.v || 0, chop?.text || ""],
        [close >= 0.85 ? close : 0, g.state === "pre" ? `Coin flip: ${Math.round((preHome ?? 0.5) * 100)}–${Math.round((1 - (preHome ?? 0.5)) * 100)}` : `Too close to call: ${Math.round(p * 100)}–${Math.round((1 - p) * 100)}`],
        [upset, `Upset ${g.completed ? "" : "brewing"}: ${fav.abbrev} was ${Math.round(Math.max(preHome ?? 0, 1 - (preHome ?? 0)) * 100)}% before kickoff`.replace("Upset :", "Upset:")],
        [svRisk * 3, `🛡️ ${riders.length} survivor ${riders.length === 1 ? "entry" : "entries"} riding ${[...new Set(riders.map(x => x.team))].join("/")}`],
        [breakout, boomer ? `Breakout: ${boomer.name} (${boomer.owned}% rostered) has ${money(boomer.actual)}` : ""],
        [playoff * 0.8, `Playoff stakes: ${away.abbrev} ${Math.round(away.playoffOdds ?? 0)}%, ${home.abbrev} ${Math.round(home.playoffOdds ?? 0)}%`],
        [g.state === "pre" ? shootout * 0.6 : 0, `Shootout watch: O/U ${latest?.total}`],
        [surprise, `Off script: on pace for ${Math.round(pace ?? 0)} points, O/U was ${latest?.total}`],
        [fans * 0.7, `League rooting interest: ${fanTeams.map(t => `${FAN_NAMES[t.abbrev]} fans`).join(" vs ")}`]
      ] };
  };
  const rated = games.map(rateGame).filter(Boolean);
  const maxFantasy = Math.max(1, ...rated.map(r => r.fantasyRaw));
  for (const r of rated) {
    r.fantasy = r.fantasyRaw / maxFantasy;
    const sv = clamp01(r.svRisk * 3);
    r.drama = Math.round(100 * (r.g.state === "pre"
      ? 0.25 * r.close + 0.1 * r.shootout + 0.25 * r.fantasy + 0.15 * r.playoff + 0.15 * sv + 0.1 * r.fans
      : 0.2 * r.close + 0.15 * r.upset + 0.18 * r.fantasy + 0.08 * r.playoff + 0.12 * sv + 0.08 * r.breakout + 0.09 * r.surprise + 0.1 * r.fans));
    r.reasons = r.why.filter(([v, text]) => v >= 0.35 && text).sort((a, b) => b[0] - a[0]).map(([, text]) => text);
  }
  const ratingOf = new Map(rated.map(r => [r.g.id, r]));

  const statusText = g => g.completed ? "Final" : g.state === "in" ? (g.detail || "Live") : new Date(g.kickoff).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const order = g => g.state === "in" ? 0 : g.state === "pre" ? 1 : 2;
  const byKickoff = (a, b) => order(a) - order(b) || String(a.kickoff).localeCompare(String(b.kickoff));
  const sortedGames = [...games].sort(byKickoff);
  const finalsLast = (a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
  const sortKey = {
    drama: r => -r.drama, line: r => r.spread == null ? 99 : Math.abs(r.spread), total: r => -(r.total ?? 0),
    fantasy: r => -r.fantasy, playoff: r => -r.playoff
  }[sort];
  const allGames = sortKey ? [...games].sort((a, b) => finalsLast(a, b) || (ratingOf.get(a.id) && ratingOf.get(b.id) ? sortKey(ratingOf.get(a.id)) - sortKey(ratingOf.get(b.id)) : 0) || byKickoff(a, b)) : sortedGames;

  const gameHead = g => {
    const home = (g.teams || []).find(t => t.home), away = (g.teams || []).find(t => !t.home);
    if (!home || !away) return null;
    const side = t => <div className={"gm-side" + (g.completed && t.score < (t === home ? away : home).score ? " lost" : "")}>
      <img src={logo(t.abbrev)} alt="" loading="lazy" /><span className="gm-side-name"><b>{t.abbrev}{g.drive?.possession === t.id ? <span title="Has the ball"> 🏈</span> : null}</b>
        {t.record || t.playoffOdds != null ? <small title="Record · chance to make the playoffs (ESPN FPI)">{[t.record, t.playoffOdds != null ? `${Math.round(t.playoffOdds)}% playoffs` : null].filter(Boolean).join(" · ")}</small> : null}</span>
      {g.state !== "pre" ? <span className="gm-score">{t.score}</span> : null}
      {!g.completed && t.winChance != null ? <small className={t.winChance >= 0.5 ? "fav" : ""}>{Math.round(t.winChance * 100)}%</small> : null}
    </div>;
    return <>
      <div className="gm-head"><span className={g.state === "in" ? "live" : ""}>{statusText(g)}</span>
        {ratingOf.get(g.id) ? <span className={"gm-drama" + (ratingOf.get(g.id).drama >= 60 ? " hot" : "")} title={`Drama ${ratingOf.get(g.id).drama}/100${ratingOf.get(g.id).reasons.length ? ": " + ratingOf.get(g.id).reasons.join(" · ") : ""}`}>🔥 {ratingOf.get(g.id).drama}</span> : null}</div>
      <div className="gm-sides">{side(away)}<span className="gm-at">@</span>{side(home)}</div>
      {g.drive ? <Field drive={g.drive} homeHasBall={g.drive.possession === home.id} /> : null}
      <LineMove line={lineOf(g)} home={home.abbrev} away={away.abbrev} />
      {ratingOf.get(g.id)?.reasons.length ? <p className="gm-why">{ratingOf.get(g.id).reasons.slice(0, sort === "drama" ? 2 : 1).join(" · ")}</p> : null}
    </>;
  };

  const playerRow = (p, showOwner) => <div className={"gm-player" + (p.league === "g" ? " g" : "")} key={p.league + p.teamId + p.id}>
    <span className="gm-player-name"><b>{p.name}</b> <small>{p.pos} · {abbrevOf(p.game, p.proTeamId)}</small></span>
    <span className="gm-owner">{p.league === "g" ? "🪓 " : ""}{showOwner ? p.owner : p.league === "g" ? "Guillotine" : "Main"}</span>
    <strong>{p.game.state === "pre" ? "—" : money(p.actual || 0)}</strong>
    <small className="gm-proj">{p.projection != null ? `proj ${money(p.projection)}` : ""}</small>
  </div>;

  const picker = <select value={managerId || ""} onChange={e => setManagerId(Number(e.target.value) || null)} aria-label="Manager">
    <option value="">Pick a manager…</option>
    {teams.map(t => <option key={t.id} value={t.id}>{t.name.trim()}</option>)}
  </select>;

  const renderAll = () => <><div className="standings-live-toggle gm-sort" role="group" aria-label="Sort games">
    {SORTS.map(([id, label]) => <button key={id} type="button" className={sort === id ? "active" : ""} aria-pressed={sort === id} onClick={() => setSort(id)}>{label}</button>)}
  </div><div className="gm-list">
    {allGames.map(g => {
      const inGame = starters.filter(p => p.game === g);
      const riders = svPicks.filter(x => gameOfAbbrev(x.team) === g);
      const plays = [...mainPlays, ...gPlays].filter(p => String(p.eventId) === String(g.id)).sort(newestFirst).slice(0, GAME_PLAYS);
      const isOpen = open.has(g.id);
      const toggle = () => setOpen(prev => { const next = new Set(prev); next.has(g.id) ? next.delete(g.id) : next.add(g.id); return next; });
      const bySide = (g.teams || []).filter(t => !t.home).concat((g.teams || []).filter(t => t.home)).map(t => ({ t, players: inGame.filter(p => Number(p.proTeamId) === Number(t.id)).sort((a, b) => (b.actual || 0) - (a.actual || 0)) }));
      return <div className={"gm-card" + (g.state === "in" ? " live" : "") + (g.completed ? " final" : "")} key={g.id}>
        {gameHead(g)}
        <button type="button" className="gm-expand" onClick={toggle} aria-expanded={isOpen}>
          {inGame.length ? `${inGame.length} league ${inGame.length === 1 ? "starter" : "starters"}` : "No league starters"}{riders.length ? ` · 🛡️ ${riders.length} survivor ${riders.length === 1 ? "pick" : "picks"}` : ""} {isOpen ? "▴" : "▾"}
        </button>
        {isOpen ? <div className="gm-box">
          {bySide.map(({ t, players }) => players.length ? <div key={t.id}><div className="gm-box-side">{t.abbrev}</div>{players.map(p => playerRow(p, true))}</div> : null)}
          {riders.length ? <p className="gm-riders">🛡️ {(g.teams || []).map(t => { const on = riders.filter(x => x.team === feedTeam(t.abbrev)); return on.length ? `${t.abbrev}: ${on.map(x => x.user).join(", ")}` : null; }).filter(Boolean).join(" · ")}</p> : null}
          {plays.length ? <div className="gm-plays">{plays.map(p => <PlayRow key={p.id} play={p} tag={p.fantasyTeamId != null ? scores.find(s => Number(s.teamId) === Number(p.fantasyTeamId))?.team : "🪓 " + ((guillotine.teams || []).find(t => Number(t.teamId) === Number(p.teamId))?.team || "")} />)}</div> : null}
        </div> : null}
      </div>;
    })}
  </div></>;

  const renderFollowed = () => {
    if (!followScore) return <p className="gm-empty">{view === "opp" ? "Pick a manager to see their opponent's players." : "Pick a manager to see their players."}</p>;
    const mine = starters.filter(isFollowed);
    const picks = svPicks.filter(x => handles.has(x.user));
    const plays = [...mainPlays.filter(p => Number(p.fantasyTeamId) === followId), ...gPlays.filter(p => gid != null && Number(p.teamId) === gid)]
      .sort(newestFirst).slice(0, FEED_PLAYS);
    const gamesShown = sortedGames.filter(g => mine.some(p => p.game === g) || picks.some(x => gameOfAbbrev(x.team) === g));
    const leftToPlay = mine.filter(p => p.game.state === "pre").length, playing = mine.filter(p => p.game.state === "in").length;
    return <>
      <div className="gm-follow">
        {logos[followId] ? <img src={logos[followId]} alt="" /> : null}
        <div><b>{followScore.team}</b>
          <small>{money(followScore.score)} vs {followScore.opponent} {money(followScore.opponentScore)}{followScore.winProbability != null ? ` · ${Math.round(followScore.winProbability)}% to win` : ""}</small>
          {gTeam ? <small>🪓 {gTeam.team} · {money(gTeam.score)}{gTeam.chopProbability != null ? ` · ${Math.round(gTeam.chopProbability)}% chop odds` : ""}</small> : null}
          <small>{playing} playing now · {leftToPlay} yet to play</small></div>
      </div>
      {plays.length ? <div className="gm-feed"><div className="key-plays-heading"><span>LATEST PLAYS</span><em>{view === "opp" ? "THEIR PLAYERS" : "THEIR PLAYERS, BOTH LEAGUES"}</em></div>
        {plays.map(p => <PlayRow key={p.id} play={p} tag={p.fantasyTeamId == null ? "🪓" : null} />)}</div> : null}
      <div className="gm-list">
        {gamesShown.map(g => {
          const here = mine.filter(p => p.game === g).sort((a, b) => (a.league === b.league ? 0 : a.league === "main" ? -1 : 1) || (b.actual || 0) - (a.actual || 0));
          const riding = picks.filter(x => gameOfAbbrev(x.team) === g);
          const ride = Object.entries(riding.reduce((a, x) => ({ ...a, [x.team]: (a[x.team] || 0) + 1 }), {}));
          return <div className={"gm-card" + (g.state === "in" ? " live" : "") + (g.completed ? " final" : "")} key={g.id}>
            {gameHead(g)}
            <div className="gm-box">{here.map(p => playerRow(p, false))}
              {ride.length ? <p className="gm-riders">🛡️ Survivor: {ride.map(([t, k]) => `${k} ${k === 1 ? "entry" : "entries"} on ${t}`).join(", ")}</p> : null}</div>
          </div>;
        })}
      </div>
      {!gamesShown.length ? <p className="gm-empty">No starters in this week's games.</p> : null}
    </>;
  };

  return <section id="games" className="section">
    <div className="section-heading"><div><span className="section-kicker">WEEK {week} · THE NFL SLATE</span><h2>Games</h2></div>
      {view !== "all" ? picker : null}</div>
    <div className="standings-live-toggle gm-toggle" role="tablist">
      {[["all", "All games"], ["mine", "My players"], ["opp", "Opponent"]].map(([id, label]) =>
        <button key={id} type="button" className={view === id ? "active" : ""} aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}
    </div>
    {view === "all" ? renderAll() : renderFollowed()}
    <p className="median-note">Win odds are ESPN's live win probability in game and the betting line before kickoff. Lines show the opening line and the latest, saved every 30 minutes until kickoff. Points are each league's own scoring{view === "all" ? "; open a game for every league starter in it" : ""}. Playoff odds are ESPN's FPI.{view === "all" ? " 🔥 Drama (0–100) blends how close the game is (late and close counts most), upsets, fantasy stakes (league starters in undecided matchups and chop races), survivor entries at risk, NFL playoff stakes, lightly rostered breakouts, games going off script (on pace to blow past the over/under), the league's own fan bases (Raiders, Chiefs, Niners, Rams, Lions) and, before kickoff, the over/under." : ""}</p>
  </section>;
}
