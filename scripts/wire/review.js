import { DATA, clockNow, currentScores, currentWeek, currentWeekMatchups, guillotineData, liveScoreboard, money, pct, pts, readJson, seasonOddsData } from "./context.js";
import { stockLines, stockMovers } from "./stock.js";

// League Wire: the week in review.
// ---- Week in review -------------------------------------------------------
// For 48 hours after the last game of a week (usually MNF), the wire mixes
// that week's biggest storylines in with stories about the week ahead.
export const REVIEW_HOURS_AFTER_LAST_GAME = 48;
export const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;

// Swing headlines, in the past tense, for matchups already decided. Saved in
// marquee.json so they outlive the scoreboard's win history once the week
// rolls over. Returns null when there's nothing decided to report.
export function weekHeadlines() {
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (history.length < 3) return null;
  const oddsOf = id => history.map(pt => Number(pt.p?.[id])).filter(Number.isFinite);
  const byTeam = new Map(currentScores.map(s => [s.teamId, s]));
  const stories = [];
  const comebacks = [];
  const wild = [];
  for (const m of currentWeekMatchups) {
    const a = byTeam.get(m.homeTeamId), b = byTeam.get(m.awayTeamId);
    if (!a || !b) continue;
    const winner = Number(a.winProbability) >= 100 ? a : Number(b.winProbability) >= 100 ? b : null;
    if (!winner) continue;
    const loser = winner === a ? b : a;
    const low = Math.min(...oddsOf(winner.teamId));
    if (low <= 25) comebacks.push({winner, loser, low});
    let favorite = null, flips = 0;
    for (const p of oddsOf(a.teamId)) {
      const side = p > 55 ? "a" : p < 45 ? "b" : favorite;
      if (favorite && side !== favorite) flips++;
      favorite = side;
    }
    if (flips >= 3) wild.push({winner, loser, flips});
  }
  const escape = comebacks.sort((x, y) => x.low - y.low)[0];
  if (escape) stories.push({type:"GREAT ESCAPE", text:"📈 " + escape.winner.team + " was down to " + pct(escape.low) + " against " + escape.loser.team + " — and won.", score:78});
  const wildest = wild.sort((x, y) => y.flips - x.flips)[0];
  if (wildest) stories.push({type:"HEART ATTACK GAME", text:"💓 " + wildest.winner.team + " outlasted " + wildest.loser.team + " after the favorite flipped " + wildest.flips + " times.", score:74});
  return stories.length ? {week:currentWeek, stories} : null;
}

// When the week's last NFL game kicked off (cached in marquee.json).
export async function lastKickoff(week, previous) {
  if (previous?.review?.week === week && previous.review.lastKickoff) return previous.review.lastKickoff;
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`);
    if (!response.ok) return null;
    const dates = ((await response.json()).events || []).map(e => Date.parse(e.date)).filter(Number.isFinite);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  } catch {
    return null;
  }
}

export async function weekInReview(previous, archive) {
  const week = currentWeek - 1;
  if (week < 1) return {stories:[], meta:null};
  const kickoff = await lastKickoff(week, previous);
  const meta = {week, lastKickoff:kickoff};
  const reviewUntil = kickoff ? Date.parse(kickoff) + GAME_LENGTH_MS + REVIEW_HOURS_AFTER_LAST_GAME * 60 * 60 * 1000 : 0;
  if (clockNow() > reviewUntil) return {stories:[], meta};

  const label = type => "WEEK " + week + " · " + type;
  const stories = [];
  const weekly = await readJson(`${DATA}/weekly.json`).catch(() => null);
  const recap = (weekly?.weeks || []).find(w => Number(w.week) === week)?.recap || [];
  const RECAP_SCORES = {"HIGH SCORE":80, "CLOSEST MATCHUP":79, "INSTANT REGRET":77, "TOUGH LUCK":72, "BLOWOUT":70, "LUCKY WIN":69, "BIGGEST REGRET":62};
  for (const story of recap) stories.push({type:label(story.type), text:story.text, score:RECAP_SCORES[story.type] ?? 60});
  if (archive?.week === week) for (const story of archive.stories) stories.push({...story, type:label(story.type)});
  const lw = seasonOddsData?.lastWeek;
  if (Number(lw?.week) === week) {
    stockLines(stockMovers(lw.start, lw.end), "STOCK REPORT").forEach((text, i) => stories.push({type:label("STOCK REPORT"), text, score:75 - i}));
  }
  const chop = (guillotineData?.chopped || []).find(c => Number(c.week) === week);
  if (chop) stories.push({type:label("CHOPPED"), text:"🪦 " + chop.team + " got the axe in " + (guillotineData.leagueName || "the guillotine league") + " with " + pts(chop.finalScore) + (chop.survivedBy ? ", " + pts(chop.margin) + " short of " + chop.survivedBy.team : "") + ".", score:76});
  return {stories:stories.sort((a, b) => b.score - a.score), meta};
}

// Alternate review and current stories so neither crowds the other out.
export function interleave(first, second) {
  const out = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (i < second.length) out.push(second[i]);
    if (i < first.length) out.push(first[i]);
  }
  return out;
}
