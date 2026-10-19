const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Probe which columns actually exist by selecting them one at a time.
// A 400 "column does not exist" is the signal.
async function cols(table, names) {
  const found = [], missing = [];
  for (const n of names) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${n}&limit=1`, { headers: H });
    if (r.ok) found.push(n);
    else {
      const t = await r.text();
      if (/column .* does not exist|PGRST204/i.test(t)) missing.push(n);
      else found.push(n + '?');
    }
  }
  return { found, missing };
}

const p = await cols('profiles', [
  'id', 'username', 'name', 'avatar_url', 'email', 'wallet_balance',
  'is_verified', 'kyc_type', 'created_at', 'display_name', 'full_name'
]);
console.log('profiles FOUND  :', p.found.join(', '));
console.log('profiles MISSING:', p.missing.join(', '));

const s = await cols('stake_challenges', [
  'id', 'user_id', 'game_id', 'stake', 'payout', 'score', 'status',
  'opponent_id', 'winner_id', 'refund_amount', 'created_at',
  'is_solo', 'opponent_name', 'opponent_avatar',
  'opponent_score', 'my_score', 'my_challenge_id', 'settled_at'
]);
console.log('\nstake_challenges FOUND  :', s.found.join(', '));
console.log('stake_challenges MISSING:', s.missing.join(', '));

// What other duel functions does the live DB expose? Ask for each.
console.log('\n-- function probe (auth-gated error = exists)');
for (const fn of ['tie_duel', 'forfeit_duel', 'claim_duel_opponent', 'begin_solo_play',
  'settle_duel', 'cancel_duel', 'open_duel', 'wallet_balance',
  'record_deposit']) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}'
  });
  const t = await r.text();
  let m = t;
  try { m = JSON.parse(t).message || t; } catch { }
  const exists = !/schema cache|Could not find the function|PGRST202/i.test(m);
  console.log(`  ${exists ? 'EXISTS ' : 'ABSENT '} ${fn.padEnd(22)} ${String(m).slice(0, 70)}`);
}