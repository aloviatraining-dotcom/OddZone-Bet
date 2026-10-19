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

// DEFECT 4 — a stale deferred callback could tear down the NEXT duel.
//
// onDuelOpponentFound() schedules closeMatchmakingModal() + launchGameModule()
// 900ms later. Nothing tied that callback to the search that scheduled it, so
// if the player started another duel inside that window (or dismissed the
// screen and immediately opened a new one), the old timer still fired and
// closed the new duel's modal and killed its search. In testing this made a
// fresh search window disappear within a second of opening.
//
// The fix is a token: capture the search object, and in the callback confirm it
// is still the ACTIVE search before touching the screen.
sub('js: guard the deferred launch in onDuelOpponentFound',
    `            // Both sides have to be in the game. A player who was already
            // playing keeps playing; the searching player launches now.
            setTimeout(() => {
                closeMatchmakingModal();
                if (target && selectedGameId !== target.gameId) {
                    selectedGameId = target.gameId;
                    const entry = GAME_CATALOG.find(g => g.id === target.gameId);
                    selectedGameTitle = target.gameTitle || (entry && entry.title) || target.gameId;
                }
                launchGameModule('stake');
            }, 900);`,
    `            // Both sides have to be in the game. A player who was already
            // playing keeps playing; the searching player launches now.
            //
            // The token check is load-bearing. This callback fires 900ms after
            // the pairing, and nothing stopped it from running if the player had
            // already moved on -- starting a new duel, or dismissing this one.
            // Without the check, the stale timer closed the NEW duel's modal
            // and cancelled its search about a second after it opened.
            const token = activeStakeChallenge;
            setTimeout(() => {
                if (activeStakeChallenge !== token || token !== target) return;
                closeMatchmakingModal();
                if (target && selectedGameId !== target.gameId) {
                    selectedGameId = target.gameId;
                    const entry = GAME_CATALOG.find(g => g.id === target.gameId);
                    selectedGameTitle = target.gameTitle || (entry && entry.title) || target.gameId;
                }
                launchGameModule('stake');
            }, 900);`);

// The same hazard in onDuelSearchExpired().
sub('js: guard the deferred launch in onDuelSearchExpired',
    `            setTimeout(() => {
                closeMatchmakingModal();
                launchGameModule('stake');
            }, 800);`,
    `            const token = activeStakeChallenge;
            setTimeout(() => {
                // Same stale-timer guard as onDuelOpponentFound(): if the player
                // cancelled or started something else during these 800ms, this
                // must not close that screen.
                if (activeStakeChallenge !== token) return;
                closeMatchmakingModal();
                launchGameModule('stake');
            }, 800);`);

if (hadCrlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(p, src, 'utf8');