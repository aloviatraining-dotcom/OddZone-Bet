const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'supabase', 'migrations', '20261003000001_duel_search_and_solo.sql');
const raw = fs.readFileSync(p, 'utf8');
const hadCrlf = raw.includes('\r\n');
const lines = raw.replace(/\r\n/g, '\n').split('\n');

// Locate the block by its markers rather than by a fixed offset: the file may
// have shifted since it was written.
const startIdx = lines.findIndex(l => l.includes('-- My paired opponent if claim_duel_opponent()'));
if (startIdx === -1) { console.error('start marker not found'); process.exit(1); }

const endIdx = lines.findIndex((l, i) => i > startIdx && /for update skip locked;/.test(l));
if (endIdx === -1) { console.error('end marker not found'); process.exit(1); }

console.log(`replacing lines ${startIdx + 1}..${endIdx + 1}`);
console.log('--- old block ---');
console.log(lines.slice(startIdx, endIdx + 1).join('\n'));

const replacement = [
    "-- My paired opponent if claim_duel_opponent() already paired us, otherwise the",
    "  -- oldest unpaired player on the same game + stake.",
    "  --",
    "  -- ONE SELECT ordered by priority -- not a UNION ALL.",
    "  --",
    "  -- Two things made the previous UNION ALL version impossible to rescue by",
    "  -- adding parentheses:",
    "  --",
    "  --   1. PostgreSQL rejects row locking on a set operation outright:",
    "  --        ERROR: FOR UPDATE is not allowed with UNION/INTERSECT/EXCEPT",
    "  --      So `for update skip locked` cannot be attached to a UNION at any",
    "  --      level of parenthesisation. That lock is the entire reason this",
    "  --      lookup is safe -- two players finishing at the same instant must",
    "  --      never both claim the same opponent row -- so it has to be a single",
    "  --      scan over one table.",
    "  --",
    "  --   2. \"Paired rows first\" is an ordering, not a branch. A priority integer",
    "  --      in ORDER BY says exactly that in one pass, which is both valid and",
    "  --      cheaper than materialising two branches and merging them.",
    "  --",
    "  -- priority 0 = my already-paired opponent (settle_duel is settling us)",
    "  -- priority 1 = any other unpaired player waiting on the same game + stake",
    "  --",
    "  -- `c.opponent_id is null` on the second branch is what stops a row already",
    "  -- paired with a DIFFERENT player from being stolen by a third player.",
    "  select * into opp_row",
    "    from public.stake_challenges c",
    "   where c.game_id = mine.game_id",
    "     and c.stake   = mine.stake",
    "     -- 'solo' appears on the paired branch only: a solo player who has not",
    "     -- finished yet must stay claimable, or two players who both fell through",
    "     -- the search window could never be paired with each other.",
    "     and (",
    "           (c.opponent_id = mine.opponent_id and c.status in ('queued', 'solo'))",
    "        or (c.opponent_id is null and c.status = 'queued')",
    "     )",
    "     and c.user_id is not null",
    "     and c.user_id <> me",
    "     and c.id::text <> p_challenge_id",
    "   order by",
    "     case when c.opponent_id = mine.opponent_id then 0 else 1 end asc,",
    "     c.created_at asc",
    "   limit 1",
    "     for update skip locked;"
];

lines.splice(startIdx, endIdx - startIdx + 1, ...replacement);

let out = lines.join('\n');
if (hadCrlf) out = out.replace(/\n/g, '\r\n');
fs.writeFileSync(p, out, 'utf8');

// Sanity: no placeholder text and no stray UNION left behind.
const after = fs.readFileSync(p, 'utf8');
const problems = [];
if (/SELECT \.\.\. FROM/i.test(after)) problems.push('placeholder "SELECT ... FROM" still present');
if (/union all/i.test(after)) problems.push('UNION ALL still present');
if (/\(\s*select \* into opp_row/i.test(after)) problems.push('malformed double-paren select');
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'clean: no placeholders, no UNION');
process.exit(problems.length ? 1 : 0);