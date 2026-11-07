// DEV ONLY: sets the XP of a garden in the LOCAL server database (no blockchain transaction),
// to watch TaniBot's evolution moment while the game is open in the browser.
// Refuses Google and wallet gardens: only dev-login gardens can be changed.
// Usage: node tools/dev-xp.mjs <gardenName> <xp>   (Farmhand 50, Farmer 200, Orchard Master 600, Durian King 1500, Legend 4000)
import { DatabaseSync } from 'node:sqlite';

const [name, xpArg] = process.argv.slice(2);
const xp = Number(xpArg);
if (!name || !Number.isInteger(xp) || xp < 0) {
  console.log('Usage: node tools/dev-xp.mjs <gardenName> <xp>');
  process.exit(1);
}
const db = new DatabaseSync(new URL('../server/data/nearvest.sqlite', import.meta.url).pathname);
const row = db.prepare('SELECT p.id, p.xp, u.provider FROM players p JOIN users u ON u.id = p.user_id WHERE p.name = ?').get(name);
if (!row) {
  console.log(`No garden named ${name}.`);
  process.exit(1);
}
if (row.provider !== 'dev') {
  console.log(`${name} is a ${row.provider} garden: only dev-login gardens can be changed with this tool.`);
  process.exit(1);
}
db.prepare('UPDATE players SET xp = ? WHERE id = ?').run(xp, row.id);
console.log(`${name}: XP ${row.xp} -> ${xp}. The open game picks it up within a few seconds.`);
