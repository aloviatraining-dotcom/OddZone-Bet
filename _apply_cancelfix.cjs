const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'index.html');
let src = fs.readFileSync(p, 'utf8');
const hadCrlf = src.includes('\r\n');
if (hadCrlf) src = src.replace(/\r\n/g, '\n');

function sub(label, a, b) {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error('MISS/AMBIGUOUS (' + n + '):', label); process.exit(1); }
  src = src.split(a).join(b);
  console.log('ok:', label);
}

// Once a match is claimed the duel can no longer be cancelled (cancel_duel()
// refuses a 'matched' row), so offering the button only sets up a dead end.
sub('js: hide cancel button on match found',
  `            showSearchBar(false);
            setSearchProgress(1);
            showOpponentCard({`,
  `            showSearchBar(false);
            setSearchProgress(1);
            // A matched duel can no longer be cancelled -- cancel_duel()
            // refuses a 'matched' row and credits nothing -- so hide the
            // refund button rather than offering a dead end.
            const cancelBtn = document.getElementById('matchmaking-cancel-btn');
            if (cancelBtn) cancelBtn.classList.add('hidden');
            showOpponentCard({`);

if (hadCrlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(p, src, 'utf8');