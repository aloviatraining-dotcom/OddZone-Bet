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

// claim_duel_opponent() returns status='paired'. The old branch only handled
// matched:true vs matched:false, so a paired opponent fell into the
// "matched:false" case and the UI told the player they were still searching
// for someone, while the database had already locked in an opponent.
sub('js: handle paired settlement',
    `                    if (settled && settled.matched) {
                        if (mm) mm.classList.add('hidden');
                        `,
    `                    if (settled && settled.matched) {
                        if (mm) mm.classList.add('hidden');

                        // The opponent identity arrives in the settle response
                        // too, so the card does not depend on a profiles read.
                        `);

// The "still searching" copy must not be shown when an opponent is already
// locked in and we are simply waiting on THEIR score.
sub('js: paired waiting copy',
    `                    } else if (settled) {
                        // No opponent yet — stay queued and wait for realtime.
                        if (subEl) subEl.textContent = \`Your score: \${score.toLocaleString()} pts. Looking for another player at ₦\${challenge.stake.toLocaleString()}… Match stays active in background!\`;
                    }`,
    `                    } else if (settled) {
                        // No opponent yet — stay queued and wait for realtime.
                        //
                        // When the pairing already happened, this player is not
                        // searching any more: their opponent simply has not
                        // finished yet. Saying "looking for another player"
                        // here would send them back to the matchmaking board to
                        // queue a second time while a real opponent is already
                        // assigned.
                        const paired = Boolean(settled.opponent_id || challenge.opponentId);
                        if (subEl) {
                            subEl.textContent = paired
                                ? \`Your score: \${score.toLocaleString()} pts. Waiting for your opponent to finish…\`
                                : \`Your score: \${score.toLocaleString()} pts. Looking for another player at ₦\${challenge.stake.toLocaleString()}...\`;
                        }
                        if (titleEl) {
                            titleEl.textContent = paired
                                ? 'Waiting for Opponent'
                                : (wasSolo ? 'Score Banked' : 'Searching for Opponent...');
                        }
                    }`);

if (hadCrlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(p, src, 'utf8');