// Daily backup of the game database (SQLite), safe while the server is running.
//
// SQLite's `VACUUM INTO` writes a consistent copy of the live database (WAL mode included) into a
// new file; no sqlite3 program is needed (the VPS has none). The copy is checked
// (`PRAGMA integrity_check`) before it replaces nothing: it is written under a temporary name and
// renamed only when it is good. Old backups beyond `--keep` are deleted (newest kept).
//
// The backups hold player emails and the ENCRYPTED player keys, so files are private (0600) in a
// private folder (0700). They are useless without MASTER_KEY, which is never stored next to them.
//
// Usage: node scripts/backup-db.ts [--db PATH] [--dir DIR] [--keep N]
//   defaults: --db $DATABASE_PATH (./data/nearvest.sqlite), --dir $BACKUP_DIR (./data/backups), --keep 14
// On the VPS it runs once a day from deploy/nearvest-backup.timer.

import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NAME = /^nearvest-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?\.sqlite$/;

export interface BackupResult {
  file: string;
  bytes: number;
  players: number;
  removed: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Local time stamp for the file name, e.g. 2026-11-09T03-30-00 (sorts by time). */
export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Backup files in `dir`, newest first. */
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => NAME.test(f))
    .sort()
    .reverse();
}

export function backupDatabase(dbPath: string, dir: string, keep: number, now = new Date()): BackupResult {
  if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number of at least 1');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  // Two backups in the same second (a manual run next to the timer) get -2, -3 ...
  let file = join(dir, `nearvest-${stamp(now)}.sqlite`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `nearvest-${stamp(now)}-${n}.sqlite`);
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });

  const src = new DatabaseSync(dbPath);
  try {
    src.exec('PRAGMA busy_timeout = 10000;');
    src.prepare('VACUUM INTO ?').run(tmp);
  } finally {
    src.close();
  }
  chmodSync(tmp, 0o600);

  // Check the copy before keeping it.
  const copy = new DatabaseSync(tmp, { readOnly: true });
  let players = 0;
  try {
    const check = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') throw new Error(`backup failed the integrity check: ${check.integrity_check}`);
    players = (copy.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  } catch (err) {
    copy.close();
    rmSync(tmp, { force: true });
    throw err;
  }
  copy.close();
  renameSync(tmp, file);

  const removed = listBackups(dir).slice(keep);
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return { file, bytes: statSync(file).size, players, removed };
}

if (import.meta.main) {
  const dbPath = resolve(arg('--db') ?? process.env.DATABASE_PATH ?? './data/nearvest.sqlite');
  const dir = resolve(arg('--dir') ?? process.env.BACKUP_DIR ?? './data/backups');
  const keep = Number(arg('--keep') ?? '14');
  try {
    const r = backupDatabase(dbPath, dir, keep);
    console.log(`backup ok: ${r.file} (${Math.round(r.bytes / 1024)} KB, ${r.players} garden${r.players === 1 ? '' : 's'})${r.removed.length ? `; removed ${r.removed.length} old: ${r.removed.join(', ')}` : ''}`);
  } catch (err) {
    console.error('backup FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
