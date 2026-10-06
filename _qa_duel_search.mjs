// Drives the 5-10 second search window end to end with a stubbed Supabase
// client, so the solo fallback can be observed without two real accounts.
export default async function run(page, ui) {
  const out = {};

  // ── 1. Stub the server before any app code runs ──────────────────────────
  await page.evaluate(() => {
    const calls = { claim: 0, solo: 0, settle: 0 };
    window.__calls = calls;
    window.__events = [];

    const client = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'TEST-UUID-1' } } }
        })
      },
      rpc: async (fn, args) => {
        calls[fn] = (calls[fn] || 0) + 1;
        window.__events.push(fn);
        // claim_duel_opponent always reports "nobody waiting" so the test
        // exercises the solo fallback rather than an instant match.
        if (fn === 'claim_duel_opponent') return { data: { matched: false, status: 'queued' }, error: null };
        if (fn === 'begin_solo_play') return { data: { solo: true }, error: null };
        return { data: {}, error: null };
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => ({ then: (r) => r({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) })
      }),
      channel: () => {
        const ch = {
          on: () => ch,
          subscribe: (cb) => { setTimeout(() => cb && cb('SUBSCRIBED'), 10); return ch; }
        };
        return ch;
      }
    };

    window.getSupabaseAuthClient = () => client;
    window.supabaseClientInstance = client;
    // A signed-in player with money, so the stake flow is not blocked.
    Object.defineProperty(window, 'activeUser', {
      value: { id: 'TEST-UUID-1', name: 'Tester', isGuest: false },
      configurable: true, writable: true
    });
    window.userWalletBalance = 100000;
  });

  // ── 2. Reload so the app picks up the stub ──────────────────────────────
  // (injected before load, so re-inject then reload is not needed — instead
  //  verify the stub survived by asking the page directly.)
  out.stubActive = await page.evaluate(() => !!window.getSupabaseAuthClient);

  // ── 3. Open the search window directly ──────────────────────────────────
  const before = await page.evaluate(() => {
    window.activeStakeChallenge = {
      id: 'CHLG-TEST-1',
      gameId: 'block-blast',
      gameTitle: 'Block Blast',
      stake: 1000,
      payout: 1800,
      status: 'playing'
    };
    window.beginDuelSearch(window.activeStakeChallenge);
    const bar = document.getElementById('matchmaking-search-bar');
    return {
      modalVisible: !document.getElementById('matchmaking-modal').classList.contains('hidden'),
      barVisible: !bar.classList.contains('hidden'),
      fillWidth: document.getElementById('matchmaking-search-fill').style.width,
      title: document.getElementById('matchmaking-status-title').textContent,
      sub: document.getElementById('matchmaking-status-sub').textContent,
      opponentCardHidden: document.getElementById('matchmaking-opponent-card').classList.contains('hidden')
    };
  });
  out.atStart = before;

  // ── 4. Mid-flight: the bar must be growing ──────────────────────────────
  await page.waitForTimeout(2500);
  out.atMid = await page.evaluate(() => ({
    fillWidth: document.getElementById('matchmaking-search-fill').style.width,
    claimCalls: window.__calls.claim_duel_opponent
  }));

  // ── 5. Wait past the longest possible window (10s) for the fallback ─────
  await page.waitForFunction(() => window.__calls.begin_solo_play > 0, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  out.afterExpiry = await page.evaluate(() => ({
    soloCalls: window.__calls.begin_solo_play,
    title: document.getElementById('matchmaking-status-title').textContent,
    sub: document.getElementById('matchmaking-status-sub').textContent,
    challengeWasSolo: window.activeStakeChallenge.wasSolo,
    fillWidth: document.getElementById('matchmaking-search-fill').style.width
  }));

  // ── 6. The modal must close and the arena open ───────────────────────────
  await page.waitForTimeout(1200);
  out.modalClosed = await page.evaluate(() =>
    document.getElementById('matchmaking-modal').classList.contains('hidden'));
  out.searchBarReset = await page.evaluate(() => ({
    barHidden: document.getElementById('matchmaking-search-bar').classList.contains('hidden'),
    oppCardHidden: document.getElementById('matchmaking-opponent-card').classList.contains('hidden'),
    arenaOpen: !document.getElementById('game-arena-modal').classList.contains('hidden')
  }));

  // ── 7. Now the match-found path: a claim that succeeds ──────────────────
  await page.evaluate(() => {
    window.getSupabaseAuthClient().rpc = async (fn) => {
      window.__calls[fn] = (window.__calls[fn] || 0) + 1;
      if (fn === 'claim_duel_opponent') {
        return {
          data: {
            matched: true,
            opponent_id: 'OPP-UUID-9',
            opponent_name: 'AdaNkem',
            opponent_avatar: 'https://example.com/a.png'
          }, error: null
        };
      }
      return { data: {}, error: null };
    };
    window.activeStakeChallenge = {
      id: 'CHLG-TEST-2', gameId: 'block-blast', gameTitle: 'Block Blast',
      stake: 500, payout: 900, status: 'playing'
    };
    window.beginDuelSearch(window.activeStakeChallenge);
  });
  await page.waitForTimeout(400);
  out.onMatchFound = await page.evaluate(() => ({
    barHidden: document.getElementById('matchmaking-search-bar').classList.contains('hidden'),
    oppCardVisible: !document.getElementById('matchmaking-opponent-card').classList.contains('hidden'),
    oppName: document.getElementById('matchmaking-opponent-name').textContent,
    oppAvatarStyle: document.getElementById('matchmaking-opponent-avatar').style.backgroundImage,
    title: document.getElementById('matchmaking-status-title').textContent,
    oppIdStored: window.activeStakeChallenge.opponentId
  }));

  await page.waitForTimeout(1200);
  out.modalClosedAfterMatch = await page.evaluate(() =>
    document.getElementById('matchmaking-modal').classList.contains('hidden'));

  return out;
}