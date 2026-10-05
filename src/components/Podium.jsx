import React from "react";

// Olympic-style podium: 1st in the middle, 2nd left, 3rd right. Step heights
// are proportional to each entry's value (odds) relative to the leader's,
// with a minimum so a long shot still gets a visible step.
// items: [{ key, logo, name, value, label, sub, icon }], best first.
// variant: "medal" (ticket race) or "tomb" (Death Watch: stone tombstones).
const MIN_STEP = 34;
const MAX_STEP = 112;

export default function Podium({ items, variant = "medal", ariaLabel }) {
  const top = items.slice(0, 3);
  if (!top.length) return null;
  const lead = Math.max(...top.map(x => Number(x.value) || 0));
  const height = x => Math.round(MIN_STEP + (MAX_STEP - MIN_STEP) * (lead > 0 ? Math.max(0, Number(x.value) || 0) / lead : 0));
  // Center the leader: [2nd, 1st, 3rd] (or [2nd, 1st] / [1st]).
  const ordered = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : [top[0]];
  return (
    <div className={`podium podium-${variant} podium-count-${top.length}`} role="list" aria-label={ariaLabel}>
      {ordered.map(x => <div className={"podium-spot" + (x === top[0] ? " first" : "")} role="listitem" key={x.key}>
        <div className="podium-team">
          {x.logo}
          <b>{x.name}</b>
          <em>{x.label}</em>
          {x.sub ? <small>{x.sub}</small> : null}
        </div>
        <div className="podium-step" style={{ height: height(x) }}><span>{x.icon}</span></div>
      </div>)}
    </div>
  );
}
