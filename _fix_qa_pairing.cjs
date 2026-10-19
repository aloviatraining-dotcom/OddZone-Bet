const fs = require('fs');
const p = __dirname + '/_qa_pairing.mjs';
let s = fs.readFileSync(p, 'utf8');

// page.evaluate() runs in an isolated world and cannot read the app's `let`
// bindings. Every assertion must therefore be computed by an INJECTED script
// (main world) and published as a DOM attribute, which evaluate() CAN read.
const pairs = [
  // helper
  [`  const inject = (code) => page.evaluate((src) => {
    const el = document.createElement('script');
    el.textContent = src; document.body.appendChild(el); el.remove();
  }, code);`,
    `  const inject = (code) => page.evaluate((src) => {
    const el = document.createElement('script');
    el.textContent = src; document.body.appendChild(el); el.remove();
  }, code);

  // Run an expression in the MAIN world and read the result back out of the DOM.
  const mainEval = (expr) => page.evaluate((e) => {
    const el = document.createElement('script');
    el.textContent = 'document.documentElement.setAttribute("data-r", JSON.stringify((' + e + ')))';
    document.body.appendChild(el); el.remove();
    return document.documentElement.getAttribute('data-r');
  }, expr).then(r => JSON.parse(r === null ? 'null' : r));`],
];

for (const [a, b] of pairs) {
  if (s.split(a).length - 1 !== 1) { console.error('MISS helper'); process.exit(1); }
  s = s.split(a).join(b);
}

// Replace every `out.X = await page.evaluate(() => ({ ... }));` block with a
// mainEval form.
const re = /out\.(\w+) = await page\.evaluate\(\(\) => \(\{([\s\S]*?)\}\)\);/g;
let count = 0;
s = s.replace(re, (_m, name, body) => {
  count++;
  return `out.${name} = await mainEval(\`(() => { return {${body}} })()\`);`;
});
console.log('converted', count, 'assertion blocks to mainEval');
fs.writeFileSync(p, s, 'utf8');