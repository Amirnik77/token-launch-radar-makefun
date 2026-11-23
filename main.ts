// Token Launch Radar: the entry program (Node 22, standard library only).
//
// It reads the sealed DefiLlama snapshot, scores every protocol that records no token yet with the
// peer-multiple model in lib/model.ts, and writes the handover the scorer reads:
//   board.json    the ranked board: watchlist covered, early protocols below the floor added
//   data.js       the same board as one script, which dashboard/index.html renders with no network
//   dashboard/    the static page, copied from this repository
//   screenshots/  captures of the page, copied from this repository
//   dossier.json  the judge's summary, written by buildDossier from vendor/makefun-board.ts
//
// Input resolves flexibly: --input <file|dir> wins, then /input/snapshot.json (the grader's mount),
// then an input/ directory beside this program. Output goes to --output, else $MAKEFUN_OUTPUT_DIR,
// else /output. Two runs over the same snapshot write the same bytes: the model reads nothing but
// the snapshot and sorts every tie by slug.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps, restated so the program refuses before the gate has to. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot file: an explicit --input, the grader's /input, or a local input/ directory. */
function inputFile(): string {
  const explicit = arg('input', '');
  if (explicit !== '') return explicit.endsWith('.json') ? explicit : join(explicit, 'snapshot.json');
  if (existsSync('/input/snapshot.json')) return '/input/snapshot.json';
  return join(here, 'input', 'snapshot.json');
}

const input = inputFile();
if (!existsSync(input)) {
  process.stderr.write(`token radar: no snapshot at ${input}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${radar.pre_token_protocols} record no token, ${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: board of ${board.length} rows (${radar.early_size} early below the floor), combined implied value $${radar.board_implied_total.toLocaleString('en-US')}\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
