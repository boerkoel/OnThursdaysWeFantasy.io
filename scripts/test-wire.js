// Replays the League Wire against a captured snapshot and prints its stories.
//
//   node scripts/test-wire.js <snapshot-dir> [--compare]
//
// A snapshot is what a live run saved with "capture_snapshot" (the League
// Wire's inputs plus expected-marquee.json, its output then): download it
// with `gh run download <run id> -n wire-snapshot-<run id> -D <dir>`.
// The run happens in a scratch copy (nothing in the snapshot or data/current
// changes) at the time the snapshot was captured, so time windows behave as
// they did live. --compare lists stories that differ from that run's output,
// which is the check that a refactor didn't change anything. To try a story
// against a made-up situation, edit the files in a copy of the snapshot.
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: node scripts/test-wire.js <snapshot-dir> [--compare]");
  process.exit(2);
}
const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const work = await mkdtemp(join(tmpdir(), "wire-"));
await cp(dir, work, { recursive: true });
const capture = await readJson(join(dir, "capture.json")).catch(() => ({}));

const run = spawnSync(process.execPath, ["scripts/league-wire.js"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    WIRE_DATA_DIR: work,
    WIRE_OUT_DIR: work,
    WIRE_NOW: String(capture.capturedAt || ""),
    PREVIOUS_SCOREBOARD_PATH: join(work, "previous-scoreboard.json")
  }
});
if (run.status !== 0) {
  await rm(work, { recursive: true, force: true });
  process.exit(run.status || 1);
}

const stories = (await readJson(join(work, "marquee.json"))).stories || [];
console.log(`\n${stories.length} stories${capture.capturedAt ? ` (as of ${new Date(capture.capturedAt).toLocaleString()})` : ""}:`);
for (const s of stories) console.log(`- [${s.type}] ${s.text}`);

if (flags.includes("--compare")) {
  const expected = (await readJson(join(dir, "expected-marquee.json")).catch(() => ({ stories: [] }))).stories || [];
  const key = s => s.type + " | " + s.text;
  const got = new Set(stories.map(key)), want = new Set(expected.map(key));
  const missing = [...want].filter(k => !got.has(k)), extra = [...got].filter(k => !want.has(k));
  console.log(`\nCompared with the captured run: ${missing.length} missing, ${extra.length} new.`);
  for (const k of missing) console.log("  - missing: " + k);
  for (const k of extra) console.log("  + new:     " + k);
  await rm(work, { recursive: true, force: true });
  process.exit(missing.length || extra.length ? 1 : 0);
}
await rm(work, { recursive: true, force: true });
