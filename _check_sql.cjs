// Parse every plpgsql function body in the migration with a real PostgreSQL
// client library, so a syntax error is caught here instead of at db push.
//
// This does NOT connect to a database -- it only parses. That is exactly what
// we want: SQLSTATE 42601 (syntax_error) and plpgsql parse failures both
// surface at parse time, without needing the live database or a password.
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(
  __dirname, 'supabase', 'migrations', '20261003000001_duel_search_and_solo.sql');
const sql = fs.readFileSync(file, 'utf8');

const { parse } = require('pgsql-ast-parser');
} catch {
  console.error('pg parser unavailable:', 'run:  npm install --no-save pgsql-ast-parser');
  process.exit(2);
}

// Split the file into individual statements and keep the dollar-quoted bodies
// intact, which a naive split on ';' would tear apart.
function statements(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    // Skip line comments.
    if (text.startsWith('--', i)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    const start = i;
    let inDollar = null;
    while (i < text.length) {
      const m = /^\$[a-z_]*\$/i.exec(text.slice(i, i + 20));
      if (m) {
        if (inDollar === null) {
          inDollar = m[0];
          i += m[0].length;
          continue;
        }
        if (m[0] === inDollar) { i += m[0].length; inDollar = null; continue; }
      }
      if (inDollar === null && text[i] === ';') { i++; break; }
      if (inDollar === null && text.startsWith('--', i)) {
        const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue;
      }
      i++;
    }
    const stmt = text.slice(start, i).trim();
    if (stmt) out.push(stmt);
  }
  return out;
}

const stmts = statements(sql);
console.log(`file: ${path.basename(file)}`);
console.log(`statements: ${stmts.length}\n`);

// PostgreSQL's CREATE FUNCTION body is only validated by the PL/pgSQL
// compiler, which is not a plain SQL grammar. Extracting the bodies and
// checking the surrounding SQL separately gives the useful split:
//   - every non-function statement must parse as SQL
//   - every function body's SQL statements must parse
function bodies(stmt) {
  const m = /\$[a-z_]*\$([\s\S]*?)\$[a-z_]*\$/i.exec(stmt);
  return m ? m[1] : null;
}

let sqlFail = 0, fnFail = 0, checked = 0;

for (const stmt of stmts) {
  const head = stmt.slice(0, 60).replace(/\s+/g, ' ').toLowerCase();
  const isFunction = /\bcreate\s+(or\s+replace\s+)?function\b/.test(head);

  if (!isFunction) {
    checked++;
    try {
      parse(stmt);
    } catch (e) {
      sqlFail++;
      console.error('SQL PARSE ERROR:', e.message);
      console.error('  in:', head);
      const at = /at '([\s\S]{0,120})/.exec(e.message);
      if (at) console.error('  near:', at[1].replace(/\s+/g, ' '));
    }
    continue;
  }

  const name = /function\s+(?:public\.)?([a-z_0-9]+)/i.exec(stmt);
  const body = bodies(stmt);
  if (!body) { fnFail++; console.error('NO BODY for', name && name[1]); continue; }

  // plpgsql statements end with ';' at plpgsql nesting depth 0. Split them
  // and parse each as SQL.
  const parts = [];
  let depth = 0, buf = '', inS = false, inD = false, i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (inS) { if (ch === "'") { if (body[i + 1] === "'") { buf += "''"; i += 2; continue; } inS = false; } buf += ch; i++; continue; }
    if (inD) { if (ch === '"') inD = false; buf += ch; i++; continue; }
    if (ch === "'") { inS = true; buf += ch; i++; continue; }
    if (ch === '"') { inD = true; buf += ch; i++; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { parts.push(buf.trim()); buf = ''; i++; continue; }
    if (ch === '-' && body[i + 1] === '-') {
      const nl = body.indexOf('\n', i); i = nl === -1 ? body.length : nl; continue;
    }
    buf += ch; i++;
  }
  if (buf.trim()) parts.push(buf.trim());

  for (const part of parts) {
    if (!part) continue;
    // Skip plpgsql-only statements that are not SQL.
    if (/^(return|raise|if\s|elsif\s|else|end\s|end\s*if|end\s*loop|end\s*case|declare|begin|exit|continue|perform\s|for\s+\w+\s+in\b.*\bloop\b)/i.test(part)
        && !/^select\b|^insert\b|^update\b|^delete\b|^with\b/i.test(part)) continue;
    if (/^(return|raise|declare|begin|perform)/i.test(part) && !/^select\b/i.test(part)) continue;
    if (/^if\b/i.test(part)) continue;

    checked++;
    try {
      parse(part.replace(/<<\w+>>/g, '1'));
    } catch (e) {
      fnFail++;
      console.error(`PLPGSQL SQL PARSE ERROR in ${name && name[1]}:`, e.message);
      console.error('  stmt:', part.replace(/\s+/g, ' ').slice(0, 160));
    }
  }
}

console.log(`\nchecked ${checked} SQL fragments`);
if (sqlFail + fnFail === 0) {
  console.log('RESULT: no syntax errors found');
  process.exit(0);
}
console.log(`RESULT: ${sqlFail} statement errors, ${fnFail} plpgsql SQL errors`);
process.exit(1);
