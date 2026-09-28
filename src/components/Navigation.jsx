import React, { useEffect, useState } from "react";
import { TABS } from "../lib/tabs.js";

// Tab bar: pinned under the header on wide screens, fixed to the bottom of the
// screen on phones (like an app).
export function TabBar({ tab, onSelect }) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map(t => (
        <button key={t.id} type="button" className={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
          <span aria-hidden="true">{t.icon}</span>
          <small>{t.label}</small>
        </button>
      ))}
    </nav>
  );
}

// "Back to top", shown once you've scrolled a good way down.
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 900);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return <button type="button" className="back-to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>↑</button>;
}
