import { useEffect, useMemo, useState } from "react";
import { Explain, TeamLogo } from "./LiveBits.jsx";
import { pct } from "../lib/data.js";

// The 100-Yard Rush (Jim, 2026-11-24): playoff odds as a football field, riffing on the race that set the draft
// order. 100 yards = in. Each team runs in its own lane; the hollow marker is where its week started, and the bar
// is this week's surge (green) or setback (red). Math clinches score a touchdown; eliminations are a safety.
// Two replays: the week so far (each live run that moved the odds) and the season so far (after each week).
const EZ = 9;                                     // each end zone's share of the lane, in %
const xOf = (p, status) => status === "clinched" ? 100 - EZ / 2 : status === "eliminated" ? EZ / 2 : EZ + (100 - 2 * EZ) * Math.min(100, Math.max(0, p)) / 100;
const WEEK_REPLAY_MS = 10000, SEASON_STEP_MS = 900;
const timeLabel = iso => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function RushField({ seasonOdds, logos }) {
  const [replay, setReplay] = useState(null);     // { kind, frames, step, ms }
  const [open, setOpen] = useState(null);         // tapped lane
  const teams = seasonOdds?.teams || [];
  const week = Number(seasonOdds?.week);
  const math = seasonOdds?.math || {};
  const live = useMemo(() => Object.fromEntries(teams.map(t => [t.teamId, Number(t.playoffOdds)])), [teams]);
  const start = id => Number(seasonOdds?.weekStart?.[String(id)]?.playoffOdds ?? live[id]);
  const toMap = (ids, list) => Object.fromEntries(ids.map((id, i) => [id, list[i]]));

  const trail = seasonOdds?.weekTrail, path = seasonOdds?.seasonPath;
  const weekFrames = trail?.points?.length > 1 ? [
    ...trail.points.map(([t, ...odds], i) => ({ label: t && i ? timeLabel(t) : `Start of Week ${week}`, odds: toMap(trail.ids, odds), math })),
    { label: "Now", odds: live, math }
  ] : null;
  const seasonFrames = path?.frames?.length ? [
    ...path.frames.map(f => ({ label: f.week ? `After Week ${f.week}` : "Kickoff", odds: toMap(path.ids, f.odds), math: f.math || {} })),
    { label: `Now · Week ${week}`, odds: live, math }
  ] : null;

  const play = kind => {
    const frames = kind === "week" ? weekFrames : seasonFrames;
    setOpen(null);
    setReplay({ kind, frames, step: 0, ms: kind === "week" ? Math.min(700, Math.max(80, WEEK_REPLAY_MS / frames.length)) : SEASON_STEP_MS });
  };
  useEffect(() => {
    if (!replay) return;
    const done = replay.step >= replay.frames.length - 1;
    const timer = setTimeout(() => setReplay(done ? null : { ...replay, step: replay.step + 1 }), done ? 2500 : replay.ms);
    return () => clearTimeout(timer);
  }, [replay]);

  if (!teams.length) return null;
  const frame = replay ? replay.frames[replay.step] : { odds: live, math };
  const from = replay ? replay.frames[0] : { odds: Object.fromEntries(teams.map(t => [t.teamId, start(t.teamId)])), math };
  // Lanes stay in today's order (best odds on top), so a replay shows each team finding its spot.
  const lanes = [...teams].sort((a, b) => live[b.teamId] - live[a.teamId]);
  const move = id => Math.round(frame.odds[id] - from.odds[id]);
  const moves = lanes.map(t => [t, move(t.teamId)]).filter(([, d]) => d);
  const surge = moves.reduce((best, m) => !best || m[1] > best[1] ? m : best, null);
  const setback = moves.reduce((worst, m) => !worst || m[1] < worst[1] ? m : worst, null);
  const span = replay ? (replay.kind === "week" ? "this week" : "this season") : "this week";

  return (
    <div className={"rush" + (replay ? " replaying" : "")} style={{ "--rush-ms": `${replay ? replay.ms : 1200}ms` }}>
      <div className="rush-head">
        <div className="rush-buttons">
          {replay ? <button type="button" className="active" onClick={() => setReplay(null)}>■ Stop</button> : <>
            <button type="button" disabled={!weekFrames} onClick={() => play("week")}>▶ Replay the week</button>
            <button type="button" disabled={!seasonFrames} onClick={() => play("season")}>▶ Replay the season</button>
          </>}
        </div>
        <span className="rush-caption">{replay ? <strong>{frame.label}</strong> : null}
          {surge && surge[1] > 0 ? <span className="up">▲ {surge[0].team} +{surge[1]} yds</span> : null}
          {setback && setback[1] < 0 ? <span className="down">▼ {setback[0].team} {setback[1]} yds</span> : null}
          {!surge && !replay ? <span>No moves yet {span}</span> : null}</span>
      </div>
      <div className="rush-board">
        <div className="rush-row rush-numbers" aria-hidden="true">
          <span className="rush-name" />
          <div className="rush-track">
            <b style={{ left: `${EZ / 2}%` }} className="ez out">OUT</b>
            {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(n => <b key={n} style={{ left: `${xOf(n)}%` }} className={n === 50 ? "mid" : ""}>{n}</b>)}
            <b style={{ left: `${100 - EZ / 2}%` }} className="ez in">IN</b>
          </div>
        </div>
        {lanes.map(t => {
          const id = t.teamId, status = frame.math[String(id)], now = frame.odds[id], was = from.odds[id];
          const a = xOf(was, from.math[String(id)]), b = xOf(now, status), d = move(id);
          const byWins = !replay ? seasonOdds?.byWins?.[String(id)] : null;
          return <div key={id} className={"rush-lane" + (open === id ? " open" : "")}>
            <button type="button" className="rush-row" onClick={() => setOpen(open === id ? null : id)}>
              <span className="rush-name"><b>{t.team}</b>
                <small>{status === "clinched" ? "CLINCHED" : status === "eliminated" ? "OUT" : pct(now)}
                  {d ? <em className={d > 0 ? "up" : "down"}>{d > 0 ? ` ▲${d}` : ` ▼${-d}`}</em> : null}</small></span>
              <span className="rush-track">
                <i className={"rush-trail " + (b >= a ? "up" : "down")} style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
                <i className="rush-ghost" style={{ left: `${a}%` }} />
                <span className={"rush-runner" + (status ? " " + status : "")} style={{ left: `${b}%` }}>
                  <TeamLogo src={logos[id]} />{status === "clinched" ? <em>TD</em> : null}
                </span>
              </span>
            </button>
            {open === id ? <p className="rush-detail">{pct(now)} now, {pct(was)} at the start of the {replay?.kind === "season" ? "season" : "week"}.
              {byWins ? " This week: " + byWins.map((x, k) => x ? `${["lose both", "split", "win both"][k]} ${pct(x.playoffOdds)}` : null).filter(Boolean).join(", ") + "." : ""}</p> : null}
          </div>;
        })}
      </div>
      <Explain lead="Playoff odds as yards: 100 = in. Hollow marker: where the week started.">Each lane is a team's chance of making the playoffs, from {Number(seasonOdds?.simulations || 0).toLocaleString()} season simulations, updated during games. A touchdown means clinched for sure; a safety means eliminated. Replay the week to watch every swing since it began, or the season to see where each team stood after every week (the same model, knowing only the results up to then). Tap a lane for what this week's results would do.</Explain>
    </div>
  );
}
