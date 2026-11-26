// Link-preview views (Jim, 2026-11-25: "sharing a link to #rush previews the current dash graphic"). Each gets a
// tiny page at /s/<view>/ (vite.config.js) whose preview shows that view's picture, taken by headless Chrome on
// every deploy (scripts/share-images.js), and which forwards to the site at #<hash>. Crawlers never see the part
// after #, so the hash alone can't do this. shot: the element pictured; views without one keep the site icon.
export const SHARE_VIEWS = {
  dashboard: { title: "Dashboard", hash: "dashboard", shot: ".tv-inline" },
  rush: { title: "The 100-Yard Rush", hash: "rush", shot: "#rush" },
  live: { title: "Live", hash: "live", shot: "#scores" },
  games: { title: "Games", hash: "games", shot: "main .section" },
  standings: { title: "Standings", hash: "standings", shot: "#standings-odds" },
  playoffs: { title: "Playoff Picture", hash: "playoffs", shot: "#playoffs" },
  league: { title: "League", hash: "league", shot: "#report-cards" },
  teams: { title: "Teams", hash: "teams", shot: "#trades" },
  survivor: { title: "Survivor", hash: "survivor", shot: "#survivor" },
  "death-watch": { title: "Death Watch", hash: "death-watch" }
};
