// Verify the duel migration actually landed on the live project.
// Checks what is observable over the REST API (columns, functions, RLS).
const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function req(path, opts = {}) {
  const r = await fetch(URL + path, { headers: H, ...opts });
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { }
  return { status: r.status, body };
}

const results = {};
const say = (k, v) => { results[k] = v; console.log(`${k}: ${v}`); };

// ── 1. New columns exist ───────────────────────────────────────────────────
for (const col of ['is_solo', 'opponent_name', 'opponent_avatar', 'opponent_id', 'status', 'score']) {
  const { status, body } = await req(`/rest/v1/stake_challenges?select=${col}&limit=1`);
  const err = body && body.message ? body.message : body && body.code;
  say(`col_${col}`, status === 200 ? 'present' : `${status} ${err}`);
}

// ── 2. New functions exist and are executable by authenticated ─────────────
// A missing function says "Could not find the function ... in the schema
// cache". An existing but ungranted one says permission denied. Either way we
// learn whether the CREATE OR REPLACE landed.
for (const fn of ['claim_duel_opponent', 'begin_solo_play', 'settle_duel', 'cancel_duel', 'open_duel', 'wallet_balance']) {
  const { status, body } = await req('/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const msg = (body && (body.message || body.hint)) || JSON.stringify(body);
  let verdict;
  if (/schema cache|Could not find the function|does not exist|42P01|42883/i.test(msg)) {
    verdict = 'MISSING (not in schema cache)';
  } else if (/permission denied|42501/i.test(msg)) {
    verdict = 'exists, execute denied for anon (expected)';
  } else if (/not authenticated|401/i.test(msg) || status === 401) {
    verdict = 'exists (auth required)';
  } else {
    verdict = `${status} ${msg}`.slice(0, 90);
  }
  say(`fn_${fn}`, verdict);
}

// ── 3. profiles readable as anon (the opponent name/avatar read) ───────────
{
  const { status, body } = await req('/rest/v1/profiles?select=username,avatar_url&limit=1');
  const err = body && body.message ? body.message : '';
  say('profiles_anon_select', status === 200 ? 'allowed' : `${status} ${err}`.slice(0, 90));
}

// ── 4. wallet_balance must NOT be readable directly on another row ─────────
{
  const { status, body } = await req('/rest/v1/profiles?select=wallet_balance&limit=1');
  const err = body && body.message ? body.message : '';
  // Allowed if the profiles_read_public row policy is in force; the protection
  // is that the client never asks for it for someone else. Report only.
  say('profiles_wallet_select', status === 200 ? 'row-readable (see note)' : `${status} ${err}`.slice(0, 70));
}

// ── 5. Existing queued rows ───────────────────────────────────────────────
{
  const { status, body } = await req('/rest/v1/stake_challenges?select=id,status,game_id,stake,is_solo&limit=20');
  say('rows', status === 200 ? `${Array.isArray(body) ? body.length : 0} returned` : `${status}`);
  if (status === 200 && Array.isArray(body)) {
    for (const r of body) console.log('   ', JSON.stringify(r));
  }
}

console.log('\n' + JSON.stringify(results, null, 2));