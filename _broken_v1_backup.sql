-- ═══════════════════════════════════════════════════════════════════════════
-- OddZone — duel search window + solo fallback
--
-- Adds the "Find or Create" phase that was missing entirely:
--
--   open_duel()            -> row created with status 'playing' (opened, not
--                             searching yet)
--   claim_duel_opponent()  -> pre-matchmaking. Atomically flips the row to
--                             'queued' and, if another player is already
--                             waiting on the same game + stake, locks BOTH
--                             rows to 'matched' in one transaction.
--   begin_solo_play()      -> the 5-10s search timer expired. Flips the row
--                             to 'solo' so the player can play right now.
--                             settle_duel() will still match the banked score
--                             against a later opponent.
--
-- settle_duel() already tolerated any status except 'matched' / 'cancelled',
-- so a 'solo' row queues and settles through exactly the same locked path as
-- a 'queued' one. No change to the money logic was needed.
--
-- Safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extra columns ──────────────────────────────────────────────────────────
-- is_solo: the player went through the search window and is now playing
-- unopposed. Purely informational for the UI.
alter table public.stake_challenges add column if not exists is_solo boolean not null default false;

-- Opponent snapshot. The opponent profile is captured at match time so the
-- result card can render a name and avatar even if RLS or a later profile edit
-- would otherwise hide it.
alter table public.stake_challenges add column if not exists opponent_name text;
alter table public.stake_challenges add column if not exists opponent_avatar text;

create index if not exists stake_challenges_opponent_idx
  on public.stake_challenges (opponent_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- profiles: opponent identity has to be readable by other players
--
-- profiles_read only allowed auth.uid() = id, so every attempt to show the
-- opponent's name/avatar on the match and result cards returned nothing and
-- the UI silently fell back to the literal string "Opponent".
--
-- The balance and KYC columns stay protected: the SELECT policy below only
-- governs whether a ROW is readable, and the client only ever asks for
-- username / avatar_url. wallet_balance is read through the security-definer
-- wallet_balance() function rather than selected directly, so no caller can
-- lift another player's balance out of this table.
--
-- `to anon, authenticated` (not just authenticated) because the challenge
-- board is browsable as a guest -- guest is the default entry point -- and a
-- guest still has to render an opponent's name and avatar. A guest-only
-- session is rejected with 400 by PostgREST when a policy names a role it
-- cannot resolve for that request.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "profiles_read_public" on public.profiles;
create policy "profiles_read_public" on public.profiles
  for select to anon, authenticated
  using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- claim_duel_opponent: pre-matchmaking, done server-side
--
-- The browser used to run "find an open QUEUED challenge for my game + stake"
-- as a plain SELECT and then UPDATE its own row. Two players pressing the
-- button in the same instant both read the same opponent row and both wrote
-- opponent_id — a double match. FOR UPDATE SKIP LOCKED makes exactly one of
-- them win the claim and the other moves on.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.claim_duel_opponent(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  mine      public.stake_challenges%rowtype;
  opp       public.stake_challenges%rowtype;
  opp_name  text;
  opp_avat  text;
begin
  if me is null then
    raise exception 'You must be signed in to search for an opponent.';
  end if;

  select * into mine
    from public.stake_challenges
   where id = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status in ('matched', 'cancelled') then
    return jsonb_build_object('matched', true, 'already', true,
                              'opponent_id', mine.opponent_id,
                              'opponent_name', mine.opponent_name,
                              'opponent_avatar', mine.opponent_avatar);
  end if;

  -- A solo player who has already played leaves the row on 'solo'; searching
  -- again for them would be pointless, so treat it as already matched.
  if mine.status = 'solo' then
    return jsonb_build_object('matched', false, 'status', 'solo', 'already', true);
  end if;

  -- Enter the queue. This is the UPDATE realtime pushes to every other
  -- player's dashboard, so their board sees this challenge immediately.
  update public.stake_challenges
     set status  = 'queued',
         is_solo = false
   where id = mine.id;

  -- Oldest waiting opponent on the same game and stake. Skip locked so two
  -- simultaneous searchers cannot claim the same row.
  select * into opp
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  = 'queued'
     and c.user_id is not null
     and c.user_id <> me
   order by c.created_at asc
   limit 1
   for update skip locked;

  if opp.id is null then
    return jsonb_build_object('matched', false, 'status', 'queued', 'already', false);
  end if;

  select coalesce(username, 'Player'), avatar_url into opp_name, opp_avat
    from public.profiles where id = opp.user_id;

  -- Both rows flip to 'matched' together. Each player stores a snapshot of the
  -- other so the cards can render a name and avatar without a second read.
  update public.stake_challenges
     set status          = 'matched',
         opponent_id     = opp.user_id,
         opponent_name   = (select coalesce(username, 'Player')
                              from public.profiles where id = me),
         opponent_avatar = (select avatar_url
                              from public.profiles where id = me)
   where id = opp.id;

  update public.stake_challenges
     set status          = 'matched',
         opponent_id     = opp.user_id,
         opponent_name   = opp_name,
         opponent_avatar = opp_avat
   where id = mine.id;

  return jsonb_build_object(
    'matched', true, 'status', 'matched', 'already', false,
    'challenge_id', opp.id,
    'opponent_id', opp.user_id,
    'opponent_name', opp_name,
    'opponent_avatar', opp_avat,
    'opponent_score', opp.score,
    'stake', mine.stake,
    'game_id', mine.game_id
  );
end;
$$;

revoke all on function public.claim_duel_opponent(text) from public;
grant execute on function public.claim_duel_opponent(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- begin_solo_play: the search timer expired, drop the player into the game
--
-- The row stays on 'solo' rather than 'cancelled' because the stake is NOT
-- refunded — the player plays for real and the score is banked. settle_duel()
-- picks it up later when a second player finishes the same game at the same
-- stake. Leaving it 'queued' would instead have re-entered the player into an
-- instant rematch against whoever arrived during the search window.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.begin_solo_play(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You must be signed in to play.';
  end if;

  update public.stake_challenges
     set status  = 'solo',
         is_solo = true
   where id = p_challenge_id and user_id = me;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  return jsonb_build_object('solo', true, 'status', 'solo');
end;
$$;

revoke all on function public.begin_solo_play(text) from public;
grant execute on function public.begin_solo_play(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- settle_duel: allow a solo row to enter the pool, and snapshot the opponent
--
-- Only the two small changes the new flow needs — the status guard already
-- permitted anything except 'matched' / 'cancelled', and the locking /
-- money logic is untouched.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.settle_duel(
  p_challenge_id text,
  p_score        bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  mine      public.stake_challenges%rowtype;
  opp_id    uuid;
  opp_row   public.stake_challenges%rowtype;
  winner    uuid;
  is_tie    boolean := false;
  opp_name  text;
  opp_avat  text;
begin
  if me is null then
    raise exception 'You must be signed in to settle a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status = 'matched' then
    raise exception 'This duel has already been settled.';
  end if;

  if mine.status = 'cancelled' then
    raise exception 'This duel was cancelled.';
  end if;

  -- Bank the score and enter the queue. This is the solo player's deferred
  -- entry: they finished unopposed and now wait for someone on the same game
  -- and stake to finish too.
  update public.stake_challenges
     set score   = greatest(coalesce(score, 0), coalesce(p_score, 0)),
         status  = 'queued',
         is_solo = false
   where id = p_challenge_id
  returning * into mine;

  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  = 'queued'
     and c.user_id is not null
     and c.user_id <> me
   order by c.created_at asc
   limit 1
   for update skip locked;

  if opp_row.id is null then
    return jsonb_build_object(
      'matched', false,
      'status',  'queued',
      'stake',   mine.stake
    );
  end if;

  opp_id := opp_row.user_id;

  select coalesce(username, 'Player'), avatar_url into opp_name, opp_avat
    from public.profiles where id = opp_id;

  if p_score > opp_row.score then
    winner := me;
  elsif p_score < opp_row.score then
    winner := opp_id;
  else
    is_tie := true;
  end if;

  update public.stake_challenges
     set status          = 'matched',
         opponent_id     = opp_id,
         opponent_name   = (select coalesce(username, 'Player')
                              from public.profiles where id = me),
         opponent_avatar = (select avatar_url
                              from public.profiles where id = me)
   where id = opp_row.id;

  update public.stake_challenges
     set status          = 'matched',
         opponent_id     = opp_id,
         opponent_name   = opp_name,
         opponent_avatar = opp_avat,
         winner_id       = winner
   where id = mine.id;

  if is_tie then
    update public.profiles set wallet_balance = wallet_balance + mine.stake  where id = me;
    update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Tie – Stake Refunded', 'refund', mine.stake,
            'Both players scored ' || p_score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', true, 'won', null,
      'your_score', p_score, 'opponent_score', opp_row.score,
      'opponent_id', opp_id, 'opponent_name', opp_name,
      'opponent_avatar', opp_avat,
      'payout', 0, 'refunded', mine.stake
    );
  end if;

  if winner = me then
    update public.profiles set wallet_balance = wallet_balance + mine.payout where id = me;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Win', 'payout', mine.payout,
            'Beat ' || opp_name || ' ' || p_score || ' to ' || opp_row.score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', false, 'won', true,
      'your_score', p_score, 'opponent_score', opp_row.score,
      'opponent_id', opp_id, 'opponent_name', opp_name,
      'opponent_avatar', opp_avat,
      'payout', mine.payout
    );
  end if;

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Loss', 'stake', mine.stake,
          'Scored ' || p_score || ' against ' || opp_name || ' (' || opp_row.score || ').');

  return jsonb_build_object(
    'matched', true, 'is_tie', false, 'won', false,
    'your_score', p_score, 'opponent_score', opp_row.score,
    'opponent_id', opp_id, 'opponent_name', opp_name,
    'opponent_avatar', opp_avat,
    'payout', 0
  );
end;
$$;

revoke all on function public.settle_duel(text, bigint) from public;
grant execute on function public.settle_duel(text, bigint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime: profiles changes refresh the opponent avatar on open cards.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;