import { useEffect, useState } from "react";
import initialScoreboard from "../../data/current/scoreboard.json";
import initialMarquee from "../../data/current/marquee.json";
import initialLivePlays from "../../data/current/live-plays.json";
import initialGuillotine from "../../data/current/guillotine.json";
import initialSeasonOdds from "../../data/current/season-odds.json";

export const money = n => Number(n).toFixed(2);

// NFL weeks run on Eastern time, so a Monday-night game stays on Monday.
export const formatDay = iso => iso
  ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })
  : "—";

// The Cloudflare Worker behind notifications and pull-to-refresh (worker/).
export const NOTIFY_SERVICE = "https://otwf-notify.otwf.workers.dev";

// Files published next to the bundle by vite.config.js.
const DATA_URL = import.meta.env.BASE_URL + "data/current/";

export async function fetchData(file) {
  const response = await fetch(DATA_URL + file + "?ts=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.json();
}

// Polls a published file. Pauses while the tab is hidden and refreshes as
// soon as it's visible again.
export function usePolledData(file, initial, intervalMs = 15000) {
  const [data, setData] = useState(initial);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const next = await fetchData(file);
        if (!cancelled) setData(next);
      } catch {
        // Keep showing the last good snapshot.
      }
    };
    load();
    const timer = setInterval(load, intervalMs);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [file, intervalMs, reloads]);
  // Calling reload() fetches right away (and restarts the timer).
  return [data, () => setReloads(n => n + 1)];
}

// Everything that changes during games, in one request (live.json). Pieces
// missing from an older published file fall back to the bundled copy.
const INITIAL_LIVE = {
  scoreboard: initialScoreboard,
  marquee: initialMarquee,
  livePlays: initialLivePlays,
  guillotine: initialGuillotine,
  seasonOdds: initialSeasonOdds
};
// While a requested live update is on its way, poll faster so it shows up soon after it's published.
const WAITING_POLL_MS = 8000;
const WAITING_FOR_MS = 4 * 60 * 1000;
export function useLiveData() {
  const [waitingUntil, setWaitingUntil] = useState(0);
  const [live, reload] = usePolledData("live.json", INITIAL_LIVE, waitingUntil > Date.now() ? WAITING_POLL_MS : 15000);
  // Reloads now and asks the worker to start a live update on GitHub if the
  // published data is stale. Resolves to the worker's answer ({ started,
  // reason, lastUpdated }), or null if it couldn't be reached.
  const refresh = async () => {
    reload();
    try {
      const response = await fetch(NOTIFY_SERVICE + "/refresh", { method: "POST" });
      const result = response.ok ? await response.json() : null;
      if (result?.started || result?.reason === "pending") setWaitingUntil(Date.now() + WAITING_FOR_MS);
      return result;
    } catch {
      return null;
    }
  };
  return { ...INITIAL_LIVE, ...live, refresh };
}

// Overall state of this week's NFL games, for the LIVE badge.
export function gameState(scoreboard) {
  const games = scoreboard.nflGames || [];
  if (games.some(g => g.state === "in")) return "LIVE";
  if (games.length && games.every(g => g.completed)) return "FINAL";
  if (!games.length || games.every(g => g.state === "pre")) return "NOT STARTED";
  return "BETWEEN GAMES";
}
