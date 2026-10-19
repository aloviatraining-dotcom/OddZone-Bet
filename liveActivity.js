// liveActivity.js
// ─────────────────────────────────────────────────────────────────────────────
// Two features that hang off the same plumbing:
//
//   1. LIVE COMMUNITY ACTIVITY
//      A Supabase Realtime channel watches feed_posts, stake_challenges and
//      transactions. When any account posts, opens a duel or records a win the
//      row is broadcast and every connected client re-renders immediately — no
//      page reload, no manual refresh.
//
//   2. PULL-TO-REFRESH + MANUAL REFRESH CONTROLS
//      One refreshAll() re-pulls the live wallet balance, the active duels, the
//      open challenge board and the community feed. It backs the refresh button
//      in the nav bar and the pull-down gesture on the home, wallet and lobby
//      screens, and it also runs when a tab comes back into view or the window
//      regains focus (mobile browsers kill sockets in the background).
//
// Loaded as a classic script (not a module) so its functions are globals that
// the inline onclick handlers in index.html can reach directly.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE = {
    channel: null,
    started: false,
    refreshing: false,
    lastEventAt: 0,
    feedLoaded: false
};

// Rows fetched from the server are cached here and merged into the local feed
// store that index.html renders from.
let remoteFeedPosts = [];

function liveClient() {
    if (typeof getSupabaseAuthClient === 'function') {
        const c = getSupabaseAuthClient();
        if (c) return c;
    }
    return window.supabaseClientInstance || null;
}

// index.html declares `activeUser` with `let` inside its inline script and then
// re-exposes it as a getter on window, so it must always be read through
// `window.` — a bare `activeUser` is not in scope here.
function currentUser() {
    return window.activeUser || null;
}

function isSignedIn() {
    const user = currentUser();
    return Boolean(user && !user.isGuest && user.id);
}

function isFeedViewVisible() {
    const view = document.getElementById('view-home');
    return Boolean(view && !view.classList.contains('hidden'));
}

// ── relative time ────────────────────────────────────────────────────────────
// Posts are stored with an absolute timestamp, so a post that has been sitting
// on the feed for an hour must say "1h ago" even if it was rendered once at
// creation. Recomputing on every render keeps the labels honest.
function feedTimeLabel(timestamp, fallback) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return fallback || 'Recent';
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seconds < 45) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

// ── remote post → feed-post shape ────────────────────────────────────────────
function normalizeRemotePost(row) {
    if (!row || !row.id) return null;
    const demoIds = typeof window.getLegacyDemoFeedPostIds === 'function'
        ? window.getLegacyDemoFeedPostIds()
        : [];
    if (demoIds.includes(row.id)) return null;
    const challengeId = row.challenge_id
        || (row.type === 'duel' && String(row.id).startsWith('duel-') ? String(row.id).slice(5) : null);
    return {
        id: row.id,
        userId: row.user_id || null,
        challengeId: challengeId || null,
        challengeStatus: row.challenge_status || null,
        isPublic: row.is_public !== false,
        author: row.author || 'Player',
        authorLevel: Number(row.author_level || 1),
        authorTitle: row.author_title || 'Duelist',
        authorPhoto: row.author_photo || null,
        type: row.type || 'text',
        content: row.content || '',
        gameId: row.game_id || null,
        gameTitle: row.game_title || null,
        stake: row.stake != null ? Number(row.stake) : null,
        amount: row.amount != null ? Number(row.amount) : null,
        likes: Number(row.likes || 0),
        likedByMe: false,
        timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        timeLabel: feedTimeLabel(row.created_at ? new Date(row.created_at).getTime() : Date.now())
    };
}

// Merge server rows into the local feed store, preserving the per-device fields
// the server does not know about (likedByMe) and keeping the newest first.
function mergeRemoteFeedPosts(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    const incoming = rows.map(normalizeRemotePost).filter(Boolean);
    if (!incoming.length) return false;

    const local = typeof getSocialFeedPosts === 'function' ? getSocialFeedPosts() : [];
    const byId = new Map();
    local.forEach(p => { if (p && p.id) byId.set(p.id, p); });
    incoming.forEach(p => {
        const prev = byId.get(p.id);
        if (!p.isPublic && p.userId !== currentUser()?.id) {
            byId.delete(p.id);
            return;
        }
        // likedByMe is a local decision — the server has no opinion about it.
        byId.set(p.id, prev ? { ...p, likedByMe: Boolean(prev.likedByMe) } : p);
    });

    const merged = Array.from(byId.values())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 120);

    if (typeof saveSocialFeedPosts === 'function') saveSocialFeedPosts(merged);
    remoteFeedPosts = incoming;
    return true;
}

// Remove a post the server says is gone (deleted or cancelled by its author).
function removeRemoteFeedPost(postId) {
    if (!postId) return;
    const local = typeof getSocialFeedPosts === 'function' ? getSocialFeedPosts() : [];
    const next = local.filter(p => p.id !== postId);
    if (next.length === local.length) return;
    if (typeof saveSocialFeedPosts === 'function') saveSocialFeedPosts(next);
}

// ── publish ──────────────────────────────────────────────────────────────────
// Publish posts through the authenticated account so every connected feed sees
// the same server-backed row.
async function broadcastFeedPost(post) {
    if (!post || !post.id) throw new Error('This post is missing its id.');
    const client = liveClient();
    if (!client) throw new Error('The shared feed service is unavailable. Check your connection and try again.');
    if (!isSignedIn()) throw new Error('Sign in to an account to share posts with other players.');

    const user = currentUser();
    const row = {
        id: post.id,
        user_id: user.id,
        author: post.author || user.name,
        username: post.author || user.name || 'Player',
        author_level: Number(post.authorLevel || 1),
        author_title: post.authorTitle || null,
        author_photo: post.authorPhoto || user.photo || null,
        type: post.type || 'text',
        content: post.content || '',
        game_id: post.gameId || null,
        game_title: post.gameTitle || null,
        challenge_id: post.challengeId || null,
        stake: post.stake != null ? Number(post.stake) : null,
        amount: post.amount != null ? Number(post.amount) : null,
        likes: 0
    };

    const publish = async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            return await client.from('feed_posts').upsert(row, {
                onConflict: 'id',
                ignoreDuplicates: true
            }).abortSignal(controller.signal);
        } finally {
            clearTimeout(timeout);
        }
    };

    let result;
    try {
        result = await publish();
        if (result.error && /jwt expired|token is expired/i.test(result.error.message || '')) {
            const { data, error } = await client.auth.refreshSession();
            if (error || !data?.session) {
                throw new Error('Your login session expired. Please sign out and sign back in, then try posting again.');
            }
            result = await publish();
        }
    } catch (error) {
        if (error?.name === 'AbortError' || /aborted/i.test(error?.message || '')) {
            throw new Error('Publishing timed out after 20 seconds. Check your connection and retry; the post has not been confirmed as shared.');
        }
        throw error;
    }

    let error = result.error;
    if (!error && post.challengeId) {
        const linkResult = await client.from('feed_posts')
            .update({ challenge_id: String(post.challengeId) })
            .eq('id', post.id)
            .eq('user_id', user.id);
        error = linkResult.error;
    }
    if (error) {
        console.error('Feed post broadcast failed:', error);
        if (/jwt expired|token is expired/i.test(error.message || '')) {
            throw new Error('Your login session expired. Please sign out and sign back in, then try posting again.');
        }
        if (error.code === 'PGRST204' || error.code === '42703') {
            throw new Error('The feed table is missing a column required by this app. Run the 20261018000003_link_duel_feed_posts.sql migration in Supabase, then refresh the app.');
        }
        if (error.code === '42P01' || error.code === 'PGRST205'
            || /feed_posts.*(not found|does not exist)|schema cache/i.test(error.message || '')) {
            throw new Error('Shared posting is not set up in this Supabase project. Apply the 20261002000000_live_community_feed.sql migration.');
        }
        if (error.code === '42501' || /row-level security|permission denied/i.test(error.message || '')) {
            throw new Error('Supabase refused to publish this post. Check that you are signed in and that the feed_posts policies are applied.');
        }
        throw new Error(error.message || 'The post could not be shared. Check your connection and try again.');
    }
}

function deleteRemoteFeedPost(postId) {
    const client = liveClient();
    if (!client || !isSignedIn() || !postId) return;
    client.from('feed_posts').delete().eq('id', postId).then(({ error }) => {
        if (error) console.warn('Feed post delete failed:', error.message || error);
    });
}

// The server performs the toggle and returns the resulting account state.
async function syncFeedLike(postId) {
    const client = liveClient();
    if (!client || !isSignedIn() || !postId) {
        throw new Error('Sign in to like posts.');
    }
    const { data: liked, error: likeError } = await client.rpc('toggle_feed_like', { p_post_id: postId });
    if (likeError) throw new Error(likeError.message || 'Could not update the like.');
    const { data: post, error: postError } = await client
        .from('feed_posts')
        .select('likes')
        .eq('id', postId)
        .single();
    if (postError) throw new Error(postError.message || 'Could not refresh the like count.');
    return { liked: Boolean(liked), likes: Number(post.likes) || 0 };
}

// ── feed fetch ───────────────────────────────────────────────────────────────
async function fetchLiveFeed(options = {}) {
    const client = liveClient();
    if (!client) return [];

    try {
        const limit = options.limit || 60;
        let query = client
            .from('feed_posts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        // Before the feed_posts migration is applied, the server feed is
        // unavailable and the UI remains empty rather than showing sample data.
        const { data, error } = await query;
        if (error) {
            if (!LIVE.feedLoaded) console.warn('Live feed unavailable:', error.message || error);
            return [];
        }

        LIVE.feedLoaded = true;
        let rows = Array.isArray(data) ? data : [];
        if (isSignedIn()) {
            const { data: privateRows, error: privateRowsError } = await client
                .from('feed_posts')
                .select('*')
                .eq('user_id', currentUser().id)
                .eq('is_public', false)
                .eq('type', 'duel')
                .order('created_at', { ascending: false })
                .limit(60);
            if (privateRowsError) {
                if (privateRowsError.code !== '42703' && privateRowsError.code !== 'PGRST204') {
                    throw privateRowsError;
                }
            } else if (Array.isArray(privateRows)) {
                const allRows = new Map(rows.map(row => [row.id, row]));
                privateRows.forEach(row => allRows.set(row.id, row));
                rows = Array.from(allRows.values());
            }
        }

        // Read likes from the relation table so stale client-supplied counts
        // cannot be displayed as genuine engagement.
        let likedIds = new Set();
        const likeCounts = new Map();
        if (rows.length) {
            const likes = [];
            let likeQueryError = null;
            let rangeStart = 0;
            while (true) {
                const { data: page, error } = await client
                    .from('feed_likes')
                    .select('post_id, user_id')
                    .in('post_id', rows.map(row => row.id))
                    .order('post_id', { ascending: true })
                    .order('user_id', { ascending: true })
                    .range(rangeStart, rangeStart + 999);
                if (error) {
                    likeQueryError = error;
                    break;
                }
                likes.push(...(page || []));
                if (!page || page.length < 1000) break;
                rangeStart += page.length;
            }
            if (likeQueryError) {
                console.warn('Could not load real feed likes; showing zero counts:', likeQueryError.message || likeQueryError);
            } else {
                likes.forEach(like => {
                    likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
                    if (isSignedIn() && like.user_id === currentUser().id) likedIds.add(like.post_id);
                });
            }
        }

        const normalised = rows.map(row => {
            const post = normalizeRemotePost(row);
            if (post) {
                post.likes = likeCounts.get(post.id) || 0;
                post.likedByMe = likedIds.has(post.id);
            }
            return post;
        }).filter(post => post && (post.isPublic || post.userId === currentUser()?.id));

        if (normalised.length) {
            const local = typeof getSocialFeedPosts === 'function' ? getSocialFeedPosts() : [];
            const postsById = new Map(local.filter(post => post && post.id).map(post => [post.id, post]));
            normalised.forEach(post => postsById.set(post.id, post));
            const merged = Array.from(postsById.values())
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 120);
            if (typeof saveSocialFeedPosts === 'function') saveSocialFeedPosts(merged);
        }

        remoteFeedPosts = normalised;
        return normalised;
    } catch (e) {
        console.warn('fetchLiveFeed failed:', e);
        return [];
    }
}

// ── refresh orchestrator ─────────────────────────────────────────────────────
// Everything the user can see that another account can change. Called by the
// refresh button, the pull gesture, tab focus and tab switches.
async function refreshAllData(options = {}) {
    if (LIVE.refreshing) return;
    LIVE.refreshing = true;
    setRefreshVisual(true);
    const startedAt = Date.now();

    try {
        // Each step is independent. A guest (or a moment before the migration
        // has been applied) makes the server-side calls fail, and one failure
        // must not abandon the rest of the refresh — the local views below still
        // have real work to do.
        const safe = (p) => Promise.resolve(p).catch((e) => {
            console.warn('Refresh step failed:', e);
            return null;
        });

        const jobs = [];

        // Live profile balance. Authoritative for a signed-in player; a guest
        // just re-renders whatever it has locally.
        if (typeof refreshWalletFromServer === 'function') {
            jobs.push(safe(refreshWalletFromServer()));
        }

        // Active duels belonging to this player.
        if (typeof renderActiveChallenges === 'function') {
            jobs.push(safe(renderActiveChallenges()));
        }

        // Open challenges other players can accept.
        if (typeof loadPendingBets === 'function') {
            jobs.push(safe(loadPendingBets()));
        }

        // Community feed.
        jobs.push(safe(fetchLiveFeed(options)));

        await Promise.all(jobs);

        // Re-render the wallet ledger, since the balance refresh may have
        // settled a duel that added a transaction row.
        if (typeof renderWalletTransactions === 'function') safe(renderWalletTransactions());
        if (typeof updatePracticeDashboard === 'function') safe(updatePracticeDashboard());

        if (isFeedViewVisible() && typeof renderHomeFeed === 'function') safe(renderHomeFeed());

        setRefreshVisual(false, { ok: true });
        const okBtn = document.getElementById('btn-refresh');
        if (okBtn) delete okBtn.dataset.lastError;
        if (!options.silent) flashRefreshToast('Up to date');
    } catch (e) {
        console.warn('Refresh failed:', e);
        const btn = document.getElementById('btn-refresh');
        // Surface the reason on the button itself. A silent "could not refresh"
        // with no way to tell a network blip from a real fault is impossible
        // to debug from a phone.
        if (btn) btn.dataset.lastError = (e && (e.message || e.code || e)) || 'unknown';
        // A failed refresh must never leave the spinner running.
        setRefreshVisual(false, { ok: false });
        if (!options.silent) flashRefreshToast('Could not refresh. Pull again.');
    } finally {
        // Never snap back instantly — a sub-frame flash reads as a glitch.
        const elapsed = Date.now() - startedAt;
        if (elapsed < 450) await new Promise(r => setTimeout(r, 450 - elapsed));
        LIVE.refreshing = false;
        setRefreshLabel();
    }
}

// Manual refresh entry point for the nav bar button.
function manualRefresh() {
    if (LIVE.refreshing) return;
    refreshAllData({ silent: false });
}

// ── refresh visuals ──────────────────────────────────────────────────────────
function setRefreshLabel(text) {
    const label = document.getElementById('nav-refresh-label');
    if (label) label.textContent = text || '';
}

// The header reload button is gone, so this only has to keep the pull
// indicator in sync. It is written defensively because a stale cached page can
// still contain the old button.
function setRefreshVisual(busy, result) {
    const btn = document.getElementById('btn-refresh');
    const icon = document.getElementById('btn-refresh-icon');
    if (btn) {
        btn.classList.toggle('is-refreshing', Boolean(busy));
        btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (icon) {
        if (busy) {
            icon.classList.add('fa-spin');
        } else {
            icon.classList.remove('fa-spin');
        }
    }
    setPullIndicator(busy ? 'loading' : (result ? 'done' : ''));
}

let refreshToastTimer = null;
function flashRefreshToast(message) {
    let toast = document.getElementById('refresh-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'refresh-toast';
        toast.className = 'refresh-toast';
        document.getElementById('app-container')?.appendChild(toast);
    }
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(refreshToastTimer);
    refreshToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

// ── pull-to-refresh gesture ──────────────────────────────────────────────────
// #main-scroll-area is the only scrollable element in the app, so the listener
// lives there, but the gesture is armed only while one of the data screens is
// showing. On Games, Rewards or Profile a downward swipe is just a scroll, and
// refreshing the wallet and feed underneath them would be wasted work.
//
// It also only arms at scrollTop === 0, otherwise pulling down while scrolling
// up would trigger a refresh in the middle of the feed.
const PULL = {
    startY: 0,
    startScroll: 0,
    pulling: false,
    armed: false,
    distance: 0,
    THRESHOLD: 60,   // px of *movement* needed to fire the refresh
    MAX: 110
};

// Screens whose content comes from the server and can meaningfully change
// while the app is open.
const PULL_REFRESH_VIEWS = ['home', 'wallet', 'friends'];

function activeViewId() {
    const visible = document.querySelector('[id^="view-"]:not(.hidden)');
    return visible ? visible.id.replace(/^view-/, '') : '';
}

function isPullRefreshView() {
    return PULL_REFRESH_VIEWS.includes(activeViewId());
}

function setPullIndicator(state) {
    const el = document.getElementById('pull-indicator');
    if (!el) return;
    el.dataset.state = state || '';
    el.classList.toggle('is-active', Boolean(state));
    el.classList.toggle('is-dragging', state === 'ready');
    if (!state) {
        // Animate back up, then drop the transition so the next drag is direct.
        el.classList.add('is-settling');
        el.style.transform = 'translateY(0px)';
        const arrow = el.querySelector('.pull-arrow');
        if (arrow) arrow.style.transform = '';
        clearTimeout(el._settleTimer);
        el._settleTimer = setTimeout(() => el.classList.remove('is-settling'), 240);
    }
}

function onPullStart(e) {
    const area = document.getElementById('main-scroll-area');
    PULL.armed = false;
    PULL.pulling = false;
    PULL.startY = 0;
    PULL.distance = 0;
    if (!area || area.scrollTop > 2) return;
    if (LIVE.refreshing) return;
    if (!isPullRefreshView()) return;
    // Ignore multi-touch: a pinch must never start a refresh.
    if (e.touches && e.touches.length > 1) return;
    PULL.armed = true;
    PULL.startY = e.touches[0].clientY;
    PULL.startScroll = area.scrollTop;
}

function onPullMove(e) {
    if (!PULL.armed) return;
    const area = document.getElementById('main-scroll-area');
    if (!area) return;

    const dy = e.touches[0].clientY - PULL.startY;
    if (dy <= 0 || area.scrollTop > 2) {
        PULL.pulling = false;
        setPullIndicator('');
        return;
    }

    if (!PULL.pulling) {
        // Only claim the gesture once it is unambiguously a downward drag, so
        // normal vertical scrolling keeps working.
        PULL.pulling = true;
        setPullIndicator('ready');
    }

    // Rubber-band: the further you pull the less the content moves, so the
    // gesture never feels like it can be dragged forever.
    PULL.distance = Math.min(PULL.MAX, dy * 0.55);

    const indicator = document.getElementById('pull-indicator');
    if (indicator) {
        indicator.classList.remove('is-settling');
        const progress = Math.min(1, PULL.distance / PULL.THRESHOLD);
        indicator.style.transform = `translateY(${PULL.distance}px)`;
        // The arrow fills in as the threshold approaches, and flips to "release
        // to refresh" once it is reached — the same cue native apps use.
        indicator.dataset.state = progress >= 1 ? 'armed' : 'ready';
        const spinner = indicator.querySelector('.pull-arrow');
        if (spinner) spinner.style.transform = `rotate(${progress * 180}deg)`;
    }

    // Once armed, stop the page from scrolling underneath the gesture.
    if (e.cancelable) e.preventDefault();
}

function onPullEnd() {
    PULL.armed = false;
    if (!PULL.pulling) { PULL.startY = 0; return; }
    const reached = PULL.distance >= PULL.THRESHOLD;
    PULL.pulling = false;
    PULL.startY = 0;
    PULL.distance = 0;

    const indicator = document.getElementById('pull-indicator');
    if (indicator) indicator.style.transform = 'translateY(0px)';

    if (reached) {
        setPullIndicator('loading');
        refreshAllData({ silent: true });
        flashRefreshToast('Refreshing…');
    } else {
        setPullIndicator('');
    }
}

function initPullToRefresh() {
    const area = document.getElementById('main-scroll-area');
    if (!area || area.dataset.pullBound === 'true') return;
    area.dataset.pullBound = 'true';
    // touchmove is non-passive so preventDefault() actually blocks scroll.
    area.addEventListener('touchstart', onPullStart, { passive: true });
    area.addEventListener('touchmove', onPullMove, { passive: false });
    area.addEventListener('touchend', onPullEnd, { passive: true });
    area.addEventListener('touchcancel', onPullEnd, { passive: true });
}

// ── realtime ─────────────────────────────────────────────────────────────────
function handleFeedInsert(row) {
    const post = normalizeRemotePost(row);
    if (!post) return;
    if (post.userId && post.userId === currentUser()?.id) {
        // My own post. It is already on my feed optimistically; only make sure
        // the server's likes count (0) does not clobber the optimistic state.
        return;
    }
    const changed = mergeRemoteFeedPosts([{ ...row, likes: 0 }]);
    if (!changed) return;
    if (isFeedViewVisible() && typeof renderHomeFeed === 'function') renderHomeFeed();
    announceLiveActivity(post);
}

function announceLiveActivity(post) {
    let banner = document.getElementById('live-activity-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'live-activity-banner';
        banner.className = 'live-activity-banner';
        document.getElementById('app-container')?.appendChild(banner);
    }
    if (!banner) return;

    const icon = post.type === 'duel' ? 'fa-swords'
        : post.type === 'win' ? 'fa-trophy'
        : 'fa-bolt';
    const label = post.type === 'duel' ? 'New 1v1 challenge'
        : post.type === 'win' ? `${post.author} just won`
        : `${post.author} posted`;

    banner.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeFeedText(label)}</span>`;
    banner.classList.add('is-visible');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.classList.remove('is-visible'), 3200);
}

function escapeFeedText(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function startLiveActivity() {
    if (LIVE.started) return;
    const client = liveClient();
    if (!client || typeof client.channel !== 'function') return;
    LIVE.started = true;

    // Prime the feed once, then let the socket keep it current.
    fetchLiveFeed();

    try {
        const channel = client
            // One channel for the whole community view. The three tables are
            // what make up "live activity": posts, duels, money movements.
            .channel('oddzone:live-community', {
                config: { broadcast: { self: true } }
            })
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'feed_posts' },
                (payload) => handleFeedInsert(payload.new))
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'feed_posts' },
                (payload) => {
                    // A like count or an edited post.
                    if (mergeRemoteFeedPosts([payload.new]) && isFeedViewVisible()
                        && typeof renderHomeFeed === 'function') {
                        renderHomeFeed();
                    }
                })
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'feed_posts' },
                (payload) => {
                    const postId = payload.old?.id;
                    if (!postId) return;
                    removeRemoteFeedPost(postId);
                    if (isFeedViewVisible() && typeof renderHomeFeed === 'function') renderHomeFeed();
                })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'stake_challenges' },
                async (payload) => {
                    const row = payload.new || {};
                    let uid = currentUser()?.id;
                    if (!uid && client.auth) {
                        const { data } = await client.auth.getSession();
                        uid = data?.session?.user?.id;
                    }
                    // A duel that is not mine still changes the open board.
                    if (uid && row.user_id && row.user_id !== uid && row.opponent_id !== uid) {
                        if (typeof loadPendingBets === 'function') loadPendingBets();
                        return;
                    }
                    if (typeof renderActiveChallenges === 'function') renderActiveChallenges();
                    if (typeof loadPendingBets === 'function') loadPendingBets();
                    if (row.status === 'matched' && typeof refreshWalletFromServer === 'function') {
                        refreshWalletFromServer();
                    }
                })
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'transactions' },
                () => {
                    // RLS restricts this to the owner's own ledger rows, so
                    // this only ever fires for the signed-in player — but it is
                    // how the balance and wallet page stay live without polling.
                    if (typeof refreshWalletFromServer === 'function') refreshWalletFromServer();
                    if (typeof renderWalletTransactions === 'function') renderWalletTransactions();
                })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    LIVE.lastEventAt = Date.now();
                    setLiveIndicator(true);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    setLiveIndicator(false);
                    console.warn('Live activity channel:', status);
                }
            });

        LIVE.channel = channel;
    } catch (e) {
        LIVE.started = false;
        console.warn('Could not start live activity:', e);
    }
}

function stopLiveActivity() {
    if (LIVE.channel) {
        try { liveClient()?.removeChannel(LIVE.channel); } catch (e) {}
        LIVE.channel = null;
    }
    LIVE.started = false;
    setLiveIndicator(false);
}

function setLiveIndicator(online) {
    const dot = document.getElementById('live-status-dot');
    if (dot) {
        dot.classList.toggle('is-live', Boolean(online));
        dot.title = online ? 'Live — updates arrive instantly' : 'Reconnecting…';
    }
}

// ── visibility / focus ───────────────────────────────────────────────────────
// A phone browser drops the websocket while the app is backgrounded, so coming
// back to the tab must re-sync rather than show a stale screen.
function initLiveResume() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!isSignedIn() && !getSocialFeedPosts) return;
        startLiveActivity();
        refreshAllData({ silent: true });
    });
    window.addEventListener('focus', () => {
        if (document.visibilityState === 'visible') refreshAllData({ silent: true });
    });
    // Cheap safety net: if the socket silently died without firing an event,
    // a periodic sync repairs it. A live socket makes this a no-op in practice
    // because nothing has changed, but it re-sends SUBSCRIBED if it lapsed.
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (!isSignedIn()) return;
        const stale = Date.now() - LIVE.lastEventAt > 5 * 60 * 1000;
        if (stale) startLiveActivity();
    }, 60000);
}

// ── boot ─────────────────────────────────────────────────────────────────────
// The globals are published BEFORE init runs. If init threw, an assignment
// placed after it would never execute and every inline onclick handler in
// index.html would break with "not a function" — so the ordering here is
// load-bearing, not cosmetic.
window.refreshAllData = refreshAllData;
window.manualRefresh = manualRefresh;
window.fetchLiveFeed = fetchLiveFeed;
window.broadcastFeedPost = broadcastFeedPost;
window.deleteRemoteFeedPost = deleteRemoteFeedPost;
window.syncFeedLike = syncFeedLike;
window.startLiveActivity = startLiveActivity;
window.stopLiveActivity = stopLiveActivity;
window.feedTimeLabel = feedTimeLabel;
window.getLiveState = () => LIVE;

function initLiveActivity() {
    // Each step is isolated: the auth screen has no activeUser and no signed-in
    // session yet, and a failure in one must not stop the others from working.
    try { initPullToRefresh(); } catch (e) { console.warn('Pull-to-refresh init failed:', e); }
    try { initLiveResume(); } catch (e) { console.warn('Live resume init failed:', e); }
    try { startLiveActivity(); } catch (e) { console.warn('Live activity init failed:', e); }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiveActivity);
    } else {
        initLiveActivity();
    }
}

// Globals for the inline onclick handlers and for matchmaking.js.
// (Published above, before init — see the note in the boot section.)
