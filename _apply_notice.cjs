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

sub('js: add showOpponentFoundNotice',
    `        // Look up an opponent's display name and avatar.`,
    `        // A player who was ALREADY waiting (their row was 'queued' with a
        // banked score) gets paired by someone else arriving in the search
        // window. They never ran a search themselves, so beginDuelSearch() and
        // its timer are not involved -- but they still need to be told, and the
        // game they are in must not be torn down mid-run.
        function showOpponentFoundNotice(row) {
            const challenge = activeStakeChallenge;
            if (challenge) {
                challenge.opponentId = row.opponent_id || null;
                challenge.opponentName = row.opponent_name || 'Opponent';
            }
            // Surface it in the arena without interrupting play. The result
            // card is reserved for a settled duel; this is just the pairing.
            if (typeof addInAppNotification === 'function') {
                addInAppNotification(
                    'Opponent found!',
                    (row.opponent_name || 'An opponent') + ' accepted your challenge. Play on - the winner is decided when you finish.',
                    'info'
                );
            }
        }

        // Look up an opponent's display name and avatar.`);

if (hadCrlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(p, src, 'utf8');