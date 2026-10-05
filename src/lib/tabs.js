import { useEffect, useState } from "react";

// The site's six tabs. The address hash picks the tab (#standings, #league,
// ...), so links, the Back button and the home-screen app all work. Older
// section links (#playoffs, #rip, ...) open the tab that holds that section
// and scroll to it.
export const TABS = [
  { id: "live", label: "Live", icon: "🏈" },
  { id: "standings", label: "Standings", icon: "🏆" },
  { id: "death-watch", label: "Death Watch", icon: "🪓" },
  { id: "league", label: "League", icon: "📚" },
  { id: "teams", label: "Teams", icon: "👥" },
  { id: "survivor", label: "Survivor", icon: "🛡️" }
];
// Sections within each tab, for the phone section strip (ids on the page).
export const TAB_SECTIONS = {
  live: [["my-team", "My team"], ["primetime", "Tonight"], ["scores", "Scores"], ["ticket-race", "Ticket race"], ["scoreboard", "Median"]],
  standings: [["standings-odds", "Standings"], ["playoffs", "Playoffs"], ["ultimate-loser", "Ultimate Loser"], ["raffle", "Raffle"]],
  "death-watch": [["death-watch", "At risk"], ["survival", "Survival odds"], ["rip", "RIP"]],
  league: [["history", "History"], ["awards", "Awards"], ["record-book", "Record Book"], ["rivalries", "Rivalries"]],
  teams: [],
  survivor: [["survivor", "Pool"], ["survivor-picks", "Picks"], ["survivor-managers", "Managers"], ["survivor-teams", "Teams left"], ["survivor-standings", "Entries"]]
};
export const SECTION_TAB = {
  scores: "live", primetime: "live", "ticket-race": "live", scoreboard: "live", "my-team": "live",
  "standings-odds": "standings", playoffs: "standings", "ultimate-loser": "standings", raffle: "standings",
  rip: "death-watch", survival: "death-watch",
  history: "league", awards: "league", "record-book": "league", rivalries: "league",
  "survivor-picks": "survivor", "survivor-managers": "survivor", "survivor-teams": "survivor", "survivor-standings": "survivor"
};
const isTab = id => TABS.some(t => t.id === id);
const tabFor = hash => {
  const id = hash.replace(/^#/, "");
  return isTab(id) ? id : SECTION_TAB[id] || "live";
};

export function useTabs() {
  const [tab, setTab] = useState(() => tabFor(window.location.hash));
  useEffect(() => {
    const show = () => {
      const id = window.location.hash.slice(1);
      setTab(tabFor(window.location.hash));
      // Wait for the tab to render, then jump to the linked section or the top.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = id && !isTab(id) ? document.getElementById(id) : null;
        if (target) {
          if (target.tagName === "DETAILS") target.open = true;
          target.scrollIntoView();
        } else {
          window.scrollTo(0, 0);
        }
      }));
    };
    window.addEventListener("hashchange", show);
    if (window.location.hash && !isTab(window.location.hash.slice(1))) show();
    return () => window.removeEventListener("hashchange", show);
  }, []);
  // Tapping the current tab scrolls back to the top.
  const go = id => {
    if (id === tab) window.scrollTo({ top: 0, behavior: "smooth" });
    else window.location.hash = id;
  };
  return [tab, go];
}

// The team this phone/browser follows ("my team"), remembered locally.
export function useMyTeam() {
  const [teamId, setTeamId] = useState(() => {
    try { return Number(localStorage.getItem("myTeam")) || null; } catch { return null; }
  });
  const choose = id => {
    setTeamId(id || null);
    try { id ? localStorage.setItem("myTeam", String(id)) : localStorage.removeItem("myTeam"); } catch {}
  };
  return [teamId, choose];
}
