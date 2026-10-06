-// Exercises the realtime half of the flow: the search window is abandoned for
// a solo run, the score is banked, and a later opponent's row flipping to
// 'matched' must resolve the deferred duel and open the result card.
//
// The realtime channel is stubbed so handleDuelRowUpdate() can be driven
// directly with the payloads Postgres would actually push.
export default async function run(page, ui) {
  const out = {};
  const inject = (code) => page.evaluate((src) => {
    const el = document.createElement('script');
    el.textContent = src;
    document.body.appendChild(el); el.remove();
  }, code);

  await inject(`
    window.__handler = null;
    window.__mode = 'nobody';
    window.getSupabaseAuthClient = function () {
      return {
        auth: { getSession: async () => ({ data: { session: { user: { id: 'ME' } } } }) },
        rpc: async function (fn) {
          if (fn === 'wallet_balance') return { data: 99000, error: null };
          if (fn === 'claim_duel_opponent') return { data: { matched: false, status: 'queued' }, error: null };
          if (fn === 'begin_solo_play') return { data: { solo: true }, error: null };
          return { data: {}, error: null };
        },
        from: function () {
          var q = { select:function(){return q;}, eq:function(){return q;}, in:function(){return q;},
                    order:function(){return q;}, limit:function(){return q;},
                    // My own challenge row, re-read for the result card.
                    maybeSingle: async function(){ return { data: {
                      id: 'CHLG-SOLO', game_id: 'block-blast', stake: 1000, payout: 1800,
                      score: 4820, status: 'matched', user_id: 'ME',
                      opponent_id: 'THEM', opponent_name: 'AdaNkem',
                      opponent_avatar: '', winner_id: 'ME'
                    }, error: null }; },
                    single: async function(){return {data:null,error:null};},
                    then: function(res){return res({data:[],error:null});} };
          return q;
        },
        channel: function () {
          var ch = { on: function(evt, filt, cb) { window.__handler = cb; return ch; },
                     subscribe: function(){ return ch; } };
          return ch;
        }
      };
    };
    Object.defineProperty(window, 'activeUser', {
      get: function () { return { id: 'ME', name: 'Tester', isGuest: false }; },
      configurable: true
    });
    // Rebuild the channel so it picks up the stubbed client and captures the
    // postgres_changes handler.
    if (typeof duelChannel !== 'undefined' && duelChannel) {
      try { getSupabaseAuthClient().removeChannel(duelChannel); } catch (e) {}
      duelChannel = null;
    }
    subscribeDuelRealtime();
  `);

  out.handlerCaptured = await page.evaluate(() => {
    const el = document.createElement('script');
    el.textContent = 'document.documentElement.setAttribute("data-handler", String(!!window.__handler));';
    document.body.appendChild(el); el.remove();
    return document.documentElement.getAttribute('data-handler');
  });

  // ── Set up a player who already finished a solo run and is waiting ──────
  await inject(`
    closeMatchmakingModal();
    selectedGameId = 'block-blast';
    activeStakeChallenge = { id: 'CHLG-SOLO', gameId: 'block-blast', gameTitle: 'Block Blast',
      stake: 1000, payout: 1800, status: 'queued', score: 4820, wasSolo: true };
  `);

  // A queued challenge from someone else must NOT resolve my duel.
  await inject(`
    handleDuelRowUpdate({ id: 'CHLG-OTHER', user_id: 'SOMEONE-ELSE', game_id: 'block-blast',
      stake: 1000, status: 'queued' });
  `);
  await page.waitForTimeout(200);
  out.unrelatedIgnored = await page.evaluate(() =>
    document.getElementById('match-result-modal').classList.contains('hidden'));

  // The real payload: my opponent's row flipped to 'matched' against me.
  await inject(`
    handleDuelRowUpdate({ id: 'CHLG-SOLO', user_id: 'ME', opponent_id: 'THEM',
      game_id: 'block-blast', stake: 1000, score: 4820, status: 'queued' });
    handleDuelRowUpdate({ id: 'CHLG-THEIRS', user_id: 'THEM', opponent_id: 'ME',
      opponent_name: 'AdaNkem', opponent_avatar: '', game_id: 'block-blast',
      stake: 1000, status: 'matched', winner_id: 'ME' });
  `);
  await page.waitForTimeout(900);

  out.afterOpponentMatched = await page.evaluate(() => {
    const m = document.getElementById('match-result-modal');
    return {
      resultOpen: !m.classList.contains('hidden'),
      outcome: document.getElementById('mr-outcome-title').textContent,
      oppName: document.getElementById('mr-opp-name').textContent,
      you: document.getElementById('mr-user-score').textContent,
      them: document.getElementById('mr-opp-score').textContent
    };
  });
  await page.screenshot({ path: '_shot_realtime_result.png' });

  // A second identical push must not double-handle (the card would re-render
  // and the balance would be read twice).
  await inject(`
    handleDuelRowUpdate({ id: 'CHLG-THEIRS', user_id: 'THEM', opponent_id: 'ME',
      opponent_name: 'AdaNkem', opponent_avatar: '', game_id: 'block-blast',
      stake: 1000, status: 'matched', winner_id: 'ME' });
  `);
  await page.waitForTimeout(400);
  out.afterDuplicatePush = await page.evaluate(() => {
    const el = document.createElement('script');
    el.textContent = 'document.documentElement.setAttribute("data-ch", String(activeStakeChallenge === null));';
    document.body.appendChild(el); el.remove();
    return {
      challengeCleared: document.documentElement.getAttribute('data-ch'),
      resultStillOpen: !document.getElementById('match-result-modal').classList.contains('hidden')
    };
  });

  return out;
}