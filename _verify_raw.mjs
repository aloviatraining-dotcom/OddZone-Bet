const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const fns = [
  ['claim_duel_opponent', { p_challenge_id: 'nope' }],
  ['begin_solo_play', { p_challenge_id: 'nope' }],
  ['settle_duel', { p_challenge_id: 'nope', p_score: 1 }],
  ['cancel_duel', { p_challenge_id: 'nope' }],
  ['open_duel', { p_game_id: 'x', p_stake: 200, p_payout: 360 }],
  ['wallet_balance', {}]
];

for (const [fn, args] of fns) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H, body: JSON.stringify(args)
  });
  const t = await r.text();
  console.log(`\n--- ${fn} -> ${r.status}`);
  console.log(t.slice(0, 400));
}

// Does the live table actually have the CHLG- id format open_duel produces?
console.log('\n--- table identity');
for (const q of [
  '/rest/v1/stake_challenges?select=id,status&status=eq.queued',
  '/rest/v1/stake_challenges?select=id,status&status=eq.solo',
  '/rest/v1/stake_challenges?select=id&limit=3'
]) {
  const r = await fetch(URL + q, { headers: H });
  console.log(q.split('?')[1], '->', r.status, (await r.text()).slice(0, 220));
}