import React, { useEffect, useRef } from "react";

// A sheet over the page: slides up from the bottom on phones, a centered
// panel on wider screens. Closes with ✕, Esc or a tap outside. With onPrev /
// onNext it pages through items with ‹ › buttons, the arrow keys, or a
// left/right swipe (a swipe that starts on a chart is left to the chart).
const SWIPE_MIN_PX = 60;

export default function Sheet({ title, onClose, onPrev, onNext, position, children }) {
  const panel = useRef(null);
  const touch = useRef(null);
  // Latest handlers, so the setup below runs once per opening (live data
  // re-renders the page every few seconds).
  const handlers = useRef({});
  handlers.current = { onClose, onPrev, onNext };
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = event => {
      const h = handlers.current;
      if (event.key === "Escape") h.onClose();
      else if (event.key === "ArrowLeft" && h.onPrev) h.onPrev();
      else if (event.key === "ArrowRight" && h.onNext) h.onNext();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, []);

  const onTouchStart = event => {
    const t = event.touches[0];
    touch.current = event.target.closest?.(".swing-plot, .chop-plot") ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = event => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && onNext) onNext();
    if (dx > 0 && onPrev) onPrev();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}
        onClick={event => event.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="sheet-bar">
          {onPrev ? <button type="button" className="sheet-nav" onClick={onPrev} aria-label="Previous">‹</button> : <span />}
          <div className="sheet-title"><b>{title}</b>{position ? <small>{position}</small> : null}</div>
          {onNext ? <button type="button" className="sheet-nav" onClick={onNext} aria-label="Next">›</button> : <span />}
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
