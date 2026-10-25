// Letter grades on a curve (report cards). A score is a 0-100 percentile
// within the league: the best team is 100, the worst 0, ties share.
export function percentiles(values) {
  const n = values.length;
  if (n < 2) return values.map(() => 50);
  return values.map(v => {
    const below = values.filter(x => x < v).length, equal = values.filter(x => x === v).length - 1;
    return (below + equal / 2) / (n - 1) * 100;
  });
}

// A league of 12 on a curve: roughly the top two get A's, the bottom two D's
// or an F.
const SCALE = [[93, "A+"], [85, "A"], [77, "A-"], [69, "B+"], [61, "B"], [53, "B-"], [45, "C+"], [37, "C"], [29, "C-"], [21, "D+"], [13, "D"], [6, "D-"]];
export function letter(score) {
  if (!Number.isFinite(score)) return null;
  return (SCALE.find(([min]) => score >= min) || [0, "F"])[1];
}
