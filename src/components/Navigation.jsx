import React, { useEffect, useRef, useState } from "react";

// Publishes a pinned (position: sticky) element's height as a CSS variable on
// <html>, or 0px when it isn't pinned at this screen size or is gone, so
// pinned pieces can stack under it and section jumps clear them.
export function usePinnedHeight(ref, variable) {
  useEffect(() => {
    const root = document.documentElement.style;
    const el = ref.current;
    if (!el) return;
    const update = () => root.setProperty(variable, (getComputedStyle(el).position === "sticky" ? el.offsetHeight : 0) + "px");
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); root.setProperty(variable, "0px"); };
  });
}

// How far down the pinned strips reach (section strip + League Wire).
const pinnedBottom = () => {
  const style = getComputedStyle(document.documentElement);
  return (parseFloat(style.getPropertyValue("--section-nav-h")) || 0) + (parseFloat(style.getPropertyValue("--wire-h")) || 0);
};
import { TAB_SECTIONS, TABS } from "../lib/tabs.js";

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

// Phones: a strip pinned to the top with a chip per section in the current
// tab. Tapping jumps there; the chip for the section you're reading lights up.
export function SectionNav({ tab }) {
  const [present, setPresent] = useState([]);
  const [active, setActive] = useState(null);
  const strip = useRef(null);

  useEffect(() => {
    // Only offer sections that are on the page (e.g. RIP once someone's chopped).
    const sections = (TAB_SECTIONS[tab] || []).filter(([id]) => document.getElementById(id));
    setPresent(sections);
    if (!sections.length) return;
    const onScroll = () => {
      let current = sections[0][0];
      for (const [id] of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= pinnedBottom() + 40) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [tab]);

  useEffect(() => {
    const chip = strip.current?.querySelector("button.active");
    if (chip && strip.current) strip.current.scrollTo({ left: chip.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  usePinnedHeight(strip, "--section-nav-h");

  if (!present.length) return null;
  const go = id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <nav className="section-nav" aria-label="Sections in this tab" ref={strip}>
      {present.map(([id, label]) => <button key={id} type="button" className={active === id ? "active" : ""} onClick={() => go(id)}>{label}</button>)}
    </nav>
  );
}

