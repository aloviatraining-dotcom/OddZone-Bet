const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const pass = [], fail = [];
const check = (name, ok, detail) => {
  (ok ? pass : fail).push(name + (detail ? ' — ' + detail : ''));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function get(path) {
  const r = await fetch(URL + path, { headers: H });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

// ── 1. profiles must NOT be world-readable any more (the leak) ────────────
{
  const { status, body } = await get('/rest/v1/profiles?select=wallet_balance&limit=1');
  const rows = Array.isArray(body) ? body.length : -1;
  check('profiles is not world-readable', status !== 200 || rows === 0,
    status === 200 ? `${rows} rows visible to anon (LEAK)` : `HTTP ${status}`);

  // Even if the old policy somehow survived, a 0-row read is not proof of
  // safety on its own; confirm a username read is also closed.
  const u = await get('/rest/v1/profiles?select=username&limit=1');
  const urows = Array.isArray(u.body) ? u.body.length : -1;
  check('profiles cross-player read closed', u.status !== 200 || urows === 0,
    u.status === 200 ? `${urows} rows` : `HTTP ${u.status}`);
}

// ── 2. public_profiles must exist and be world-readable ────────────────────
{
  const { status, body } = await get('/rest/v1/public_profiles?select=user_id,username,avatar_url&limit=5');
  check('public_profiles readable', status === 200,
    status === 200 ? `${Array.isArray(body) ? body.length : 0} rows` : `HTTP ${status} ${JSON.stringify(body).slice(0, 80)}`);
  if (status === 200 && Array.isArray(body) && body.length) {
    for (const r of body.slice(0, 5)) console.log('      ', JSON.stringify(r));
  }
}

// ── 3. public_profiles must NOT be writable by the anon key ───────────────
{
  const r = await fetch(`${URL}/rest/v1/public_profiles`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000', username: 'HACKED' })
  });
  const t = await r.text();
  const blocked = r.status >= 400 || /denied|not allowed|row-level|policy/i.test(t);
  check('public_profiles NOT writable by anon', blocked,
    blocked ? `HTTP ${r.status} correctly refused` : `HTTP ${r.status} WRITE SUCCEEDED — LEAK`);
}

// ── 4. Functions exist ─────────────────────────────────────────────────────
const FNS = ['claim_duel_opponent', 'begin_solo_play', 'settle_duel',
  'cancel_duel', 'open_duel', 'wallet_balance'];
for (const fn of FNS) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}'
  });
  const t = await r.text();
  const missing = /schema cache|Could not find the function|PGRST202|does not exist/i.test(t);
  check(`fn ${fn} exists`, !missing, missing ? t.slice(0, 70) : 'in schema cache');
}

// ── 5. The id::text fix: a real uuid id must no longer raise a cast error ──
// This is the decisive test for DEFECT 2. Pass an actual uuid from the table.
// The expected failure is "not signed in" / "not found for this user", NOT
// "operator does not exist: uuid = text".
{
  const { body: rows } = await get('/rest/v1/stake_challenges?select=id&limit=1');
  if (Array.isArray(rows) && rows.length) {
    const id = rows[0].id;
    console.log(`      (testing with live id ${id})`);
    for (const fn of ['claim_duel_opponent', 'begin_solo_play']) {
      const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_challenge_id: id })
      });
      const t = await r.text();
      const castErr = /operator does not exist|uuid = text|invalid input syntax|42883|22P02/i.test(t);
      check(`${fn} accepts a uuid id (no cast error)`, !castErr,
        castErr ? `STILL BROKEN: ${t.slice(0, 90)}` : 'no cast error');
    }
    const r = await fetch(`${URL}/rest/v1/rpc/settle_duel`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_challenge_id: id, p_score: 10 })
    });
    const t = await r.text();
    const castErr = /operator does not exist|uuid = text|invalid input syntax|42883|22P02/i.test(t);
    check('settle_duel accepts a uuid id (no cast error)', !castErr,
      castErr ? `STILL BROKEN: ${t.slice(0, 90)}` : 'no cast error');
  } else {
    console.log('      (no rows to test with)');
  }
}

// ── 6. Any rows stranded by v1: matched with no winner ─────────────────────
{
  const { status, body } = await get(
    '/rest/v1/stake_challenges?select=id,status,winner_id,opponent_id,stake,game_id&status=eq.matched&limit=100');
  if (status === 200 && Array.isArray(body)) {
    const stranded = body.filter(r => !r.winner_id);
    check('no stranded v1 rows (matched, no winner)', stranded.length === 0,
      stranded.length ? `${stranded.length} rows with stakes debited but no payout` : `${body.length} matched rows, all settled`);
    for (const r of stranded.slice(0, 10)) console.log('       STRANDED', JSON.stringify(r));
  }
}

// ── 7. Live state distribution ─────────────────────────────────────────────
{
  const { body } = await get('/rest/v1/stake_challenges?select=status&limit=1000');
  const by = {};
  for (const r of (Array.isArray(body) ? body : [])) by[r.status] = (by[r.status] || 0) + 1;
  console.log('\nstatus distribution:', JSON.stringify(by));
}

console.log(`\n=== ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  - ' + f)); }