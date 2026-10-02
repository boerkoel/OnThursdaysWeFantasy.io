import React, { useEffect, useRef, useState } from "react";

// How far the indicator moves (half the finger distance) before letting go refreshes.
const PULL_TO_REFRESH_PX = 70;
const MAX_PULL_PX = 110;
const MESSAGE_MS = 5000;

// The home-screen app has no browser reload, so it gets its own gesture.
const inApp = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const ago = iso => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
};

// Pull-to-refresh (home-screen app only) plus the message after any refresh.
// refresh() is useLiveData's: it reloads and, when the data is stale, starts
// a live update on GitHub. Returns { run, view }: run() does the same as a
// pull (for the ↻ button), view is the indicator to render.
export function useRefresh(refresh, lastUpdated) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [waitingSince, setWaitingSince] = useState(0);
  const busyRef = useRef(false);
  const runRef = useRef(null);

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const result = await refresh();
    busyRef.current = false;
    setBusy(false);
    if (result?.started || result?.reason === "pending") {
      setWaitingSince(Date.now());
      setMessage(result.started ? "Fetching fresh data from ESPN, about 2 minutes…" : "An update is already on its way…");
    } else if (result?.reason === "fresh") {
      setMessage(`Up to date. Updated ${ago(result.lastUpdated)}.`);
    } else {
      setMessage("Refreshed.");
    }
  };
  runRef.current = run;

  // The requested update has been published.
  useEffect(() => {
    if (waitingSince && lastUpdated && Date.parse(lastUpdated) > waitingSince - 60000) {
      setWaitingSince(0);
      setMessage("Fresh data is in.");
    }
  }, [lastUpdated, waitingSince]);

  // Messages fade after a few seconds, except while waiting for an update.
  useEffect(() => {
    if (!message || waitingSince) return;
    const timer = setTimeout(() => setMessage(""), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message, waitingSince]);

  useEffect(() => {
    if (!inApp()) return;
    let start = null;
    let distance = 0;
    const onStart = event => {
      start = window.scrollY <= 0 && event.touches.length === 1 && !busyRef.current
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      distance = 0;
    };
    const onMove = event => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      // Sideways (League Wire swipes) or upward: not a pull.
      if (distance === 0 && (dy <= 0 || Math.abs(dx) > dy)) { start = null; return; }
      event.preventDefault();
      distance = Math.min(MAX_PULL_PX, dy * 0.5);
      setPull(distance);
    };
    // A pull past the threshold refreshes when the finger lifts. iOS doesn't
    // always deliver touchend, so pointer events and the next touch count as
    // the release too.
    const onEnd = () => {
      if (start && distance >= PULL_TO_REFRESH_PX) runRef.current();
      start = null;
      distance = 0;
      setPull(0);
    };
    const onNextTouch = event => { if (start && distance >= PULL_TO_REFRESH_PX) onEnd(); onStart(event); };
    const ends = ["touchend", "touchcancel", "pointerup", "pointercancel"];
    window.addEventListener("touchstart", onNextTouch, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    for (const name of ends) window.addEventListener(name, onEnd);
    return () => {
      window.removeEventListener("touchstart", onNextTouch);
      window.removeEventListener("touchmove", onMove);
      for (const name of ends) window.removeEventListener(name, onEnd);
    };
  }, []);

  // One pill near the top: the pull, then "Refreshing…", then the result.
  const ready = pull >= PULL_TO_REFRESH_PX;
  const view = pull > 0 || busy || message ? (
    <div className="pull-indicator" role="status" style={{ transform: `translate(-50%, ${pull > 0 ? pull : 56}px)` }}>
      {pull > 0 ? <>
        <span className="pull-arrow" style={{ transform: `rotate(${ready ? 180 : 0}deg)` }}>↓</span>
        {ready ? "Release to refresh" : "Pull to refresh"}
      </> : busy ? <>
        <span className="pull-arrow spinning">↻</span>
        Refreshing…
      </> : <>
        {waitingSince ? <span className="pull-arrow spinning">↻</span> : <span className="pull-arrow">✓</span>}
        {message}
      </>}
    </div>
  ) : null;
  return { run, view };
}
