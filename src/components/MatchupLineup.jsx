import React from "react";

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
      <b>{started ? money(player.actual) : "-"}</b>
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

export default function MatchupLineup({ a, b, nflGames = [] }) {
  if (!a.lineup || !b.lineup) return null;
  const rows = [];
  for (const slot of SLOT_ORDER) {
    const left = a.lineup.starters.filter(p => p.slot === slot);
    const right = b.lineup.starters.filter(p => p.slot === slot);
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
export function TeamLineup({ lineup = [], nflGames = [] }) {
  const rows = SLOT_ORDER.flatMap(slot => lineup.filter(p => p.slot === slot));
  const other = lineup.filter(p => !SLOT_ORDER.includes(p.slot));
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
          <b>{started ? money(p.actual) : "-"}</b>
          <small>{p.projection != null ? money(p.projection) : ""}</small>
        </div>
      </div>;
    })}
  </div>;
}
