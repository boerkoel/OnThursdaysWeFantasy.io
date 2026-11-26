import React, { useEffect, useRef, useState } from "react";
import { pct } from "../lib/data.js";
import { shortPlay } from "../lib/playText.js";
import { RushShift } from "./RushField.jsx";

// While you were away (Jim, 2026-11-26: "show what's changed since last time you saw it ... I don't get to picking up
// my phone until the ad break"). When the app goes to the background (or the Dashboard is left), it saves every
// needle's odds and the Rush on this device. Back after AWAY_MS or more, the same week, a card shows the biggest league
// plays since, your team's odds then → now, the league's biggest needle swings and the Rush lanes that moved (run from
// where they were); and for a moment the needles sit where you left them, then swing to now (gold flash on the big
// ones). Nothing notable, no card. A tap or SHOW_MS closes it.
const KEY = "otwfSeen", AWAY_MS = 3 * 60 * 1000, MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SWING = 5, PLAY_PTS = 2, REPLAY_MS = 1500, SHOW_MS = 30000;
const byTeam = (scores, field) => Object.fromEntries(scores.map(s => [s.teamId, Number(s[field])]).filter(([, v]) => Number.isFinite(v)));

export function useCatchUp({ week, scores, seasonOdds }) {
  const latest = useRef(null);
  latest.current = scores.length ? {
    week: Number(week), win: byTeam(scores, "winProbability"), med: byTeam(scores, "aboveMedianProbability"), ticket: byTeam(scores, "topScoreProbability"),
    rush: Object.fromEntries((seasonOdds?.teams || []).map(t => [t.teamId, Number(t.playoffOdds)]))
  } : null;
  const [from, setFrom] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const opener = useRef(null);
  useEffect(() => {
    const save = () => { if (latest.current) try { localStorage.setItem(KEY, JSON.stringify({ ...latest.current, t: Date.now() })); } catch {} };
    const open = opener.current = () => {
      let snap = null;
      try { snap = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
      const age = snap ? Date.now() - snap.t : 0;
      if (!snap || snap.week !== latest.current?.week || age < AWAY_MS || age > MAX_AGE_MS) return;
      setFrom(snap);
      setReplaying(true);
    };
    const onVisible = () => document.visibilityState === "hidden" ? save() : open();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisible);
    return () => { save(); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  // A fresh open: check once the week's scores are in.
  const ready = Boolean(latest.current);
  useEffect(() => { if (ready) opener.current?.(); }, [ready]);
  useEffect(() => {
    if (!from) return;
    const a = setTimeout(() => setReplaying(false), REPLAY_MS), b = setTimeout(() => setFrom(null), SHOW_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [from?.t]);
  return {
    from,
    dismiss: () => { setFrom(null); setReplaying(false); },
    // While replaying, a needle shows the odds you left it at.
    oddsOf: (kind, teamId, now) => replaying && Number.isFinite(from?.[kind]?.[teamId]) ? from[kind][teamId] : now
  };
}

export function CatchUpCard({ from, scores, plays = [], seasonOdds, logos = {}, myTeamId = null, onClose }) {
  const mins = Math.max(1, Math.round((Date.now() - from.t) / 60000));
  const teamName = new Map(scores.map(s => [Number(s.teamId), s.team]));
  const big = plays.filter(p => p.wallclock && Date.parse(p.wallclock) > from.t && Math.abs(Number(p.points)) >= PLAY_PTS)
    .sort((x, y) => Math.abs(y.points) - Math.abs(x.points)).slice(0, 3);
  const change = (kind, s, field) => {
    const was = from[kind]?.[s.teamId], now = Number(s[field]);
    return Number.isFinite(was) && Number.isFinite(now) ? { was, now, d: now - was } : null;
  };
  const me = scores.find(s => Number(s.teamId) === Number(myTeamId));
  const mine = me ? [["win", "winProbability", "to win"], ["med", "aboveMedianProbability", "above the median"], ["ticket", "topScoreProbability", "for the ticket"]]
    .map(([k, f, words]) => ({ words, ...change(k, me, f) })).filter(x => Number.isFinite(x.d) && Math.abs(x.d) >= 1) : [];
  // The league's biggest swings: each matchup once (the side that gained), the median and the ticket.
  const swings = scores.filter(s => !me || s.teamId !== me.teamId).flatMap(s => [
    { s, words: "to win", ...change("win", s, "winProbability") },
    { s, words: "above the median", ...change("med", s, "aboveMedianProbability") },
    { s, words: "for the ticket", ...change("ticket", s, "topScoreProbability") }
  ]).filter(x => Number.isFinite(x.d) && Math.abs(x.d) >= SWING && (x.words !== "to win" || x.d > 0))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3);
  const rush = (seasonOdds?.teams || []).map(t => ({ team: t, from: from.rush?.[t.teamId], to: Number(t.playoffOdds) }))
    .filter(m => Number.isFinite(m.from) && Math.abs(m.to - m.from) >= 3).sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, 3);
  if (!big.length && !mine.length && !swings.length && !rush.length) return null;
  const move = x => <em className={x.d > 0 ? "up" : "down"}>{pct(x.was)}→{pct(x.now)}</em>;
  return <div className="catchup" role="dialog" aria-label="While you were away" onClick={onClose}>
    <p className="catchup-head"><b>👋 While you were away</b> <small>{mins} min</small><span aria-hidden="true">✕</span></p>
    {mine.length ? <p className="catchup-mine"><b>{me.team}:</b> {mine.map((x, k) => <span key={x.words}>{k ? " · " : ""}{x.words} {move(x)}</span>)}</p> : null}
    {big.length ? <ul className="catchup-plays">{big.map(p => <li key={p.id || p.wallclock + p.player}>
      <b>{Number(p.points) > 0 ? "+" : ""}{Number(p.points).toFixed(1)}</b> {p.player} {shortPlay(p)} <i>{teamName.get(Number(p.fantasyTeamId)) || ""}</i></li>)}</ul> : null}
    {swings.length ? <ul className="catchup-swings">{swings.map(x => <li key={x.s.teamId + x.words}>{x.s.team} {x.words} {move(x)}</li>)}</ul> : null}
    {rush.length ? <><small className="mini-needles-label">🏈 PLAYOFF RACE</small><RushShift moves={rush} math={seasonOdds?.math || {}} logos={logos} /></> : null}
  </div>;
}
