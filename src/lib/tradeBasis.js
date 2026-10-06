// How a win-win trade was judged (calculate-stats.js: basis), in words.
// lineup: "optimal" (best lineup in hindsight) or "projected" (the lineup a
// manager would set from ESPN's weekly projections); window: "season" or
// "last N weeks".
export const basisLineup = (basis, whose = "their") =>
  basis?.lineup === "projected" ? `${whose} projection-set lineups` : `${whose} optimal lineups`;
export const basisWindow = basis => basis?.window && basis.window !== "season" ? ` over the ${basis.window}` : "";
export const basisTag = basis => [basis?.lineup === "projected" ? "by projections" : "optimal lineups", basis?.window && basis.window !== "season" ? basis.window : "season"].join(" · ");
