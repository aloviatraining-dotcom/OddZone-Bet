const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function cols(table, names) {
  const found = [], missing = [];
  for (const n of names) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${n}&limit=1`, { headers: H });
    if (r.ok) found.push(n);
    else {
      const t = await r.text();
      if (/does not exist|PGRST204/i.test(t)) missing.push(n); else found.push(n + '?');
    }
  }
  return { found, missing };
}

const b = await cols('bets', ['id', 'user_id', 'game_id', 'game', 'game_title', 'score', 'stake',
  'payout', 'status', 'creator_score', 'opponent_score',
  'opponent_id', 'winner_id', 'created_at']);
console.log('bets FOUND  :', b.found.join(', '));
console.log('bets MISSING:', b.missing.join(', '));

const t = await cols('transactions', ['id', 'user_id', 'title', 'type', 'amount', 'detail', 'reference', 'status', 'created_at']);
console.log('\ntransactions FOUND  :', t.found.join(', '));
console.log('transactions MISSING:', t.missing.join(', '));

// Does the realtime publication actually carry stake_challenges? Observable
// indirectly: realtime needs the table to be in the publication. Can't query
// pg_publication_tables over REST, so just note it.

// Are there stale rows that the new solo status would affect?
const r = await fetch(`${URL}/rest/v1/stake_challenges?select=id,status,created_at&status=in.(queued,playing)&limit=50`, { headers: H });
const rows = await r.json();
console.log(`\nopen (queued/playing) rows: ${rows.length}`);
const byStatus = {};
for (const x of rows) byStatus[x.status] = (byStatus[x.status] || 0) + 1;
console.log(byStatus);