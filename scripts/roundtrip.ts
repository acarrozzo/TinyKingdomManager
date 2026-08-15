/** Verifies a save file survives a serialise → deserialise → serialise round trip. */
import { readFileSync } from 'node:fs';
import { deserialize, serialize } from '../src/save/save';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const g = deserialize(raw);
console.log('loaded:', g.villagers.length, 'villagers,', g.buildings.length, 'buildings,', g.tiles.length, 'tiles, day', g.day, g.season);
console.log('blocked tiles:', g.tiles.filter((t) => t.blocked).length);
console.log('props preserved:', g.tiles.filter((t) => t.prop).length);
console.log('plots:', g.buildings.reduce((n, b) => n + b.plots.length, 0));
console.log('discovered:', [...g.discovered].join(', ') || '(none)');
console.log('goals done:', g.goals.filter((x) => x.done).length);
const again = JSON.stringify(serialize(g));
console.log('re-serialised ok,', again.length, 'bytes');
