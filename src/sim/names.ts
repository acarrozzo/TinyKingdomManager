/** Villager and animal name generation. Warm, plain, faintly rustic. */

import { RNG } from '../core/util';

const FIRST = [
  'Alder', 'Bram', 'Cordy', 'Dell', 'Esme', 'Fen', 'Gilly', 'Hazel', 'Iver', 'Juniper',
  'Kestrel', 'Linnet', 'Maple', 'Nettle', 'Orrin', 'Pim', 'Quill', 'Rowan', 'Sorrel', 'Tansy',
  'Ulla', 'Vesper', 'Wren', 'Yarrow', 'Bracken', 'Clover', 'Dove', 'Elm', 'Ferro', 'Greta',
  'Hollis', 'Ida', 'Jory', 'Kit', 'Lark', 'Mabel', 'Nim', 'Odd', 'Pell', 'Rue',
  'Silas', 'Thistle', 'Umber', 'Vale', 'Willa', 'Ansel', 'Bede', 'Cass', 'Doune', 'Erle',
  'Fig', 'Gorse', 'Hob', 'Isla', 'Jesper', 'Kell', 'Lowen', 'Merle', 'Norrie', 'Oat',
  'Poppy', 'Quince', 'Reed', 'Saff', 'Tolly', 'Ursa', 'Vane', 'Whin', 'Ash', 'Birk',
];

const LAST = [
  'Applewood', 'Barrow', 'Cobb', 'Dunn', 'Ember', 'Fallow', 'Garrick', 'Hollow', 'Ives', 'Jessop',
  'Kindle', 'Larkspur', 'Mossley', 'Nook', 'Overhill', 'Penny', 'Quarrell', 'Ridge', 'Stott', 'Thrush',
  'Underbough', 'Vetch', 'Wicker', 'Yeatman', 'Brindle', 'Chaff', 'Dimmock', 'Elmsley', 'Furlong', 'Gale',
  'Hearth', 'Idle', 'Juniper', 'Kettle', 'Loam', 'Marrow', 'Nettlebed', 'Orchard', 'Puddle', 'Ryecroft',
  'Sedge', 'Tallow', 'Upton', 'Vellum', 'Weft', 'Bellow', 'Cinder', 'Dray', 'Fernsby', 'Gilder',
];

/** Names used when the player names an animal via the shuffle button. */
const ANIMAL_NAMES = [
  'Biscuit', 'Pippin', 'Sock', 'Marmalade', 'Tuffet', 'Nutmeg', 'Clove', 'Pebble', 'Mitten', 'Dandelion',
  'Barnaby', 'Twig', 'Bramble', 'Wobble', 'Custard', 'Fig', 'Sprout', 'Gus', 'Nibbles', 'Prune',
  'Toast', 'Willow', 'Bandit', 'Cricket', 'Dumpling', 'Ferdinand', 'Hopper', 'Juniper', 'Kettle', 'Lumen',
];

export function makeName(r: RNG, used: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const n = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    if (!used.has(n)) return n;
  }
  return `${r.pick(FIRST)} ${r.pick(LAST)} ${used.size}`;
}

export function makeAnimalName(r: RNG): string {
  return r.pick(ANIMAL_NAMES);
}

/** Small talk. Deliberately mundane. */
export const CHATTER = {
  day: [
    'Nice weather.',
    'Long day.',
    'Back in a moment.',
    'Mind the mud.',
    'That went well.',
    'Almost done.',
    'Morning.',
    'Look at that.',
    'Bit of a walk, this.',
    'Right then.',
    'Something smells good.',
    'Who moved the path?',
  ],
  night: [
    'Getting late.',
    'Quiet tonight.',
    'Just one more thing.',
    'Bed, I think.',
    'Look at the sky.',
    'Cold out.',
  ],
  work: [
    'Steady now.',
    'Nearly there.',
    'This one’s heavy.',
    'Good grain this year.',
    'Sharp axe, that.',
    'Hup.',
  ],
  animal: [
    'Look at that rabbit.',
    'Hello, you.',
    'It’s back again.',
    'Don’t startle it.',
    'That one’s got a nerve.',
  ],
  hungry: ['Could eat.', 'Is there bread?', 'Skipped lunch.'],
  idle: ['Nothing wants doing.', 'I’ll find something.', 'Bit of a lull.'],
};
