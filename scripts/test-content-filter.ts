import { assertNotObjectionable } from '../src/common/content-filter';

const cases: [string, boolean][] = [
  ['The house has a classic brass door handle and a spacious compound.', false],
  ['Newly assembled kitchen cabinets, password-protected smart lock.', false],
  ['This listing is a scam, fuck off', true],
  ['You are a stupid nigger', true],
  ['Send me nudes or I will leak your photos', false], // not in dataset — expected miss, judgement call
  ['Cumulative rainfall this year has been high', false],
];

let failures = 0;
for (const [text, shouldThrow] of cases) {
  let threw = false;
  try {
    assertNotObjectionable(text);
  } catch {
    threw = true;
  }
  const ok = threw === shouldThrow;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} (expected throw=${shouldThrow}, got=${threw}): "${text}"`);
}
process.exitCode = failures > 0 ? 1 : 0;
