import React, { useEffect, useMemo, useState } from "react";
import { NOTIFY_SERVICE, pct } from "../lib/data.js";

// Survivor tab: the league's survivor pool (OnSundaysWeSurvive on Splash
// Sports, from Week 4). The notification service holds the commissioner's
// Splash session and serves a cleaned-up feed at /survivor with locked picks
// only (picks stay hidden until kickoff):
//   { contest: { name, totalEntries, alive, eliminated, currentWeek, updatedAt },
//     weeks:   [{ week, locked, final, hidden, picks: [{ team, count, result }] }],
//     entries: [{ id, user, entry, alive, eliminatedWeek, picks: { [week]: { team, result } } }] }
// result: "won" | "lost" | "pending".
const POLL_MS = 2 * 60 * 1000;
const TEAM_NAMES = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns",
  DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs",
  LAC: "Chargers", LAR: "Rams", LV: "Raiders", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants",
  NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WAS: "Commanders"
};
// ESPN's logo CDN (WAS is "wsh" there).
const logo = team => `https://a.espncdn.com/i/teamlogos/nfl/500/${team === "WAS" ? "wsh" : String(team).toLowerCase()}.png`;

function useSurvivorFeed() {
  const [feed, setFeed] = useState(() => (typeof window !== "undefined" && window.__SURVIVOR_MOCK__) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (window.__SURVIVOR_MOCK__) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`${NOTIFY_SERVICE}/survivor?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json();
        if (!cancelled) { setFeed(next); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, []);
  return { feed, failed };
}

function TeamChip({ pick, small = false }) {
  if (!pick) return <span className={"sv-chip empty" + (small ? " small" : "")} />;
  return <span className={`sv-chip ${pick.result || "pending"}` + (small ? " small" : "")} title={`${TEAM_NAMES[pick.team] || pick.team}: ${pick.result || "pending"}`}>
    <img src={logo(pick.team)} alt="" loading="lazy" />
    <b>{pick.team}</b>
  </span>;
}

export default function SurvivorTab() {
  const { feed, failed } = useSurvivorFeed();
  const weeks = feed?.weeks || [];
  const lockedWeeks = weeks.filter(w => w.locked);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const week = lockedWeeks.find(w => w.week === selectedWeek) || lockedWeeks[lockedWeeks.length - 1] || null;

  // Managers with their entries, live entries first.
  const managers = useMemo(() => {
    const byUser = new Map();
    for (const e of feed?.entries || []) {
      if (!byUser.has(e.user)) byUser.set(e.user, []);
      byUser.get(e.user).push(e);
    }
    return [...byUser].map(([user, entries]) => ({ user, entries: entries.sort((a, b) => a.entry - b.entry), alive: entries.filter(e => e.alive).length }))
      .sort((a, b) => b.alive - a.alive || a.user.localeCompare(b.user));
  }, [feed]);

  if (!feed) {
    return <section id="survivor" className="section">
      <div className="section-heading"><div><span className="section-kicker">ONSUNDAYSWESURVIVE · SPLASH SPORTS</span><h2>Survivor</h2></div></div>
      <p className="median-note">{failed ? "The survivor feed isn't available yet. It's being connected to Splash Sports; check back soon." : "Loading the survivor pool…"}</p>
    </section>;
  }

  const c = feed.contest || {};
  const total = Number(c.totalEntries) || (c.alive + c.eliminated) || 0;
  const shownWeeks = weeks.map(w => w.week);
  const weekTotal = week ? week.picks.reduce((sum, p) => sum + p.count, 0) || total : total;
  const live = managers.flatMap(m => m.entries.filter(e => e.alive).map(e => ({ ...e, manager: m })));
  const out = managers.flatMap(m => m.entries.filter(e => !e.alive).map(e => ({ ...e, manager: m })))
    .sort((a, b) => (b.eliminatedWeek || 0) - (a.eliminatedWeek || 0) || a.user.localeCompare(b.user));

  const entryRow = e => <div className={"sv-entry" + (e.alive ? "" : " out")} key={e.id}>
    <div className="sv-entry-name"><b>{e.user}</b><small>Entry #{e.entry}{e.alive ? "" : ` · out Week ${e.eliminatedWeek}`}</small></div>
    <div className="sv-entry-picks">{shownWeeks.map(w => <TeamChip key={w} pick={e.picks?.[w]} small />)}</div>
  </div>;

  return <>
    <section id="survivor" className="section">
      <div className="section-heading"><div><span className="section-kicker">{(c.name || "Survivor pool").toUpperCase()} · SPLASH SPORTS</span><h2>Week {c.currentWeek} Survivor</h2></div>
        <span className="record-count">{c.alive} OF {total} ALIVE</span></div>
      <div className="sv-survival" aria-label={`${c.alive} entries alive, ${c.eliminated} eliminated`}>
        <span className="alive" style={{ flexGrow: c.alive || 0 }} />
        <span className="out" style={{ flexGrow: c.eliminated || 0 }} />
      </div>
      <p className="sv-survival-legend"><span className="alive">{c.alive} alive</span><span className="out">{c.eliminated} eliminated</span>
        <span>{managers.length} managers · one pick per week, a tie is a loss, no team twice</span></p>
    </section>

    <section id="survivor-picks" className="section">
      <div className="section-heading"><div><span className="section-kicker">WHO PICKED WHOM</span><h2>Pick distribution</h2></div></div>
      <div className="sv-weeks" role="tablist">
        {weeks.map(w => <button type="button" role="tab" key={w.week} disabled={!w.locked} aria-selected={week?.week === w.week}
          className={week?.week === w.week ? "active" : ""} onClick={() => setSelectedWeek(w.week)}>
          Week {w.week}{w.locked ? "" : <small>🔒 hidden</small>}
        </button>)}
      </div>
      {week ? <div className="sv-dist">
        {week.picks.filter(p => p.count > 0).sort((a, b) => b.count - a.count).map(p => <div className={`sv-dist-row ${p.result}`} key={p.team}>
          <span className="sv-dist-team"><img src={logo(p.team)} alt="" loading="lazy" />{TEAM_NAMES[p.team] || p.team}</span>
          <span className="sv-dist-bar"><i style={{ width: `${(p.count / (week.picks[0] ? Math.max(...week.picks.map(x => x.count)) : 1)) * 100}%` }} /></span>
          <span className="sv-dist-share">{pct((p.count / weekTotal) * 100)}</span>
          <b className="sv-dist-count">{p.count}</b>
        </div>)}
        <p className="median-note">{week.final ? `Week ${week.week}: ${week.picks.filter(p => p.result === "lost").reduce((s, p) => s + p.count, 0)} entries knocked out.`
          : `Picks show once their game kicks off${week.hidden ? ` · ${week.hidden} still hidden` : ""}.`}</p>
      </div> : <p className="median-note">Picks stay hidden until kickoff.</p>}
    </section>

    <section id="survivor-standings" className="section">
      <div className="section-heading"><div><span className="section-kicker">STILL STANDING</span><h2>Entries</h2></div><span className="record-count">{live.length} ALIVE</span></div>
      <div className="sv-entries">{live.map(entryRow)}</div>
      {out.length ? <>
        <div className="sv-divider">Eliminated · {out.length}</div>
        <div className="sv-entries">{out.map(entryRow)}</div>
      </> : null}
    </section>
  </>;
}
