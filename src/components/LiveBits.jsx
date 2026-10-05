import React, { useEffect, useRef, useState } from "react";
import { shareCard } from "../lib/shareCard.js";

// Small "Share" button; build() returns the share card spec when clicked.
// iconOnly shows just the arrow (label is then only read out by screen readers).
// section: the page section the shared link points to (see shareCard.js).
export function ShareButton({ build, filename, section, label = "Share", iconOnly = false }) {
  const [busy, setBusy] = useState(false);
  const onClick = async event => {
    event.stopPropagation();
    setBusy(true);
    try { await shareCard(build(), filename, section); } finally { setBusy(false); }
  };
  if (iconOnly) {
    return <button type="button" className="share-button icon-only" onClick={onClick} disabled={busy} aria-label={label + " as an image"} title={label}>{busy ? "…" : "⤴"}</button>;
  }
  return <button type="button" className="share-button" onClick={onClick} disabled={busy} aria-label={label + " as an image"}>⤴ {busy ? "…" : label}</button>;
}

export const TeamLogo = ({ src, size = "sm" }) => src ? <img src={src} alt="" className={`inline-team-logo ${size}`} /> : null;

// "updated 42s ago", ticking on its own so the rest of the page doesn't
// re-render every second.
export function UpdatedAgo({ iso }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!iso) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const label = seconds < 60 ? `${seconds}s ago`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago`
    : `${Math.floor(seconds / 86400)}d ago`;
  return <span className="updated-ago">updated {label}</span>;
}

// Team ids whose score changed in the latest update, for a brief highlight.
export function useChangedScores(scores, holdMs = 2500) {
  const previous = useRef(null);
  const timer = useRef(null);
  const [changed, setChanged] = useState(() => new Set());
  useEffect(() => {
    const current = new Map(scores.map(s => [s.teamId, Number(s.score)]));
    const moved = previous.current
      ? [...current].filter(([teamId, score]) => previous.current.has(teamId) && previous.current.get(teamId) !== score).map(([teamId]) => teamId)
      : [];
    previous.current = current;
    if (moved.length) {
      setChanged(new Set(moved));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setChanged(new Set()), holdMs);
    }
  }, [scores, holdMs]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return changed;
}
