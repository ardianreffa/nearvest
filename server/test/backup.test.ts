import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, listBackups } from '../scripts/backup-db.ts';

const root = mkdtempSync(join(tmpdir(), 'nearvest-backup-'));
after(() => rmSync(root, { recursive: true, force: true }));

function liveDb(path: string, players: number): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, secret_key_enc TEXT);');
  const ins = db.prepare('INSERT INTO players (name, secret_key_enc) VALUES (?, ?)');
  for (let i = 0; i < players; i++) ins.run(`p${i}`, 'encrypted');
  return db;
}

describe('database backup', () => {
  it('copies a live (open, WAL) database, checks it and keeps it private', () => {
    const dbPath = join(root, 'live.sqlite');
    const dir = join(root, 'backups-a');
    const server = liveDb(dbPath, 3); // stays open, like the running game server
    server.prepare('INSERT INTO players (name, secret_key_enc) VALUES (?, ?)').run('after-wal', 'x');
    const r = backupDatabase(dbPath, dir, 14, new Date(2026, 10, 9, 3, 30, 0));
    server.close();
    assert.equal(r.players, 4, 'the copy has the rows still in the WAL file too');
    assert.match(r.file, /nearvest-2026-11-09T03-30-00\.sqlite$/);
    assert.equal(statSync(r.file).mode & 0o777, 0o600, 'backup file is private');
    assert.equal(statSync(dir).mode & 0o777, 0o700, 'backup folder is private');
    const copy = new DatabaseSync(r.file, { readOnly: true });
    assert.equal((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    copy.close();
  });

  it('keeps only the newest N backups and ignores other files', () => {
    const dbPath = join(root, 'keep.sqlite');
    const dir = join(root, 'backups-b');
    liveDb(dbPath, 1).close();
    for (let day = 1; day <= 4; day++) backupDatabase(dbPath, dir, 2, new Date(2026, 10, day, 3, 30, 0));
    writeFileSync(join(dir, 'notes.txt'), 'not a backup');
    const left = listBackups(dir);
    assert.deepEqual(left, ['nearvest-2026-11-04T03-30-00.sqlite', 'nearvest-2026-11-03T03-30-00.sqlite']);
    assert.ok(statSync(join(dir, 'notes.txt')).isFile(), 'other files are never deleted');
  });

  it('never overwrites a backup made in the same second', () => {
    const dbPath = join(root, 'same.sqlite');
    const dir = join(root, 'backups-d');
    liveDb(dbPath, 1).close();
    const at = new Date(2026, 10, 9, 3, 30, 0);
    const a = backupDatabase(dbPath, dir, 14, at);
    const b = backupDatabase(dbPath, dir, 14, at);
    assert.notEqual(a.file, b.file);
    assert.equal(listBackups(dir).length, 2);
  });

  it('fails loudly when the database is missing (no empty backup is made)', () => {
    const dir = join(root, 'backups-c');
    assert.throws(() => backupDatabase(join(root, 'missing.sqlite'), dir, 14), /database not found/);
    assert.deepEqual(listBackups(dir), []);
  });
});
