import { useEffect, useMemo, useState } from "react";
import { Explain, TeamLogo } from "./LiveBits.jsx";
import { pct } from "../lib/data.js";
import { mathStatus } from "../../scripts/lib/clinch.js";

// The 100-Yard Rush (Jim, 2026-11-24): playoff odds as a football field, riffing on the race that set the draft
// order. 100 yards = in. Each team runs in its own lane; the hollow marker is where its week started, and the bar
// is this week's surge (green) or setback (red); the faint band is the range it has covered (like a needle's drift band). Math clinches score a touchdown; eliminations are a safety.
// Two replays: the week so far (each live run that moved the odds) and the season so far (after each week). Until the
// week's first game kicks off, the week button replays last week instead (Jim, 2026-11-24).
const EZ = 9;                                     // each end zone's share of the lane, in %
const xOf = (p, status) => status === "clinched" ? 100 - EZ / 2 : status === "eliminated" ? EZ / 2 : EZ + (100 - 2 * EZ) * Math.min(100, Math.max(0, p)) / 100;
const WEEK_REPLAY_MS = 10000, SEASON_STEP_MS = 900;
const timeLabel = iso => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

// The dice (Jim, 2026-11-24: "advance one week at a time ... that way there's a build"): each press rolls one more
// remaining week from season-odds.js's model (dice), then re-simulates the rest from there. One possible future.
const DICE_SIMULATIONS = 2000, DICE_MS = 900;
const z = () => Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-12))) * Math.cos(2 * Math.PI * Math.random());
const rollScores = (m, i) => m.ids.map((id, j) => {
  const live = i === 0 ? m.live?.[j] : null;
  return live ? Math.max(live[2] - 10, live[0] + live[1] * z()) : m.mean[i][j] + m.sd[i] * z();
});
function addRolled(table, m, i, scores) {   // head-to-head + median wins, as in season-odds.js
  const sorted = [...scores].sort((a, b) => a - b), mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  const at = new Map(m.ids.map((id, j) => [id, j]));
  scores.forEach((sc, j) => { table[j][1] += sc; if (sc > median) table[j][0]++; });
  for (const [h, a] of m.games[i]) { const sh = scores[at.get(h)], sa = scores[at.get(a)]; if (sh > sa) table[at.get(h)][0]++; else if (sa > sh) table[at.get(a)][0]++; }
}
const ranked = (m, table) => m.ids.map((id, j) => [id, ...table[j]]).sort((a, b) => b[1] - a[1] || b[2] - a[2]).map(r => r[0]);
function diceFrame(m, rolled) {
  const table = m.base.map(r => [...r]);
  rolled.forEach((scores, i) => addRolled(table, m, i, scores));
  const left = m.weeks.length - rolled.length;
  const wins = Object.fromEntries(m.ids.map((id, j) => [id, table[j][0]]));
  const games = 2 * (m.played + rolled.length);
  if (!left) {
    const inSet = new Set(ranked(m, table).slice(0, m.spots));
    return { odds: Object.fromEntries(m.ids.map(id => [id, inSet.has(id) ? 100 : 0])), wins, games,
      math: Object.fromEntries(m.ids.map(id => [String(id), inSet.has(id) ? "clinched" : "eliminated"])) };
  }
  const made = new Map(m.ids.map(id => [id, 0]));
  for (let sim = 0; sim < DICE_SIMULATIONS; sim++) {
    const t = table.map(r => [...r]);
    for (let i = rolled.length; i < m.weeks.length; i++) addRolled(t, m, i, rollScores(m, i));
    ranked(m, t).slice(0, m.spots).forEach(id => made.set(id, made.get(id) + 1));
  }
  const status = mathStatus({ teams: m.ids.map(id => ({ teamId: id, wins: wins[id], open: 0 })), gamesLeft: 2 * left, spots: m.spots });
  return { odds: Object.fromEntries(m.ids.map(id => [id, 0.5 + 99 * (made.get(id) + 1) / (DICE_SIMULATIONS + 2)])), wins, games,
    math: Object.fromEntries([...status].filter(([, x]) => x.clinched || x.eliminated).map(([id, x]) => [String(id), x.clinched ? "clinched" : "eliminated"])) };
}

export default function RushField({ seasonOdds, logos, weekStarted }) {
  const [replay, setReplay] = useState(null);     // { kind, frames, step, ms }
  const [open, setOpen] = useState(null);         // tapped lane
  const [dice, setDice] = useState(null);         // { rolled: [scores by week], frames }
  const teams = seasonOdds?.teams || [];
  const week = Number(seasonOdds?.week);
  const math = seasonOdds?.math || {};
  const live = useMemo(() => Object.fromEntries(teams.map(t => [t.teamId, Number(t.playoffOdds)])), [teams]);
  const toMap = (ids, list) => Object.fromEntries(ids.map((id, i) => [id, list[i]]));

  const path = seasonOdds?.seasonPath, prior = seasonOdds?.lastWeekTrail;
  const lastWeek = !weekStarted && prior?.points?.length > 1;
  const trail = lastWeek ? prior : seasonOdds?.weekTrail, trailWeek = lastWeek ? Number(prior.week) : week;
  // Last week's clinches: the season path's frame after that week.
  const trailMath = lastWeek ? path?.frames?.find(f => f.week === trailWeek)?.math || {} : math;
  const weekFrames = trail?.points?.length > 1 ? [
    ...trail.points.map(([t, ...odds], i) => ({ label: t && i ? `Week ${trailWeek} · ${timeLabel(t)}` : `Start of Week ${trailWeek}`, odds: toMap(trail.ids, odds), math: trailMath })),
    lastWeek ? { label: `Week ${trailWeek} final`, odds: toMap(trail.ids, trail.points[trail.points.length - 1].slice(1)), math: trailMath } : { label: "Now", odds: live, math }
  ] : null;
  const seasonFrames = path?.frames?.length ? [
    ...path.frames.map(f => ({ label: f.week ? `After Week ${f.week}` : "Kickoff", odds: toMap(path.ids, f.odds), math: f.math || {} })),
    { label: `Now · Week ${week}`, odds: live, math }
  ] : null;

  const model = seasonOdds?.dice;
  const canRoll = model?.weeks?.length > 0 && model.mean?.length === model.weeks.length;
  const roll = () => {
    setReplay(null);
    if (dice && dice.rolled.length >= model.weeks.length) return setDice(null);   // start over
    const base = dice || { rolled: [], frames: [{ label: "Today", odds: live, math }] };
    const rolled = [...base.rolled, rollScores(model, base.rolled.length)];
    const f = diceFrame(model, rolled);
    const last = rolled.length === model.weeks.length;
    setDice({ rolled, frames: [...base.frames, { ...f, label: last ? "Final: one possible future" : `Week ${model.weeks[rolled.length - 1]} rolled` }] });
  };
  const nextLabel = !dice ? `🎲 Roll Week ${model?.weeks?.[0]}` : dice.rolled.length >= (model?.weeks?.length || 0) ? "🎲 Start over" : `🎲 Roll Week ${model.weeks[dice.rolled.length]}`;
  const play = kind => {
    const frames = kind === "week" ? weekFrames : seasonFrames;
    setOpen(null);
    setDice(null);
    // A new run each press (Jim, 2026-11-24: replays only played once), held on the last frame until closed.
    setReplay(r => ({ kind, frames, step: 0, run: (r?.run || 0) + 1, ms: kind === "week" ? Math.min(700, Math.max(80, WEEK_REPLAY_MS / frames.length)) : SEASON_STEP_MS }));
  };
  const replayDone = replay && replay.step >= replay.frames.length - 1;
  useEffect(() => {
    if (!replay || replayDone) return;
    const timer = setTimeout(() => setReplay(r => r && r.run === replay.run ? { ...r, step: r.step + 1 } : r), replay.ms);
    return () => clearTimeout(timer);
  }, [replay?.run, replay?.step, replayDone]);

  if (!teams.length) return null;
  // Between weeks (Jim, 2026-11-24), the field measures from the start of last week; otherwise from the start of this one.
  const startOdds = lastWeek ? toMap(prior.ids, prior.points[0].slice(1))
    : Object.fromEntries(teams.map(t => [t.teamId, Number(seasonOdds?.weekStart?.[String(t.teamId)]?.playoffOdds ?? live[t.teamId])]));
  const frame = dice ? dice.frames[dice.frames.length - 1] : replay ? replay.frames[replay.step] : { odds: live, math };
  const from = dice ? dice.frames[0] : replay ? replay.frames[0] : { odds: startOdds, math: lastWeek ? path?.frames?.find(f => f.week === trailWeek - 1)?.math || {} : math };
  // The range each team has covered (Jim, 2026-11-24): the week so far (or last week), or the replay up to the frame on screen.
  const covered = dice ? dice.frames : replay ? replay.frames.slice(0, replay.step + 1)
    : [...(trail?.points || []).map(([, ...odds]) => ({ odds: toMap(trail.ids, odds), math })), { odds: live, math }];
  const range = id => {
    const xs = covered.map(f => f.odds[id]).filter(Number.isFinite);
    const ps = covered.filter(f => Number.isFinite(f.odds[id])).map(f => xOf(f.odds[id], f.math[String(id)]));
    return { lo: Math.min(...xs), hi: Math.max(...xs), x0: Math.min(...ps), x1: Math.max(...ps) };
  };
  // Lanes stay in today's order (best odds on top), so a replay shows each team finding its spot.
  const lanes = [...teams].sort((a, b) => live[b.teamId] - live[a.teamId]);
  const move = id => Math.round(frame.odds[id] - from.odds[id]);
  const moves = lanes.map(t => [t, move(t.teamId)]).filter(([, d]) => d);
  const surge = moves.reduce((best, m) => !best || m[1] > best[1] ? m : best, null);
  const setback = moves.reduce((worst, m) => !worst || m[1] < worst[1] ? m : worst, null);
  const span = replay?.kind === "season" ? "this season" : lastWeek ? "last week" : "this week";
  // The dice's final: the biggest long shot in and the biggest favorite out.
  const done = dice && dice.rolled.length >= model.weeks.length;
  const longShot = done ? lanes.filter(t => frame.odds[t.teamId] === 100 && from.odds[t.teamId] < 50).sort((a, b) => from.odds[a.teamId] - from.odds[b.teamId])[0] : null;
  const upset = done ? lanes.filter(t => frame.odds[t.teamId] === 0 && from.odds[t.teamId] > 50).sort((a, b) => from.odds[b.teamId] - from.odds[a.teamId])[0] : null;

  return (
    <div className={"rush" + (replay || dice ? " replaying" : "")} style={{ "--rush-ms": `${replay ? replay.ms : dice ? DICE_MS : 1200}ms` }}>
      <div className="rush-head">
        <div className="rush-buttons">
          {replay ? <>
            <button type="button" className="active" onClick={() => play(replay.kind)}>↺ {replayDone ? "Watch again" : "Restart"}</button>
            <button type="button" onClick={() => setReplay(null)}>{replayDone ? "✕ Close" : "■ Stop"}</button>
          </> : <>
            <button type="button" disabled={!weekFrames} onClick={() => play("week")}>▶ Replay {lastWeek ? "last week" : "the week"}</button>
            <button type="button" disabled={!seasonFrames} onClick={() => play("season")}>▶ Replay the season</button>
            <span className="rush-dice">
              <button type="button" className={dice ? "active" : ""} disabled={!canRoll} onClick={roll}>{nextLabel}</button>
              {dice && !done ? <button type="button" onClick={() => setDice(null)}>Today</button> : null}
            </span>
          </>}
        </div>
        <span className="rush-caption">{replay || dice ? <strong>{frame.label}</strong> : null}
          {done && longShot ? <span className="up">Long shot in: {longShot.team} ({pct(from.odds[longShot.teamId])})</span> : null}
          {done && upset ? <span className="down">Out: {upset.team} ({pct(from.odds[upset.teamId])})</span> : null}
          {done ? null : <>
          {!replay && !dice && lastWeek && surge ? <span>Last week:</span> : null}
          {surge && surge[1] > 0 ? <span className="up">▲ {surge[0].team} +{surge[1]} yds</span> : null}
          {setback && setback[1] < 0 ? <span className="down">▼ {setback[0].team} {setback[1]} yds</span> : null}
          {!surge && !replay && !dice ? <span>No moves yet {span}</span> : null}</>}</span>
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
          const a = xOf(was, from.math[String(id)]), b = xOf(now, status), d = move(id), rg = range(id);
          const byWins = !replay ? seasonOdds?.byWins?.[String(id)] : null;
          return <div key={id} className={"rush-lane" + (open === id ? " open" : "")}>
            <button type="button" className="rush-row" onClick={() => setOpen(open === id ? null : id)}>
              <span className="rush-name"><b>{t.team}</b>
                <small>{dice && frame.wins ? `${frame.wins[id]}-${frame.games - frame.wins[id]} · ` : ""}{status === "clinched" ? (dice ? "IN" : "CLINCHED") : status === "eliminated" ? "OUT" : pct(now)}
                  {d ? <em className={d > 0 ? "up" : "down"}>{d > 0 ? ` ▲${d}` : ` ▼${-d}`}</em> : null}</small></span>
              <span className="rush-track">
                <i className="rush-range" style={{ left: `${rg.x0}%`, width: `${rg.x1 - rg.x0}%` }} />
                <i className={"rush-trail " + (b >= a ? "up" : "down")} style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
                <i className="rush-ghost" style={{ left: `${a}%` }} />
                <span className={"rush-runner" + (status ? " " + status : "")} style={{ left: `${b}%` }}>
                  <TeamLogo src={logos[id]} />{status === "clinched" ? <em>TD</em> : null}
                </span>
              </span>
            </button>
            {open === id ? <p className="rush-detail">{pct(now)} {replay || dice ? "here" : "now"}, {pct(was)} {dice ? "today" : `at the start of ${replay?.kind === "season" ? "the season" : lastWeek ? "last week" : "the week"}`}.
              {rg.hi - rg.lo >= 1 ? ` Range ${span}: ${pct(rg.lo)}–${pct(rg.hi)}.` : ""}
              {byWins ? " This week: " + byWins.map((x, k) => x ? `${["lose both", "split", "win both"][k]} ${pct(x.playoffOdds)}` : null).filter(Boolean).join(", ") + "." : ""}</p> : null}
          </div>;
        })}
      </div>
      <Explain lead={`Playoff odds as yards: 100 = in. Hollow marker: where ${lastWeek ? "last week" : "the week"} started; faint band: the range since.`}>Each lane is a team's chance of making the playoffs, from {Number(seasonOdds?.simulations || 0).toLocaleString()} season simulations, updated during games. A touchdown means clinched for sure; a safety means eliminated. Replay the week to watch every swing since it began (before kickoff, last week's), or the season to see where each team stood after every week (the same model, knowing only the results up to then). 🎲 rolls one random week per press, then shows the odds from there: one possible future, not a forecast; roll again for another. Tap a lane for what this week's results would do.</Explain>
    </div>
  );
}
