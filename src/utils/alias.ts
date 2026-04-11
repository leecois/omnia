/**
 * Deterministically generates a friendly [Adjective][Noun] alias from an
 * identity hex string — the same hex always produces the same name.
 */

const ADJECTIVES = [
  'Ancient', 'Blazing', 'Bold', 'Brave', 'Bright', 'Calm', 'Clever',
  'Cosmic', 'Crimson', 'Cunning', 'Daring', 'Dark', 'Dawn', 'Deep',
  'Eager', 'Elusive', 'Fancy', 'Fierce', 'Frosty', 'Fuzzy', 'Gentle',
  'Golden', 'Grand', 'Happy', 'Hidden', 'Jade', 'Jolly', 'Keen',
  'Kind', 'Lively', 'Lucky', 'Lunar', 'Mellow', 'Mighty', 'Misty',
  'Nimble', 'Noble', 'Odd', 'Orange', 'Peaceful', 'Playful', 'Proud',
  'Quiet', 'Rapid', 'Rogue', 'Royal', 'Rusty', 'Shadowy', 'Silver',
  'Sleek', 'Snappy', 'Solar', 'Speedy', 'Stealthy', 'Steel', 'Storm',
  'Swift', 'Teal', 'Tiny', 'Turbo', 'Twilight', 'Vivid', 'Wily',
  'Winter', 'Wise', 'Zesty',
];

const NOUNS = [
  'Badger', 'Bear', 'Bison', 'Cobra', 'Condor', 'Cougar', 'Crane',
  'Crow', 'Deer', 'Dingo', 'Dragon', 'Eagle', 'Falcon', 'Ferret',
  'Fox', 'Gecko', 'Hawk', 'Heron', 'Hyena', 'Ibis', 'Jaguar',
  'Koala', 'Lemur', 'Leopard', 'Liger', 'Lion', 'Lizard', 'Lynx',
  'Marten', 'Moose', 'Narwhal', 'Newt', 'Orca', 'Osprey', 'Otter',
  'Owl', 'Panda', 'Panther', 'Parrot', 'Phoenix', 'Puffin', 'Raven',
  'Robin', 'Salamander', 'Seal', 'Shark', 'Sloth', 'Snipe', 'Squid',
  'Stag', 'Swan', 'Tiger', 'Toucan', 'Viper', 'Walrus', 'Weasel',
  'Wolf', 'Wolverine', 'Wombat', 'Yak', 'Zebra',
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0; // unsigned 32-bit
}

export function generateAlias(hex: string): string {
  const a = djb2(hex.slice(0, hex.length / 2)) % ADJECTIVES.length;
  const n = djb2(hex.slice(hex.length / 2)) % NOUNS.length;
  return ADJECTIVES[a] + NOUNS[n];
}
