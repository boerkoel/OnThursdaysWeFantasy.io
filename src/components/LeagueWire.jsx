import React, { useEffect, useRef, useState } from "react";
import { usePinnedHeight } from "./Navigation.jsx";
import { ShareButton } from "./LiveBits.jsx";

const AUTO_ADVANCE_MS = 6000;
// After you tap or swipe, give the story you picked a bit longer.
const AFTER_TAP_MS = 12000;
const SWIPE_PX = 40;

// Rotating live stories. Every story is rendered in the same grid cell and
// only the active one is visible, so the box keeps the height of the longest
// story instead of resizing as they rotate. On phones it's pinned under the
// section strip; tap the right side (or swipe left) for the next story, the
// left side (or swipe right) for the previous one.
export default function LeagueWire({ stories, status, week }) {
  const [index, setIndex] = useState(0);
  const [tapped, setTapped] = useState(false);
  const box = useRef(null);
  const pointer = useRef(null);
  usePinnedHeight(box, "--wire-h");

  useEffect(() => {
    if (stories.length < 2) return;
    const timer = setTimeout(() => { setTapped(false); setIndex(i => (i + 1) % stories.length); }, tapped ? AFTER_TAP_MS : AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [stories.length, index, tapped]);

  if (!stories.length) return null;
  const active = index % stories.length;
  const story = stories[active];
  const show = i => { setTapped(true); setIndex((i + stories.length) % stories.length); };

  const onPointerDown = event => { pointer.current = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = event => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || stories.length < 2) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
      show(active + (dx < 0 ? 1 : -1));
      return;
    }
    const { left, width } = event.currentTarget.getBoundingClientRect();
    show(active + (event.clientX - left < width / 3 ? -1 : 1));
  };
  const onKeyDown = event => {
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") { event.preventDefault(); show(active + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); show(active - 1); }
  };

  return (
    <section className="league-marquee" aria-label="League Wire" ref={box}>
      <div className="marquee-label"><span>⚡</span><strong>LEAGUE WIRE</strong><small className={status === "LIVE" ? "is-live" : ""}>{status}</small></div>
      <div className="marquee-stack" aria-live="polite" role={stories.length > 1 ? "button" : undefined} tabIndex={stories.length > 1 ? 0 : undefined}
        aria-label={stories.length > 1 ? `Story ${active + 1} of ${stories.length}. Tap for the next story.` : undefined}
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointer.current = null; }} onKeyDown={onKeyDown}>
        {stories.map((story, i) => (
          <div className={i === active ? "marquee-story active" : "marquee-story"} aria-hidden={i !== active} key={story.type + story.text}>
            <b>{story.type}</b>
            <span>{story.text}</span>
          </div>
        ))}
      </div>
      <div className="marquee-dots">
        {stories.length > 1 ? <small className="marquee-count">{active + 1}/{stories.length}</small> : null}
        {stories.map((story, i) => <button key={i} type="button" className={i === active ? "active" : ""} aria-label={"Show " + story.type} onClick={() => show(i)}></button>)}
        <ShareButton iconOnly label="Share this story" filename={`league-wire-week-${week}-${story.type}`.replace(/[^\w-]+/g, "-").toLowerCase()} build={() => ({
          kicker: `League Wire · Week ${week}`,
          title: story.type,
          lines: [{ text: story.text, size: 38, weight: 700 }]
        })} />
      </div>
    </section>
  );
}
