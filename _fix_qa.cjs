const fs = require('fs');
const p = __dirname + '/_qa_duel_search.mjs';
let s = fs.readFileSync(p, 'utf8');

const pairs = [
  ["window.selectedGameId = 'block-blast';\n    window.activeStakeChallenge = { id: 'CHLG-T1'",
    "selectedGameId = 'block-blast';\n    activeStakeChallenge = { id: 'CHLG-T1'"],
  ["beginDuelSearch(window.activeStakeChallenge);\n  `);\n  await page.waitForTimeout(250);",
    "beginDuelSearch(activeStakeChallenge);\n  `);\n  await page.waitForTimeout(250);"],
  ["window.selectedGameId = 'block-blast';\n    window.activeStakeChallenge = { id: 'CHLG-T2'",
    "selectedGameId = 'block-blast';\n    activeStakeChallenge = { id: 'CHLG-T2'"],
  ["beginDuelSearch(window.activeStakeChallenge);\n  `);\n  await page.waitForTimeout(400);",
    "beginDuelSearch(activeStakeChallenge);\n  `);\n  await page.waitForTimeout(400);"],
  ["  // ── CASE 1: nobody waiting -> the solo fallback must fire ────────────────",
    "  // ── CASE 1: nobody waiting -> the solo fallback must fire ────────────────\n  // NOTE: these are BARE identifiers, not window.x = ...\n  // The app declares its state with `let` at the top level of a classic script,\n  // which lives in the global *declarative* record. `window.foo = v` instead\n  // creates a separate window property that the app's own bare references never\n  // read, so the stub would look like it worked while the app still saw its\n  // real value (null) and did nothing. A bare assignment reaches the binding."],
];

for (const [a, b] of pairs) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('MISS/AMBIGUOUS (' + n + '):', JSON.stringify(a.slice(0, 50))); process.exit(1); }
  s = s.split(a).join(b);
  console.log('ok:', a.slice(0, 46).replace(/\n/g, ' '));
}
fs.writeFileSync(p, s, 'utf8');