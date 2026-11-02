import { useEffect, useState } from "react";

// Keep the screen on while the game-day view is open (Jim, 2026-11-02): the Screen Wake Lock API, taken again
// whenever the page comes back into view (the system drops it when the app is hidden). Returns whether the lock
// is held, so the view can suggest setting Auto-Lock to Never where it isn't supported.
export function useWakeLock(active) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) { setHeld(false); return; }
    let lock = null, stopped = false;
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (stopped) { lock.release(); return; }
        setHeld(true);
        lock.addEventListener("release", () => { if (!stopped) setHeld(false); });
      } catch { setHeld(false); }
    };
    take();
    const onVisible = () => { if (document.visibilityState === "visible" && !stopped) take(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisible); lock?.release?.().catch?.(() => {}); setHeld(false); };
  }, [active]);
  return held;
}
