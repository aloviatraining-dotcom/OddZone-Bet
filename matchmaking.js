// matchmaking.js – handles pending bet UI and realtime matchmaking
import { supabase } from "./supabaseClient.js";

// ------------------------------------------------------------------
// Helper to get client
// ------------------------------------------------------------------
const getClient = () => supabase || window.supabaseClientInstance || (window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null);

// ------------------------------------------------------------------
// Load pending bets / challenges available for other players to join
// ------------------------------------------------------------------
export const loadPendingBets = async () => {
  const container = document.getElementById("pending-bets-panel");
  if (!container) return;

  const client = getClient();
  if (!client) {
    container.innerHTML = `<p class="rounded-xl border border-white/10 bg-cardBg px-4 py-3 text-xs text-slate-400">Log in to view available player challenges.</p>`;
    return;
  }

  let currentUserId = null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    currentUserId = sessionData?.session?.user?.id || (window.activeUser && window.activeUser.id) || null;
  } catch (e) {}

  try {
    // Look for active queued stake challenges from other players
    let query = client
      .from("stake_challenges")
      .select("id, game_id, stake, payout, status, created_at, user_id")
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(10);

    if (currentUserId) {
      query = query.neq("user_id", currentUserId);
    }

    let { data, error } = await query;

    if (error || !data || data.length === 0) {
      // Fallback: check pending_bets table
      const pbQuery = await client
        .from("pending_bets")
        .select("id, game_id, stake, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(10);
      if (!pbQuery.error && pbQuery.data) {
        data = pbQuery.data;
      }
    }

    if (!data || !data.length) {
      container.innerHTML = `<p class="rounded-xl border border-white/10 bg-cardBg px-4 py-3 text-xs text-slate-400">No open challenges waiting right now. Start a 1v1 match above!</p>`;
      return;
    }

    container.innerHTML = data
      .map((bet) => {
        const gameCatalog = window.GAME_CATALOG || [];
        const gameTitle = gameCatalog.find((g) => g.id === bet.game_id)?.title || bet.game_id || "1v1 Battle";
        const dateStr = bet.created_at ? new Date(bet.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Live";
        return `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-gradient-to-r from-[#171226] to-[#120d20] p-3.5 shadow-md">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
              <p class="truncate text-xs font-bold text-white">${gameTitle}</p>
            </div>
            <p class="mt-1 text-[10px] text-amber-200">Stake: <span class="font-bold">₦${Number(bet.stake).toLocaleString()}</span> · <span class="text-slate-400">${dateStr}</span></p>
          </div>
          <button class="join-challenge-btn shrink-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3.5 py-2 text-xs font-extrabold text-[#1a0e00] shadow-sm transition hover:brightness-110 active:scale-95" data-id="${bet.id}" data-game="${bet.game_id}" data-stake="${bet.stake}">
            Accept Duel
          </button>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".join-challenge-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const betId = btn.dataset.id;
        const gameId = btn.dataset.game;
        const stake = Number(btn.dataset.stake || 1000);
        acceptChallengeDuel(betId, gameId, stake);
      });
    });
  } catch (err) {
    console.warn("loadPendingBets error:", err);
    container.innerHTML = `<p class="rounded-xl border border-white/10 bg-cardBg px-4 py-3 text-xs text-slate-400">No open challenges waiting right now.</p>`;
  }
};

// ------------------------------------------------------------------
// Accept a challenge duel
// ------------------------------------------------------------------
export const acceptChallengeDuel = async (betId, gameId, stake) => {
  if (window.activeUser && window.activeUser.isGuest) {
    alert("Please log in to accept real money 1v1 challenges.");
    return;
  }
  if (typeof window.userWalletBalance === "number" && window.userWalletBalance < stake) {
    alert(`Insufficient balance (₦${window.userWalletBalance.toLocaleString()}). Please deposit to accept this ₦${stake.toLocaleString()} challenge.`);
    if (typeof window.switchTab === "function") window.switchTab("wallet");
    return;
  }

  // Pre-select game and stake. openGameOptions() resets the stake back to the
  // ₦1000 default, so the exact amount has to be re-applied afterwards or the
  // player silently accepts a duel for the wrong amount.
  if (typeof window.openGameOptions === "function" && gameId) {
    window.openGameOptions(gameId);
  }
  if (typeof window.selectStakeAmount === "function") {
    window.selectStakeAmount(stake);
  }
};

// ------------------------------------------------------------------
// Queue this player's own score and try to settle a duel
// ------------------------------------------------------------------
// The old version called a `join_pending_bet` RPC that has never existed, so
// it always errored and returned without doing anything. Matching now happens
// inside settle_duel(), which picks the opponent, decides the winner and moves
// the money in one locked transaction.
export const joinPendingBet = async (betId) => {
  const client = getClient();
  if (!client) return;
  const { error } = await client.rpc("settle_duel", { p_challenge_id: betId, p_score: 0 });
  if (error) {
    console.error("settle_duel error:", error);
    return;
  }
  showMatchmakingModal();
};

// ------------------------------------------------------------------
// Listen for match updates in realtime
// ------------------------------------------------------------------
// This used to subscribe to a `matches` table that has never existed, so the
// channel delivered nothing. The real table is stake_challenges: an opponent
// arriving shows up as a new queued row, and a duel settling shows up as that
// row flipping to 'matched'.
// Realtime for the duel flow lives in index.html now: subscribeDuelRealtime()
// owns the single 'oddzone:duel' channel and handles every state change
// (QUEUED -> MATCHED -> PLAYING -> WON/LOST/TIE), including the 5-10 second
// search window and the solo fallback.
//
// The subscription used to live here, but it only listened for status='matched'
// and simply closed the modal. That meant a player who was mid-search never
// learned an opponent had arrived, and a player whose solo score settled later
// was never shown the result. Keeping two channels on the same table also
// delivered each UPDATE twice.
//
// Delegating instead of duplicating also means one channel, not two.
export const subscribeMatchUpdates = () => {
  if (typeof window.subscribeDuelRealtime === 'function') {
    window.subscribeDuelRealtime();
    return;
  }

  const client = getClient();
  if (!client || typeof client.channel !== 'function') return;

  try {
    client
      .channel('public:stake_challenges')
      .on(
        'postgres_changes',
        { event: "*", schema: "public", table: "stake_challenges" },
        async (payload) => {
          const row = payload.new || {};
          let uid = window.activeUser?.id;
          if (!uid) {
            const { data } = await client.auth.getSession();
            uid = data?.session?.user?.id;
          }
          if (!uid) return;
          // Only react to the player's own duels, never someone else's.
          if (row.user_id && row.user_id !== uid && row.opponent_id !== uid) return;

          if (row.status === "matched") {
            // Settled: pull the authoritative balance and refresh the views.
            if (typeof window.refreshWalletFromServer === "function") {
              window.refreshWalletFromServer();
            }
            hideMatchmakingModal();
          }
          if (typeof window.loadPendingBets === "function") window.loadPendingBets();
          if (typeof window.renderActiveChallenges === "function") window.renderActiveChallenges();
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("Realtime stake_challenges subscription:", err);
  }
};

// Settling is now driven by settle_duel() in index.html, which owns the
// whole result UI. Nothing to do but make sure the waiting screen is closed.
const startMatch = () => {
  hideMatchmakingModal();
};

const showMatchmakingModal = () => {
  const modal = document.getElementById("matchmaking-modal");
  if (modal) modal.classList.remove("hidden");
};

const hideMatchmakingModal = () => {
  const modal = document.getElementById("matchmaking-modal");
  if (modal) modal.classList.add("hidden");
};

// Expose globally for legacy & window event listeners
window.loadPendingBets = loadPendingBets;
window.acceptChallengeDuel = acceptChallengeDuel;
window.joinPendingBet = joinPendingBet;
window.subscribeMatchUpdates = subscribeMatchUpdates;

// Initialise on load
window.addEventListener("load", () => {
  loadPendingBets();
  subscribeMatchUpdates();
});
