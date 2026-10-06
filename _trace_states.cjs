// PostgREST cannot express "call this then that", so this walks the state
// machine my claim_duel_opponent() creates and checks each step against what
// settle_duel() accepts. Purely a logic trace, no network.
const S = require('path') && null;

// claim_duel_opponent (as I wrote it):
//   no opponent -> status='queued'
//   opponent     -> BOTH rows status='matched', winner_id untouched (null)
const afterClaimMatched = { status: 'matched', winner_id: null, opponent_id: 'OPP' };

// finishTimedMatch() then calls settle_duel(my_id, score).
// settle_duel begins with:
const settleGuard = (row) => {
  if (row.status === 'matched') return "RAISES: 'This duel has already been settled.'";
  if (row.status === 'cancelled') return "RAISES: 'This duel was cancelled.'";
  return 'proceeds';
};

console.log('=== pre-matchmaking: searcher claims an opponent ===');
console.log('row after claim :', JSON.stringify(afterClaimMatched));
console.log('settle_duel()   :', settleGuard(afterClaimMatched));
console.log('=> the winner is never paid. Both stakes stay debited forever.\n');

console.log('=== searcher finds nobody (falls through to solo) ===');
console.log('row after claim : status=solo, then begin_solo_play -> solo');
const solo = { status: 'solo', winner_id: null, opponent_id: null };
console.log('settle_duel()   :', settleGuard(solo), '(queues + matches later — OK)');

console.log('\n=== an opponent who was ACCEPTED from the board, not searching ===');
// That player's row is 'playing' (open_duel) and they were never claimed.
const accepted = { status: 'playing', winner_id: null, opponent_id: null };
console.log('settle_duel()   :', settleGuard(accepted), '(searches for opponent — OK)');