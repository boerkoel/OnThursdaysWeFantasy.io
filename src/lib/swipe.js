import { useRef } from "react";

// Left/right swipe for step-through views (carousels): returns touch handlers.
// A mostly-horizontal drag of SWIPE_PX or more steps; vertical scrolls are left alone.
const SWIPE_PX = 40;
export function useSwipe(onPrev, onNext) {
  const start = useRef(null);
  return {
    onTouchStart: event => { const t = event.touches[0]; start.current = { x: t.clientX, y: t.clientY }; },
    onTouchEnd: event => {
      const s = start.current; start.current = null;
      if (!s) return;
      const t = event.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? onNext : onPrev)();
    }
  };
}
