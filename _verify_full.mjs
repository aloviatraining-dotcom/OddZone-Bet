const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Call each RPC with its CORRECT argument shape. Calling with {} produces
// PGRST202 even when the function exists, because PostgREST cannot resolve a
// signature with no arguments -- so the previous probe was not conclusive.
const CALLS = [
  ['claim_duel_opponent', { p_challenge_id: '00000000-0000-0000-0000-000000000000' }],
  ['begin_solo_play', { p_challenge_id: '00000000-0000-0000-0000-000000000000' }],
  ['settle_duel', { p_challenge_id: '00000000-0000-0000-0000-000000000000', p_score: 1 }],
  ['cancel_duel', { p_challenge_id: '00000000-0000-0000-0000-000000000000' }],
  ['open_duel', { p_game_id: 'x', p_stake: 200, p_payout: 360 }],
  ['wallet_balance', {}],
  ['record_deposit', { p_amount: 1, p_reference: 'probe-' + Date.now() }]
];

console.log('=== full error text, correct args ===');
for (const [fn, args] of CALLS) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H, body: JSON.stringify(args)
  });
  let body; const t = await r.text();
  try { body = JSON.parse(t); } catch { body = t; }
  const msg = body && body.message ? body.message : JSON.stringify(body);
  const missing = /Searched for the function|schema cache|PGRST202|PGRST205/i.test(msg);
  console.log(`\n${fn} -> HTTP ${r.status}  ${missing ? 'MISSING' : 'EXISTS'}`);
  console.log('   ' + String(msg).slice(0, 300));
}

console.log('\n\n=== does public_profiles exist at all? ===');
for (const t of ['public_profiles', 'stake_challenges', 'profiles', 'bets', 'transactions']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  let body; const txt = await r.text();
  try { body = JSON.parse(txt); } catch { body = txt; }
  const hint = body && body.hint ? body.hint : '';
  console.log(`${t.padEnd(18)} HTTP ${r.status}  ${r.status === 200 ? 'exists' : (hint || '').slice(0, 90)}`);
}

// What tables DOES the project have? Probe a few we know from migrations.
console.log('\n=== table presence sweep ===');
for (const t of ['public_profiles', 'stake_challenges', 'profiles', 'bets',
  'pending_bets', 'transactions', 'duel_scores', 'solo_entries']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  console.log(`  ${r.status === 200 ? 'YES ' : 'no  '} ${t}`);
}