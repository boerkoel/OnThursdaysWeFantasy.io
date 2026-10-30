import React, { useEffect, useMemo, useState } from "react";
import { NOTIFY_SERVICE, pct } from "../lib/data.js";
import { feedTeam, survivorModel } from "../../scripts/lib/survivor-model.js";

export { survivorModel };

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

// ESPN abbreviations that differ from the feed's.

// This week's games with the pool's revealed picks on each side, and each
// manager's expected value (the tab's equal-share model) if either side wins.
// A strip of field, away end zone on the left and home on the right (as the card reads), with the ball at the spot.
export function Field({ drive, homeHasBall }) {
  const at = drive.yardLine == null ? null : 100 - drive.yardLine;   // percent from the left; yardLine counts from the home goal line
  return <div className={"sv-field" + (drive.redZone ? " red" : "")} title={drive.text}>
    <div className="sv-field-strip"><span className="ez" /><span className="ez" />
      {at != null ? <span className="sv-field-ball" style={{ left: `calc(8% + ${at * 0.84}%)` }}>{homeHasBall ? "◀" : "▶"}</span> : null}</div>
    {drive.text ? <small>{drive.text}{drive.redZone ? " · red zone" : ""}</small> : null}
  </div>;
}

function GamesSection({ feed, games, pot }) {
  const n = feed.contest?.currentWeek;
  const entries = feed.entries || [];
  // Entries still in it this week: alive, or knocked out this week (their pick is in a game below).
  const inPlay = entries.filter(e => e.alive || e.eliminatedWeek === n);
  const pickOf = e => e.picks?.[n];
  const revealed = inPlay.filter(pickOf).length;
  const users = [...new Set(inPlay.map(e => e.user))];
  // Expected value per manager when the given teams lose (their entries are out).
  // open: this game's teams, judged by `losers` even once graded (a final's "what it meant").
  const valueIf = (losers, open = new Set()) => {
    const survives = e => {
      const p = pickOf(e);
      // A "lost" only counts once that game is final (Splash marks trailing picks lost mid-game).
      const final = (games || []).find(g => (g.teams || []).some(x => feedTeam(x.abbrev) === p?.team))?.completed ?? true;
      if (p?.result === "lost" && final && !open.has(p.team)) return false;
      return !(p && losers.has(p.team));
    };
    let alive = inPlay.filter(survives);
    if (!alive.length) alive = inPlay.filter(e => pickOf(e)?.result !== "lost" || open.has(pickOf(e)?.team));   // everyone lost: auto-revive
    const per = alive.length ? pot / alive.length : 0;
    return Object.fromEntries(users.map(u => [u, alive.filter(e => e.user === u).length * per]));
  };
  const now = valueIf(new Set());
  const rows = (games || []).map(g => {
    const [home, away] = [g.teams.find(t => t.home), g.teams.find(t => !t.home)];
    if (!home || !away) return null;
    const side = t => {
      const team = feedTeam(t.abbrev);
      const by = inPlay.filter(e => pickOf(e)?.team === team);
      const who = {};
      for (const e of by) who[e.user] = (who[e.user] || 0) + 1;
      return { team, ball: g.drive?.possession === t.id, score: g.state === "pre" ? null : t.score, count: by.length, who: Object.entries(who).sort((a, b) => b[1] - a[1]),
        chance: g.completed || t.winChance == null ? null : Number(t.winChance) };
    };
    const a = side(away), h = side(home);
    const winner = g.completed ? (a.score > h.score ? a.team : h.score > a.score ? h.team : null) : null;
    return { g, a, h, winner };
  }).filter(Boolean).sort((x, y) => (y.a.count + y.h.count) - (x.a.count + x.h.count) || String(x.g.kickoff).localeCompare(String(y.g.kickoff)));
  if (!rows.length) return null;
  const status = g => g.completed ? "Final" : g.state === "in" ? (g.detail || "Live") : g.detail || "";
  const sideCell = (x, winner, completed) => <div className={"sv-game-side" + (completed && winner && winner !== x.team ? " lost" : completed && winner === x.team ? " won" : "")}>
    <img src={logo(x.team)} alt="" loading="lazy" /><b>{x.team}{x.ball ? <span className="sv-ball" title="Has the ball"> 🏈</span> : null}</b>{x.score != null && x.score !== "" ? <span className="sv-game-score">{x.score}</span> : null}
    <span className="sv-game-picks">{x.chance != null ? <span className={"sv-game-odds" + (x.chance >= 0.5 ? " fav" : "")} title="Chance to win: ESPN's live win probability in game, the betting line before kickoff">{Math.round(x.chance * 100)}% to win</span> : null}{x.count ? <>{x.count} {x.count === 1 ? "entry" : "entries"} · {pct(revealed ? x.count / revealed * 100 : 0)}</> : "no picks"}</span>
    {x.who.length ? <small>{x.who.map(([u, k]) => k > 1 ? `${u} ×${k}` : u).join(", ")}</small> : null}
  </div>;
  return <section id="survivor-games" className="section">
    <div className="section-heading"><div><span className="section-kicker">WEEK {n} · WHO'S RIDING WHOM</span><h2>Games</h2></div>
      <span className="record-count">{revealed} OF {inPlay.length} PICKS REVEALED</span></div>
    <div className="sv-games">
      {rows.filter(r => r.a.count + r.h.count > 0 || r.g.state !== "pre").map(({ g, a, h, winner }) => {
        const swing = a.count || h.count;
        const both = new Set([a.team, h.team]);
        const ifA = swing ? valueIf(new Set([h.team]), both) : null, ifH = swing ? valueIf(new Set([a.team]), both) : null;
        const movers = swing ? users.map(u => ({ u, now: now[u], a: ifA[u], h: ifH[u] }))
          .filter(m => Math.abs(m.a - m.h) >= 0.5).sort((x, y) => Math.abs(y.a - y.h) - Math.abs(x.a - x.h)) : [];
        return <div className={"sv-game" + (g.state === "in" ? " live" : "") + (g.completed ? " final" : "")} key={g.id}>
          <div className="sv-game-head"><span>{status(g)}</span></div>
          <div className="sv-game-sides">{sideCell(a, winner, g.completed)}<span className="sv-game-at">@</span>{sideCell(h, winner, g.completed)}</div>
          {g.drive ? <Field drive={g.drive} homeHasBall={h.ball} /> : null}
          {movers.length ? <details className="sv-root">
            <summary>{g.completed ? "What it meant" : "Rooting interests"} · {movers.length} {movers.length === 1 ? "manager" : "managers"}</summary>
            <div className="sv-root-row head"><span>Manager</span><span>If {a.team} wins</span><span>If {h.team} wins</span><span>Root for</span></div>
            {movers.map(m => <div className="sv-root-row" key={m.u}><b title={m.u}>{m.u}</b><span>{dollars(m.a)}</span><span>{dollars(m.h)}</span>
              <b className={m.a > m.h ? "up" : "down"}>{m.a > m.h ? a.team : h.team}</b></div>)}
          </details> : null}
        </div>;
      })}
    </div>
    {rows.some(r => !(r.a.count + r.h.count > 0 || r.g.state !== "pre")) ? <p className="sv-game-later"><b>Not kicked off yet:</b> {rows.filter(r => !(r.a.count + r.h.count > 0 || r.g.state !== "pre"))
      .sort((x, y) => String(x.g.kickoff).localeCompare(String(y.g.kickoff))).map(r => {
        const fav = r.a.chance != null && r.h.chance != null ? (r.a.chance >= r.h.chance ? r.a : r.h) : null;
        return `${r.a.team} @ ${r.h.team}${fav ? ` (${fav.team} ${Math.round(fav.chance * 100)}%)` : ""}`;
      }).join(" · ")}</p> : null}
    <p className="median-note">Picks show once their game kicks off. Rooting interests use the same money model as Managers: every live entry gets an equal share of the {dollars(pot)} pot, so a game moves a manager's value both through their own entries and through everyone else's. Picks that haven't been revealed yet are assumed to survive here.</p>
  </section>;
}

export default function SurvivorTab({ nflGames = [], nflWeek = null }) {
  const { feed, failed } = useSurvivorFeed();
  const weeks = feed?.weeks || [];
  const lockedWeeks = weeks.filter(w => w.locked);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [ledgerLive, setLedgerLive] = useState(true);
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
  const { n, thisWeek, settledPick, hiddenOptions, expectedLeft, sim: weekSim, stands } = survivorModel(feed, nflGames, nflWeek);
  const showLive = ledgerLive && weekSim && !weekSim.final;
  const ledger = managers.map(m => {
    const invested = m.entries.length * fee, ev = showLive ? weekSim.value[m.user] || 0 : weekSim ? stands[m.user] || 0 : m.alive * perAlive;
    return { ...m, invested, ev, roi: invested ? (ev - invested) / invested * 100 : 0, left: expectedLeft(m) };
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
    // Live games this week: a "lost" pick isn't settled until its game is final.
    const current = nflWeek == null || Number(nflWeek) === Number(n);
    const gameFor = team => {
      if (!current) return null;
      for (const g of nflGames || []) {
        const t = (g.teams || []).find(x => feedTeam(x.abbrev) === team), o = (g.teams || []).find(x => feedTeam(x.abbrev) !== team);
        if (t && o) return { g, us: Number(t.score) || 0, them: Number(o.score) || 0, opp: feedTeam(o.abbrev) };
      }
      return null;
    };
    const live = team => { const x = gameFor(team); return x && !x.g.completed && x.g.state === "in" ? x : null; };
    const settledLoss = p => p.result === "lost" && !live(p.team);
    const score = x => `${x.us}–${x.them}`;
    const chalk = picks[0];
    if (chalk) {
      const lg = live(chalk.team);
      highlights.push({ icon: "🐑", title: "Chalk check", text: `${pct(chalk.count / field * 100)} of the pool rode the ${name(chalk.team)}`
        + (chalk.result === "won" ? " and the herd lives on."
          : lg && lg.us < lg.them ? `, who trail ${name(lg.opp)} ${score(lg)}. The herd could be in trouble.`
          : settledLoss(chalk) ? ". The herd went over the cliff." : ". Fingers crossed.") });
    }
    const bloodbath = picks.filter(settledLoss).sort((a, b) => b.count - a.count)[0];
    if (bloodbath) highlights.push({ icon: "🩸", title: "Bloodbath", text: `The ${name(bloodbath.team)} took out ${bloodbath.count} ${bloodbath.count === 1 ? "entry" : "entries"}.` });
    // Trending the wrong way: picks in a game still going whose team is under
    // 50% to win (ESPN's live win probability), or trailing if that's missing.
    const winNow = team => { const x = live(team); const t = x && (x.g.teams || []).find(y => feedTeam(y.abbrev) === team); return t?.winChance ?? null; };
    const trailing = picks.filter(p => p.count > 0 && live(p.team) && (winNow(p.team) != null ? winNow(p.team) < 0.5 : live(p.team).us < live(p.team).them))
      .sort((a, b) => b.count - a.count);
    const worst = trailing[0];
    if (worst && (!bloodbath || worst.count > bloodbath.count)) {
      const x = live(worst.team);
      highlights.push({ icon: "🩸", title: "Could be a bloodbath", text: `${worst.count} ${worst.count === 1 ? "entry is" : "entries are"} on the ${name(worst.team)}, down ${score(x)} to the ${name(x.opp)}${x.g.detail ? ` (${x.g.detail})` : ""}.` });
    }
    if (trailing.length) highlights.push({ icon: "📉", title: "Trending the wrong way", text: trailing.map(p => {
      const x = live(p.team);
      const w = winNow(p.team);
      return `${name(p.team)} ${x.us < x.them ? "trail" : x.us > x.them ? "lead" : "tied with"} ${x.opp} ${score(x)}${w != null ? `, ${pct(w * 100)} to win` : ""} (${p.count} ${p.count === 1 ? "entry" : "entries"})`;
    }).join(" · ") + ". These picks could be in trouble." });
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
      {weekSim ? <p className="sv-topline">{weekSim.final   // topline (Jim, 2026-10-25): entries still standing and how many the odds expect to survive
        ? <><b>{weekSim.total - weekSim.lost}</b> of {weekSim.total} entries survived Week {n}.</>
        : <><b>{weekSim.total - weekSim.lost}</b> of {weekSim.total} entries still standing{weekSim.lost ? ` (${weekSim.lost} lost)` : ""}. The odds expect <b>{weekSim.exp.toFixed(1)}</b> to survive Week {n}{weekSim.lo !== weekSim.hi ? ` (likely ${weekSim.lo}–${weekSim.hi})` : ""}.
          {weekSim.hidden ? <small> Includes {weekSim.hidden} hidden {weekSim.hidden === 1 ? "pick" : "picks"}, modeled as favorites among each entry's unused teams in games that haven't kicked off.</small> : null}</>}</p> : null}
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

    {nflWeek === Number(c.currentWeek) ? <GamesSection feed={feed} games={nflGames} pot={pot} /> : null}

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
      <div className="section-heading"><div><span className="section-kicker">THE PORTFOLIOS</span><h2>Managers
        {weekSim && !weekSim.final ? <span className="standings-live-toggle">
          <button type="button" className={ledgerLive ? "active" : ""} onClick={() => setLedgerLive(true)}>Live</button>
          <button type="button" className={ledgerLive ? "" : "active"} onClick={() => setLedgerLive(false)}>As it stands</button>
        </span> : null}</h2></div>
        <span className="record-count">{dollars(pot)} POT · {dollars(perAlive)} / LIVE ENTRY</span></div>
      <div className="sv-ledger">
        <div className="sv-ledger-row head"><span>Manager</span><span>Alive</span>
          <span title={`Expected entries still alive after Week ${n}: each revealed pick counts its live chance to win (ESPN's in-game win probability, the betting line before kickoff); picks not revealed yet are modeled as favorites among the entry's unused teams in games that haven't kicked off (*)`}>Wk {n} ⓘ</span><span>Won</span>
          <span title={showLive
            ? `Expected value = the manager's average share of the ${dollars(pot)} pot over 2,000 simulations of this week. Not simply expected entries × an even share: entries on the same team live or die together, so an entry riding the crowd's pick splits the pot with that crowd when it survives, while one on a different team can get a bigger share when the crowd loses`
            : `Expected value = (manager's entries still standing ÷ all entries still standing) × the ${dollars(pot)} pot`}>Exp. value ⓘ</span>
          <span title="Expected ROI = (expected value − buy-ins) ÷ buy-ins">Exp. ROI ⓘ</span></div>
        {ledger.map(m => <div className={"sv-ledger-row" + (m.alive ? "" : " out")} key={m.user}>
          <b className="sv-ledger-name">{m.user}</b>
          <span className="sv-ledger-alive"><b>{m.alive}</b>/{m.entries.length}
            <i className="sv-dots">{m.entries.map(e => <i key={e.id} className={e.alive ? "alive" : "out"} />)}</i></span>
          <span title={m.left.hidden ? `${m.left.hidden} pick${m.left.hidden > 1 ? "s" : ""} not revealed yet, modeled` : undefined}>{m.alive || m.left.exp ? m.left.exp.toFixed(1) : "—"}{m.left.hidden ? "*" : ""}</span>
          <span>{m.picksGraded ? `${pct(m.picksWon / m.picksGraded * 100)}` : "—"}<small>{m.picksGraded ? ` ${m.picksWon}/${m.picksGraded}` : ""}</small></span>
          <span className="sv-ledger-ev">{dollars(m.ev)}<small> of {dollars(m.invested)}</small></span>
          <b className={"sv-ledger-roi " + (m.roi > 0.5 ? "up" : m.roi < -0.5 ? "down" : "")}>{m.roi > 0 ? "+" : m.roi < 0 ? "−" : ""}{Math.abs(m.roi).toFixed(0)}%</b>
        </div>)}
      </div>
      {showLive ? <p className="median-note"><b>Live:</b> expected value averages each manager's share of the pot over 2,000 simulations of this week's games (live win chances; hidden picks modeled), so it moves with every game in action. Switch to As it stands for the current count.</p> : weekSim && !weekSim.final ? <p className="median-note"><b>As it stands:</b> a pick counts as lost once its game is final or it's under 0.5% to win in a live game; everything still open counts as surviving.</p> : null}
      <p className="median-note">Expected value = (manager's entries remaining ÷ all {c.alive} entries remaining) × the {dollars(pot)} pot ({dollars(fee)} × {total} entries). Expected ROI = (expected value − buy-ins) ÷ buy-ins. Every live entry counts equally; picks won counts graded picks across all entries. Wk {n} = expected entries left after this week, live from each pick's chance to win; * = includes picks not revealed yet, modeled as favorites among each entry's unused teams in games that haven't kicked off.</p>
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
