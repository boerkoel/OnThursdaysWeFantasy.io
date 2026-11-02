import React, { useEffect, useRef, useState } from "react";
import { money, pct } from "../lib/data.js";
import { HALF_MEAN_SD, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";
import { TeamLogo } from "./LiveBits.jsx";
import { VsLineups } from "./MatchupLineup.jsx";
import ChopChart, { peakTeams } from "./ChopChart.jsx";
import Podium from "./Podium.jsx";
import { Needle } from "./Needle.jsx";
import { oddsMove } from "../lib/playText.js";

// Ticket race, laid out like Death Watch: the three teams with the best odds
// of the week's top score (a raffle ticket) on a podium, a details card for
// each, then their ticket odds over the week with the plays that moved them.
const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_COLORS = ["#e6c85c", "#c9ccd1", "#c98b5a"];
const LABELS = ["🥇 TICKET FAVORITE", "🥈 #2 IN THE RACE", "🥉 #3 IN THE RACE"];
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, "D/ST": 16 };
const short = n => /D\/ST/.test(n) ? n : n.split(" ").slice(1).join(" ") || n;
const ticketSwing = play => play.momentum ? `ticket ${oddsMove(play.momentum.topScoreProbability, play.momentum.shift)}` : null;

// Starters still to play, with what they're projected to add and their spread.
function playersLeft(team, nflGames) {
  return (team.lineup?.starters || []).map(p => {
    const game = nflGames.find(g => (g.teamIds || []).includes(p.proTeamId));
    if (!game || game.completed) return null;
    return { ...p, game, ...playerOutlook({ actual: p.actual, projection: p.projection, positionId: POSITION_IDS[p.pos] }) };
  }).filter(Boolean);
}

// The ticket needle's pair sticks (Jim, 2026-11-02): a challenger replaces the weaker of the two only once its
// ticket odds beat that team's by 5+ points, so near-ties don't flicker, and a swap is called out for a minute.
const SWAP_MARGIN = 5, SWAP_SHOWN_MS = 60000;
function useStickyPair(ranked) {
  const kept = useRef(null);
  const [swap, setSwap] = useState(null);
  const odds = s => Number(s.topScoreProbability);
  let pair = (kept.current || []).map(id => ranked.find(s => s.teamId === id)).filter(Boolean);
  let swapped = null;
  if (pair.length < 2) pair = ranked.slice(0, 2);
  else for (const c of ranked.slice(0, 3)) {
    if (pair.includes(c)) continue;
    const weaker = odds(pair[0]) <= odds(pair[1]) ? pair[0] : pair[1];
    if (odds(c) >= odds(weaker) + SWAP_MARGIN) { swapped = { in: c.team, out: weaker.team }; pair = pair.map(s => s === weaker ? c : s); }
  }
  pair = [...pair].sort((x, y) => odds(y) - odds(x));
  const ids = pair.map(s => s.teamId).join(",");
  useEffect(() => {
    const had = kept.current;
    kept.current = pair.map(s => s.teamId);
    if (!had || !swapped) return;
    setSwap({ ...swapped, at: Date.now() });
    const id = setTimeout(() => setSwap(null), SWAP_SHOWN_MS);
    return () => clearTimeout(id);
  }, [ids]);
  return { pair, swap };
}

export default function RafflePodium({ scores, logos, week, final, history, plays = [], nflGames = [] }) {
  const [openLineups, setOpenLineups] = useState(() => new Set());
  // The podium always shows; the cards and chart start collapsed (the Live
  // tab is long on game days).
  const [showDetails, setShowDetails] = useState(false);
  const top = [...scores]
    .filter(s => s.topScoreProbability != null)
    .sort((a, b) => Number(b.topScoreProbability) - Number(a.topScoreProbability) || Number(b.score) - Number(a.score))
    .slice(0, 3);
  const { pair: duel, swap } = useStickyPair(top);
  if (top.length < 3) return null;
  const toggle = id => setOpenLineups(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const leader = [...scores].sort((a, b) => Number(b.score) - Number(a.score))[0];
  const runnerUp = [...scores].sort((a, b) => Number(b.score) - Number(a.score))[1];
  const sds = scores.map(s => Number(s.projectionSd) || 0).sort((a, b) => a - b);
  const typicalSd = sds[Math.floor(sds.length / 2)] || 0;
  const chartTeams = peakTeams(history, scores.map(s => ({ ...s, value: s.topScoreProbability })));
  const ids = new Set(chartTeams.map(s => s.teamId));
  const racePlays = plays.filter(p => p.raffle && ids.has(Number(p.fantasyTeamId))).map(p => ({ ...p, teamId: Number(p.fantasyTeamId), momentum: p.raffle }));

  const details = top.map((s, i) => {
    const left = playersLeft(s, nflGames);
    const odds = Number(s.topScoreProbability);
    const gap = s === leader ? `Top score so far, ${money(Number(s.score) - Number(runnerUp.score))} ahead of ${runnerUp.team}.` : `${money(Number(leader.score) - Number(s.score))} behind ${leader.team}'s ${money(leader.score)}.`;
    // The player whose big or quiet game moves the ticket odds most.
    let swing = null;
    const outcomeSd = Math.hypot(Number(s.projectionSd) || 0, typicalSd);
    if (!final && odds > 0 && odds < 100 && outcomeSd > 0) {
      const z = normalQuantile(Math.min(0.9999, Math.max(0.0001, odds / 100)));
      const p = [...left].sort((a, b) => b.sd - a.sd)[0];
      if (p) {
        const shift = HALF_MEAN_SD * p.sd / outcomeSd;
        swing = `${short(p.name)} decides it (${p.game.name}): a big game lifts the ticket odds to ${Math.round(100 * normalCdf(z + shift))}%; a quiet one drops them to ${Math.round(100 * normalCdf(z - shift))}%.`;
      }
    }
    const top2 = [...left].sort((a, b) => b.rest - a.rest);
    const leftLine = left.length ? `${left.length} left, ${money(left.reduce((sum, p) => sum + p.rest, 0))} projected pts (${top2.slice(0, 2).map(p => short(p.name)).join(", ")}${top2.length > 2 ? ` +${top2.length - 2}` : ""})` : "No players left to play";
    return { s, i, gap, swing, leftLine };
  });

  return (
    <section id="ticket-race" className="section">
      <div className="section-heading"><div><span className="section-kicker">WEEK {week} · TOP SCORE WINS A RAFFLE TICKET</span><h2>Ticket race</h2></div></div>
      <Podium ariaLabel="Best odds of the week's top score" items={top.map((s, i) => ({
        key: s.teamId,
        logo: <TeamLogo src={logos[s.teamId]} size="md" />,
        name: s.team,
        value: s.topScoreProbability,
        label: final && i === 0 ? "🎟️ Ticket won" : pct(s.topScoreProbability),
        sub: `${money(s.score)} pts${final ? "" : ` · proj ${s.projectionAverage != null ? money(s.projectionAverage) : "—"}`}`,
        icon: MEDALS[i]
      }))} />
      {(() => {   // the top two's race on the needle (Jim, 2026-11-02): their shares of the ticket odds, head to head
        const [x, y] = duel, px = Number(x.topScoreProbability), py = Number(y.topScoreProbability);
        if (final || !(py >= 10) || !(px < 99.5) || !playersLeft(x, nflGames).length && !playersLeft(y, nflGames).length) return null;
        const share = (b, a) => 100 * b / (a + b);
        const from = s => Number.isFinite(Number(s.liveTopFrom)) ? Number(s.liveTopFrom) : Number(s.topScoreProbability);
        return <>{swap ? <p className="needle-swap">↔ {swap.in} in for {swap.out}</p> : null}<Needle a={x} b={y} label="🎟️ TICKET RACE · TOP TWO" history={history} games={nflGames} odds={{ b: share(py, px), bFrom: share(from(y), from(x)) }} /></>;
      })()}
      <button type="button" className="section-toggle" aria-expanded={showDetails} onClick={() => setShowDetails(v => !v)}>{showDetails ? "Hide race details ▴" : "Race details ▾"}</button>
      {showDetails ? <>
      <div className="award-grid dw-details">
        {details.map(({ s, i, gap, swing, leftLine }) => <article className="award-card" key={s.teamId}>
          <small>{LABELS[i]}</small>
          <strong className="dw-team"><TeamLogo src={logos[s.teamId]} size="md" />{s.team}</strong>
          <b className="ticket-odds">{final && i === 0 ? "🎟️ Won this week's ticket" : `${pct(s.topScoreProbability)} chance of the ticket`}</b>
          <p>{money(s.score)} pts{final ? " · final" : ` · projected ${s.projectionAverage != null ? money(s.projectionAverage) : "—"}`}</p>
          <p className="dw-insight">🏁 {gap}</p>
          {swing ? <p className="dw-insight">🎲 {swing}</p> : null}
          <p className="dw-left">{leftLine}</p>
          {s.lineup?.starters?.length ? <button type="button" className="dw-lineup-toggle" aria-expanded={openLineups.has(s.teamId)} onClick={() => toggle(s.teamId)}>{openLineups.has(s.teamId) ? "Hide lineup ▴" : "Lineup ▾"}</button> : null}
          {openLineups.has(s.teamId) ? <VsLineups a={top[0]} b={top[1]} nflGames={nflGames}
            note={<>The race for the ticket, head to head: <b>{top[0].team}</b> (favorite) vs <b>{top[1].team}</b>.</>} /> : null}
        </article>)}
      </div>
      <ChopChart history={history} teams={chartTeams} plays={racePlays} title="TICKET ODDS · THIS WEEK'S CONTENDERS" swingText={ticketSwing} colors={MEDAL_COLORS} ariaLabel="Ticket odds over the week for the top three teams" />
      </> : null}
    </section>
  );
}
