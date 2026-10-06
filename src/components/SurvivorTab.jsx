import React, { useEffect, useMemo, useState } from "react";
import { NOTIFY_SERVICE, pct } from "../lib/data.js";

// Survivor tab: the league's survivor pool (OnSundaysWeSurvive on Splash
// Sports, from Week 4). The notification service holds the commissioner's
// Splash session and serves a cleaned-up feed at /survivor with locked picks
// only (picks stay hidden until kickoff):
//   { contest: { name, totalEntries, alive, eliminated, currentWeek, entryFee, prizePool, updatedAt },
//     weeks:   [{ week, locked, final, hidden, picks: [{ team, count, result }] }],
//     entries: [{ id, user, entry, alive, eliminatedWeek, picks: { [week]: { team, result } } }] }
// result: "won" | "lost" | "pending".
const POLL_MS = 2 * 60 * 1000;
// The league's buy-in, used when Splash doesn't carry the fee (collected off-platform).
const ENTRY_FEE = 5;
const dollars = n => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(Math.abs(n) % 1 ? 2 : 0)}`;
export const TEAM_NAMES = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns",
  DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs",
  LAC: "Chargers", LAR: "Rams", LV: "Raiders", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants",
  NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WAS: "Commanders"
};
// ESPN's logo CDN (WAS is "wsh" there).
const logo = team => `https://a.espncdn.com/i/teamlogos/nfl/500/${team === "WAS" ? "wsh" : String(team).toLowerCase()}.png`;

export function useSurvivorFeed() {
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
    return [...byUser].map(([user, entries]) => {
      const graded = entries.flatMap(e => Object.values(e.picks || {})).filter(p => p.result !== "pending");
      return { user, entries: entries.sort((a, b) => a.entry - b.entry), alive: entries.filter(e => e.alive).length,
        picksWon: graded.filter(p => p.result === "won").length, picksGraded: graded.length };
    })
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

  // Money: every live entry gets an equal share of the pot (a fair price when
  // nobody knows who'll outlast whom); ROI compares that with the buy-ins.
  const fee = Number(c.entryFee) || ENTRY_FEE;
  const pot = Number(c.prizePool) || fee * total;
  const perAlive = c.alive ? pot / c.alive : 0;
  const ledger = managers.map(m => {
    const invested = m.entries.length * fee, ev = m.alive * perAlive;
    return { ...m, invested, ev, roi: invested ? (ev - invested) / invested * 100 : 0 };
  }).sort((a, b) => b.ev - a.ev || b.picksWon / (b.picksGraded || 1) - a.picksWon / (a.picksGraded || 1) || a.user.localeCompare(b.user));

  // Teams left: how many live entries can still pick each team (no team
  // twice), most used first. Built from published picks only, so a pick that hasn't locked
  // still counts its team as available.
  const liveEntries = (feed.entries || []).filter(e => e.alive);
  const teamsLeft = Object.keys(TEAM_NAMES).map(team => {
    const left = liveEntries.filter(e => !Object.values(e.picks || {}).some(p => p.team === team)).length;
    return { team, left, used: liveEntries.length - left };
  }).sort((a, b) => a.left - b.left || a.team.localeCompare(b.team));

  // Week highlights, from the latest week with locked picks.
  const highlights = [];
  const hw = lockedWeeks[lockedWeeks.length - 1];
  if (hw) {
    const n = hw.week, picks = hw.picks;
    const field = picks.reduce((sum, p) => sum + p.count, 0) || 1;
    const name = t => TEAM_NAMES[t] || t;
    const chalk = picks[0];
    if (chalk) highlights.push({ icon: "🐑", title: "Chalk check", text: `${pct(chalk.count / field * 100)} of the pool rode the ${name(chalk.team)}`
      + (chalk.result === "won" ? " and the herd lives on." : chalk.result === "lost" ? ". The herd went over the cliff." : ". Fingers crossed.") });
    const bloodbath = picks.filter(p => p.result === "lost").sort((a, b) => b.count - a.count)[0];
    if (bloodbath) highlights.push({ icon: "🩸", title: "Bloodbath", text: `The ${name(bloodbath.team)} took out ${bloodbath.count} ${bloodbath.count === 1 ? "entry" : "entries"}.` });
    const pickers = team => (feed.entries || []).filter(e => e.picks?.[n]?.team === team).map(e => e.user);
    const wolves = picks.filter(p => p.count === 1 && p.result === "won");
    const wolfPack = new Map();
    for (const p of wolves) { const user = pickers(p.team)[0]; wolfPack.set(user, [...(wolfPack.get(user) || []), p.team]); }
    if (wolves.length) highlights.push({ icon: "🐺", title: wolfPack.size > 1 ? "Lone wolves" : "Lone wolf",
      text: [...wolfPack].map(([user, teams]) => `${user} (${teams.join(", ")})`).join(", ") + ` went where nobody else would and lived.` });
    const stacks = managers.map(m => {
      const counts = {};
      for (const e of m.entries) { const p = e.picks?.[n]; if (p) counts[p.team] = (counts[p.team] || 0) + 1; }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return { user: m.user, teams: Object.keys(counts).length, top };
    });
    const basket = stacks.filter(x => x.top && x.top[1] >= 3).sort((a, b) => b.top[1] - a.top[1])[0];
    if (basket) highlights.push({ icon: "🧺", title: "All eggs, one basket", text: `${basket.user} put ${basket.top[1]} entries on the ${name(basket.top[0])}.` });
    const hedge = stacks.filter(x => x.teams >= 3).sort((a, b) => b.teams - a.teams)[0];
    if (hedge) highlights.push({ icon: "🏦", title: "Hedge fund", text: `${hedge.user} spread out across ${hedge.teams} different teams.` });
  }

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
      {highlights.length ? <div className="sv-highlights">
        <span className="section-kicker">WEEK {hw.week} HIGHLIGHTS</span>
        {highlights.map(h => <div className="sv-highlight" key={h.title}><span>{h.icon}</span><p><b>{h.title}</b> {h.text}</p></div>)}
      </div> : null}
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

    <section id="survivor-managers" className="section">
      <div className="section-heading"><div><span className="section-kicker">THE PORTFOLIOS</span><h2>Managers</h2></div>
        <span className="record-count">{dollars(pot)} POT · {dollars(perAlive)} / LIVE ENTRY</span></div>
      <div className="sv-ledger">
        <div className="sv-ledger-row head"><span>Manager</span><span>Alive</span><span>Won</span>
          <span title={`Expected value = (manager's entries remaining ÷ all entries remaining) × the ${dollars(pot)} pot`}>Exp. value ⓘ</span>
          <span title="Expected ROI = (expected value − buy-ins) ÷ buy-ins">Exp. ROI ⓘ</span></div>
        {ledger.map(m => <div className={"sv-ledger-row" + (m.alive ? "" : " out")} key={m.user}>
          <b className="sv-ledger-name">{m.user}</b>
          <span className="sv-ledger-alive"><b>{m.alive}</b>/{m.entries.length}
            <i className="sv-dots">{m.entries.map(e => <i key={e.id} className={e.alive ? "alive" : "out"} />)}</i></span>
          <span>{m.picksGraded ? `${pct(m.picksWon / m.picksGraded * 100)}` : "—"}<small>{m.picksGraded ? ` ${m.picksWon}/${m.picksGraded}` : ""}</small></span>
          <span className="sv-ledger-ev">{dollars(m.ev)}<small> of {dollars(m.invested)}</small></span>
          <b className={"sv-ledger-roi " + (m.roi > 0.5 ? "up" : m.roi < -0.5 ? "down" : "")}>{m.roi > 0 ? "+" : m.roi < 0 ? "−" : ""}{Math.abs(m.roi).toFixed(0)}%</b>
        </div>)}
      </div>
      <p className="median-note">Expected value = (manager's entries remaining ÷ all {c.alive} entries remaining) × the {dollars(pot)} pot ({dollars(fee)} × {total} entries). Expected ROI = (expected value − buy-ins) ÷ buy-ins. Every live entry counts equally; picks won counts graded picks across all entries.</p>
    </section>

    <section id="survivor-teams" className="section">
      <div className="section-heading"><div><span className="section-kicker">WHO'S STILL ON THE MENU</span><h2>Teams left</h2></div>
        <span className="record-count">OF {liveEntries.length} LIVE ENTRIES</span></div>
      <div className="sv-teams">
        {teamsLeft.map(t => <div className={"sv-team" + (t.left ? "" : " gone")} key={t.team} title={`${TEAM_NAMES[t.team]}: ${t.left} of ${liveEntries.length} live entries can still pick them`}>
          <img src={logo(t.team)} alt="" loading="lazy" />
          <span className="sv-team-name">{t.team}</span>
          <span className="sv-dist-bar"><i style={{ width: `${liveEntries.length ? t.left / liveEntries.length * 100 : 0}%` }} /></span>
          <b>{t.left}</b>
        </div>)}
      </div>
      <p className="median-note">Entries that haven't used the team yet. A pick counts once it locks at kickoff.</p>
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
