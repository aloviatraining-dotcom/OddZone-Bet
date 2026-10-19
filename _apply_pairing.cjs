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

// ── 1. Opponent profile reads move to public_profiles ───────────────────────
sub('js: fetchOpponentProfile reads public_profiles',
    `        // Look up an opponent's display name and avatar.
        async function fetchOpponentProfile(opponentId) {
            const fallback = { name: 'Opponent', avatar: '' };
            if (!opponentId) return fallback;
            const client = getSupabaseAuthClient();
            if (!client) return fallback;
            try {
                const { data, error } = await client
                    .from('profiles')
                    .select('username, avatar_url')
                    .eq('id', opponentId)
                    .maybeSingle();`,
    `        // Look up an opponent's display name and avatar.
        //
        // public_profiles, NOT profiles. profiles has an owner-only read policy
        // for a reason -- it also holds wallet_balance, email and the KYC
        // fields, so a cross-player read of it would be a data leak.
        // public_profiles carries exactly username + avatar_url and is the one
        // table that is world-readable on purpose.
        async function fetchOpponentProfile(opponentId) {
            const fallback = { name: 'Opponent', avatar: '' };
            if (!opponentId) return fallback;
            const client = getSupabaseAuthClient();
            if (!client) return fallback;
            try {
                const { data, error } = await client
                    .from('public_profiles')
                    .select('username, avatar_url')
                    .eq('user_id', opponentId)
                    .maybeSingle();`);

// ── 2. Pairing is not settlement: react to opponent_id, not status ─────────
// claim_duel_opponent() now records the pairing by writing opponent_id on both
// rows while LEAVING status='queued', because settle_duel() refuses a row that
// is already 'matched'. The waiting player therefore never sees status flip to
// 'matched' at pairing time, so the old status-only test never fired and they
// sat on the search screen forever. The pairing signal is opponent_id.
sub('js: react to pairing via opponent_id',
    `        async function handleDuelRowUpdate(row) {
            if (!row || !activeUser || !activeUser.id) return;
            const me = activeUser.id;
            const isMine = row.user_id === me;
            if (!isMine && row.opponent_id !== me) return;

            // I was searching and my row just flipped to 'matched'.
            if (isMine && row.status === 'matched' && activeDuelSearch && !activeDuelSearch.resolved) {
                onDuelOpponentFound({
                    opponent_id: row.opponent_id,
                    opponent_name: row.opponent_name,
                    opponent_avatar: row.opponent_avatar
                }, activeStakeChallenge);
                return;
            }`,
    `        async function handleDuelRowUpdate(row) {
            if (!row || !activeUser || !activeUser.id) return;
            const me = activeUser.id;
            const isMine = row.user_id === me;
            if (!isMine && row.opponent_id !== me) return;

            // I was searching and my row has just been PAIRED.
            //
            // The signal is opponent_id being set, NOT status. Pairing
            // deliberately leaves both rows on 'queued' -- settle_duel() opens
            // with "if status='matched' then raise 'already settled'", so
            // flipping the status here would close the payout path before
            // either player had finished their game.
            if (isMine && row.opponent_id && activeDuelSearch && !activeDuelSearch.resolved) {
                onDuelOpponentFound({
                    opponent_id: row.opponent_id,
                    opponent_name: row.opponent_name,
                    opponent_avatar: row.opponent_avatar
                }, activeStakeChallenge);
                return;
            }

            // The player who was ALREADY waiting gets paired by someone else
            // arriving. They were not searching, so activeDuelSearch is null
            // and the branch above cannot fire -- but they still need to know.
            if (!isMine && row.opponent_id === me
                && row.status !== 'matched' && row.status !== 'cancelled'
                && typeof showOpponentFoundNotice === 'function') {
                showOpponentFoundNotice(row);
                return;
            }`);

// ── 3. Deferred-duel resolution: status is still the settlement signal ─────
// This stays keyed on status='matched' because that IS settlement here --
// settle_duel() is the only thing that writes it.
sub('js: deferred duel still keyed on matched',
    `                const pending = activeStakeChallenge;
                const isMyOpponent = row.opponent_id === me;
                if (pending && !isMine && isMyOpponent
                    && pending.gameId === row.game_id
                    && Number(pending.stake) === Number(row.stake)) {`,
    `                const pending = activeStakeChallenge;
                const isMyOpponent = row.opponent_id === me;
                if (pending && !isMine && isMyOpponent
                    && pending.gameId === row.game_id
                    && Number(pending.stake) === Number(row.stake)) {`);

if (hadCrlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(p, src, 'utf8');