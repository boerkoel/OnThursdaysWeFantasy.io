// All-time record book (build-record-book.js). Loaded only if the file exists,
// so the site builds before the first daily update creates it.
const books = import.meta.glob("../../data/current/record-book.json", { eager: true, import: "default" });
export const recordBook = Object.values(books)[0] || null;

const labels = recordBook?.managerLabels || {};
export const managerLabel = key => labels[key] || "Former manager";

// The all-time series between two managers, from the first one's side.
export function rivalryBetween(managerA, managerB) {
  if (!recordBook || !managerA || !managerB || managerA === managerB) return null;
  const r = (recordBook.rivalries || []).find(x => (x.a === managerA && x.b === managerB) || (x.a === managerB && x.b === managerA));
  if (!r) return null;
  const flipped = r.a !== managerA;
  return {
    ...r,
    a: managerA,
    b: managerB,
    aWins: flipped ? r.bWins : r.aWins,
    bWins: flipped ? r.aWins : r.bWins,
    aPoints: flipped ? r.bPoints : r.aPoints,
    bPoints: flipped ? r.aPoints : r.bPoints,
    lastMeeting: flipped ? { ...r.lastMeeting, aScore: r.lastMeeting.bScore, bScore: r.lastMeeting.aScore } : r.lastMeeting,
    biggestWin: flipped ? { a: r.biggestWin.b, b: r.biggestWin.a } : r.biggestWin
  };
}

// One-line series summary for this season's teams (by ESPN team id).
export function seriesLine(teamIdA, teamIdB) {
  if (!recordBook) return null;
  const managers = recordBook.currentTeamManagers || {};
  const series = rivalryBetween(managers[teamIdA], managers[teamIdB]);
  // "First meeting" only means something once past seasons are loaded.
  if (!series) return (recordBook.seasons || []).length > 1 ? "First-ever meeting" : null;
  const { aWins, bWins, ties } = series;
  const record = `${Math.max(aWins, bWins)}–${Math.min(aWins, bWins)}${ties ? `–${ties}` : ""}`;
  const lead = aWins === bWins ? `Series tied ${record}` : `${managerLabel(aWins > bWins ? series.a : series.b)} leads ${record}`;
  const last = series.lastMeeting;
  const lastText = last ? ` · last met ${last.season} W${last.week}${last.playoff ? " (playoffs)" : ""}` : "";
  const streak = series.streak?.length >= 2 ? ` · ${managerLabel(series.streak.manager)} has won ${series.streak.length} straight` : "";
  return `All-time: ${lead}${lastText}${streak}`;
}
