import React, { useEffect, useState } from "react";

// "Live" lineups: only players whose NFL game is in progress. One shared
// setting (remembered on this device) so every lineup view follows it.
const LIVE_KEY = "lineupLiveOnly";
export function useLiveOnly() {
  const read = () => { try { return localStorage.getItem(LIVE_KEY) === "1"; } catch { return false; } };
  const [liveOnly, setLiveOnly] = useState(read);
  useEffect(() => {
    const sync = () => setLiveOnly(read());
    window.addEventListener("lineup-live-only", sync);
    return () => window.removeEventListener("lineup-live-only", sync);
  }, []);
  const set = on => { try { localStorage.setItem(LIVE_KEY, on ? "1" : "0"); } catch {} window.dispatchEvent(new Event("lineup-live-only")); };
  return [liveOnly, set];
}
export function LiveToggle({ liveOnly, onChange }) {
  return <div className="lineup-filter" role="group" aria-label="Which players to show">
    <button type="button" className={liveOnly ? "" : "active"} onClick={() => onChange(false)}>All</button>
    <button type="button" className={liveOnly ? "active" : ""} onClick={() => onChange(true)}>Live now</button>
  </div>;
}
// Pace: how a player who has kicked off is doing against his projection so
// far: projection x the share of his game played (quarter and clock; a final
// game counts in full). Returns "up", "down" or null, with a tooltip.
const PACE_RATIO = 0.25, PACE_POINTS = 3;
export function paceOf(player, nflGames) {
  const game = player && nflGames.find(g => (g.teamIds || []).includes(player.proTeamId));
  const proj = Number(player?.projection), actual = Number(player?.actual) || 0;
  if (!game || game.state === "pre" || !(proj > 0)) return null;
  let share = 1;
  if (!game.completed) {
    const period = Math.min(Number(game.period) || 1, 4), left = Math.max(0, Number(game.clock) || 0);
    share = Math.min(1, Math.max(0.05, ((period - 1) * 900 + (900 - Math.min(left, 900))) / 3600));
  }
  const expected = proj * share, gap = actual - expected;
  if (Math.abs(gap) < PACE_POINTS || Math.abs(gap) < PACE_RATIO * expected) return null;
  const tip = `${actual.toFixed(1)} pts vs ${expected.toFixed(1)} expected ${game.completed ? "(projection " + proj.toFixed(1) + ")" : "by now (" + Math.round(share * 100) + "% of his game played, projection " + proj.toFixed(1) + ")"}`;
  return { dir: gap > 0 ? "up" : "down", tip };
}
const PaceMark = ({ pace }) => pace ? <span className={"pace " + pace.dir} title={pace.tip} aria-label={pace.dir === "up" ? "outpacing his projection" : "behind his projection"}>{pace.dir === "up" ? "↑" : "↓"}</span> : null;

const isLive = (player, nflGames) => {
  const game = player && nflGames.find(g => (g.teamIds || []).includes(player.proTeamId));
  return Boolean(game && game.state === "in");
};

// ESPN-style lineup table inside an expanded matchup card: both teams'
// starters side by side, slot by slot. Bench players appear only when they
// outscored a starter they could have replaced (both games over), followed
// by what the best possible lineup would have scored.
const SLOT_ORDER = [0, 2, 4, 6, 23, 16, 17];
const SLOT_LABELS = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 23: "FLX", 16: "D/ST", 17: "K", 20: "BE" };
const money = n => Number(n).toFixed(2);

// "@CLE 24-27 Final", "NE Sun 10:00 AM", "@CLE 14-10 Q3 5:21", or "BYE".
function gameLine(proTeamId, nflGames) {
  const game = nflGames.find(g => (g.teamIds || []).includes(proTeamId));
  if (!game) return "BYE";
  const mine = (game.teams || []).find(t => t.id === proTeamId);
  const opp = (game.teams || []).find(t => t.id !== proTeamId);
  if (!mine || !opp) return game.name;
  const vs = (mine.home ? "" : "@") + opp.abbrev;
  if (game.state === "pre") {
    const d = new Date(game.kickoff);
    return vs + " " + d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return vs + " " + mine.score + "-" + opp.score + " " + (game.completed ? "Final" : game.detail);
}

function PlayerCell({ player, side, nflGames, highlight }) {
  // An unfilled starting slot reads "Empty"; a bench side with no one to show stays blank.
  let info, points;
  if (!player) {
    info = <div className={"lineup-player " + side + " empty"}>{highlight ? "" : "Empty"}</div>;
    points = <div className={"lineup-points " + side}></div>;
  } else {
    const game = nflGames.find(g => (g.teamIds || []).includes(player.proTeamId));
    const started = !game || game.state !== "pre";
    info = <div className={"lineup-player " + side}>
      <b>{player.name}{player.injury ? <em className="lineup-injury">{player.injury}</em> : null}</b>
      <small>{gameLine(player.proTeamId, nflGames)}</small>
    </div>;
    points = <div className={"lineup-points " + side + (highlight ? " regret" : "")}>
      <b>{started ? money(player.actual) : "-"}{started ? <PaceMark pace={paceOf(player, nflGames)} /> : null}</b>
      <small>{player.projection != null ? money(player.projection) : ""}</small>
    </div>;
  }
  // Mirrored like ESPN: points sit next to the slot column on both sides.
  return side === "left" ? <>{info}{points}</> : <>{points}{info}</>;
}

function Row({ label, left, right, nflGames, highlight }) {
  return <div className="lineup-row">
    <PlayerCell player={left} side="left" nflGames={nflGames} highlight={highlight} />
    <div className="lineup-slot">{label}</div>
    <PlayerCell player={right} side="right" nflGames={nflGames} highlight={highlight} />
  </div>;
}

export default function MatchupLineup({ a, b, nflGames = [], liveOnly = false }) {
  if (!a.lineup || !b.lineup) return null;
  const rows = [];
  for (const slot of SLOT_ORDER) {
    const live = p => !liveOnly || isLive(p, nflGames);
    const left = a.lineup.starters.filter(p => p.slot === slot && live(p));
    const right = b.lineup.starters.filter(p => p.slot === slot && live(p));
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      rows.push(<Row key={slot + "-" + i} label={SLOT_LABELS[slot]} left={left[i]} right={right[i]} nflGames={nflGames} />);
    }
  }
  const benchLeft = a.lineup.regretBench || [], benchRight = b.lineup.regretBench || [];
  const decided = a.status === "FINAL" || (a.startersLeft === 0 && b.startersLeft === 0);
  const optimal = (team, opp) => {
    if (!(team.lineup.pointsLeft > 0)) return <div className="lineup-optimal empty"></div>;
    const best = Number(team.score) + team.lineup.pointsLeft;
    const flipped = decided && Number(team.score) < Number(opp.score) && best > Number(opp.score);
    return <div className="lineup-optimal">
      <small>Optimal lineup</small>
      <b>{money(best)} <span>(+{money(team.lineup.pointsLeft)})</span></b>
      {flipped ? <em>😱 would have beaten {opp.team}</em> : null}
    </div>;
  };
  if (liveOnly) return <div className="matchup-lineup" aria-label="Live players">
    {rows.length ? rows : <p className="lineup-none">Nobody in this matchup is playing right now.</p>}
  </div>;
  return <div className="matchup-lineup" aria-label="Lineups">
    {rows}
    {benchLeft.length || benchRight.length ? <>
      <div className="lineup-bench-heading">BENCH · OUTSCORED A STARTER</div>
      {Array.from({ length: Math.max(benchLeft.length, benchRight.length) }, (_, i) =>
        <Row key={"bench-" + i} label="BE" left={benchLeft[i]} right={benchRight[i]} nflGames={nflGames} highlight />)}
      <div className="lineup-optimal-row">{optimal(a, b)}<div></div>{optimal(b, a)}</div>
    </> : null}
  </div>;
}

// One team's starters (the Death Watch cards): slot, player and game, points.
export function TeamLineup({ lineup = [], nflGames = [], liveOnly = false }) {
  const shown = liveOnly ? lineup.filter(p => isLive(p, nflGames)) : lineup;
  const rows = SLOT_ORDER.flatMap(slot => shown.filter(p => p.slot === slot));
  const other = shown.filter(p => !SLOT_ORDER.includes(p.slot));
  if (liveOnly && !shown.length) return <p className="lineup-none">Nobody playing right now.</p>;
  return <div className="team-lineup" aria-label="Lineup">
    {[...rows, ...other].map(p => {
      const game = nflGames.find(g => (g.teamIds || []).includes(p.proTeamId));
      const started = !game || game.state !== "pre";
      return <div className="team-lineup-row" key={p.id}>
        <div className="lineup-slot">{SLOT_LABELS[p.slot] || p.pos}</div>
        <div className="lineup-player left">
          <b>{p.name}{p.injury ? <em className="lineup-injury">{p.injury}</em> : null}</b>
          <small>{gameLine(p.proTeamId, nflGames)}</small>
        </div>
        <div className="lineup-points left">
          <b>{started ? money(p.actual) : "-"}{started ? <PaceMark pace={paceOf(p, nflGames)} /> : null}</b>
          <small>{p.projection != null ? money(p.projection) : ""}</small>
        </div>
      </div>;
    })}
  </div>;
}

// Two teams' lineups side by side (Death Watch, ticket race, median race),
// with the All / Live now filter and a note on why they're paired.
export function VsLineups({ a, b, note, nflGames = [] }) {
  const [liveOnly, setLiveOnly] = useLiveOnly();
  return <div className="dw-vs"><LiveToggle liveOnly={liveOnly} onChange={setLiveOnly} />
    {note ? <p className="dw-vs-note">{note}</p> : null}
    <div className="dw-vs-cols">
      <div><strong className="dw-vs-head" title={a.team}>{a.team}</strong><TeamLineup lineup={a.lineup?.starters || []} nflGames={nflGames} liveOnly={liveOnly} /></div>
      <div><strong className="dw-vs-head" title={b.team}>{b.team}</strong><TeamLineup lineup={b.lineup?.starters || []} nflGames={nflGames} liveOnly={liveOnly} /></div>
    </div>
  </div>;
}
