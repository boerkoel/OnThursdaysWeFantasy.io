import React, { useEffect, useState } from "react";

// Rotating live stories. Every story is rendered in the same grid cell and
// only the active one is visible, so the box keeps the height of the longest
// story instead of resizing as they rotate.
export default function LeagueWire({ stories, status }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (stories.length < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % stories.length), 6000);
    return () => clearInterval(timer);
  }, [stories.length]);
  if (!stories.length) return null;
  const active = index % stories.length;

  return (
    <section className="league-marquee" aria-label="League Wire">
      <div className="marquee-label"><span>⚡</span><strong>LEAGUE WIRE</strong><small className={status === "LIVE" ? "is-live" : ""}>{status}</small></div>
      <div className="marquee-stack" aria-live="polite">
        {stories.map((story, i) => (
          <div className={i === active ? "marquee-story active" : "marquee-story"} aria-hidden={i !== active} key={story.type + story.text}>
            <b>{story.type}</b>
            <span>{story.text}</span>
          </div>
        ))}
      </div>
      <div className="marquee-dots">
        {stories.map((story, i) => <button key={i} type="button" className={i === active ? "active" : ""} aria-label={"Show " + story.type} onClick={() => setIndex(i)}></button>)}
      </div>
    </section>
  );
}
