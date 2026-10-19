const URL = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// PostgREST exposes its inferred schema at the root. This is authoritative
// for column TYPES, which the OpenAPI-ish introspection gives us.
const r = await fetch(URL + '/', { headers: { ...H, Accept: 'application/openapi+json' } });
console.log('root ->', r.status);
const spec = await r.json();

const t = spec.definitions?.stake_challenges || spec.components?.schemas?.stake_challenges;
if (!t) { console.log('no stake_challenges in spec; top-level keys:', Object.keys(spec)); process.exit(0); }

console.log('\nstake_challenges columns:');
for (const [name, def] of Object.entries(t.properties || {})) {
  const type = def.type || (def.format ? def.format : JSON.stringify(def));
  console.log(`  ${name.padEnd(18)} ${type}`);
}

const p = spec.definitions?.profiles || spec.components?.schemas?.profiles;
if (p) {
  console.log('\nprofiles columns:');
  for (const [name, def] of Object.entries(p.properties || {})) {
    console.log(`  ${name.padEnd(18)} ${def.type || JSON.stringify(def)}`);
  }
}

// Which RPC signatures does PostgREST know about? This is the definitive
// "what can I actually call" list.
console.log('\nknown RPC paths:');
for (const k of Object.keys(spec.paths || {})) {
  if (k.startsWith('/rpc/')) console.log('  ' + k);
}