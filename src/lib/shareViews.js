// Link-preview views (Jim, 2026-11-25: "sharing a link to #rush previews the current dash graphic"). Each gets a
// tiny page at /s/<view>/ (vite.config.js) whose preview shows that view's picture, taken by headless Chrome on
// every deploy (scripts/share-images.js), and which forwards to the site at #<hash>. Crawlers never see the part
// after #, so the hash alone can't do this. shot: the element pictured; views without one keep the site icon.
export const SHARE_VIEWS = {
  dashboard: { title: "Dashboard", hash: "dashboard", shot: ".tv-inline" },
  rush: { title: "The 100-Yard Rush", hash: "rush", shot: "#rush" },
  live: { title: "Live", hash: "live", shot: "#scores" },
  games: { title: "Games", hash: "games", shot: "#games" },
  standings: { title: "Standings", hash: "standings", shot: "#standings-odds" },
  playoffs: { title: "Playoff Picture", hash: "playoffs", shot: "#playoffs" },
  league: { title: "League", hash: "league", shot: "#report-cards" },
  teams: { title: "Teams", hash: "teams", shot: "#trades" },
  survivor: { title: "Survivor", hash: "survivor", shot: "#survivor" },
  "death-watch": { title: "Death Watch", hash: "death-watch" },
  // Sections with a 🔗 by their title (a section not listed here shares its tab's view).
  scores: { title: "Week Scores", hash: "scores", shot: "#scores" },
  scoreboard: { title: "Median Scoreboard", hash: "scoreboard", shot: "#scoreboard" },
  primetime: { title: "What to Watch", hash: "primetime", shot: "#primetime" },
  "ticket-race": { title: "Ticket Race", hash: "ticket-race", shot: "#ticket-race" },
  accuracy: { title: "Projection Scorecard", hash: "accuracy", shot: "#accuracy" },
  "ultimate-loser": { title: "Ultimate Loser", hash: "ultimate-loser", shot: "#ultimate-loser" },
  history: { title: "Weekly History", hash: "history", shot: "#history" },
  awards: { title: "League Awards", hash: "awards", shot: "#awards" },
  "record-book": { title: "All-Time Record Book", hash: "record-book", shot: "#record-book" },
  "survivor-games": { title: "Survivor Games", hash: "survivor-games", shot: "#survivor-games" },
  "survivor-picks": { title: "Survivor Pick Distribution", hash: "survivor-picks", shot: "#survivor-picks" },
  "survivor-managers": { title: "Survivor Managers", hash: "survivor-managers", shot: "#survivor-managers" },
  "survivor-teams": { title: "Survivor Teams Left", hash: "survivor-teams", shot: "#survivor-teams" },
  "survivor-standings": { title: "Survivor Entries", hash: "survivor-standings", shot: "#survivor-standings" }
};
