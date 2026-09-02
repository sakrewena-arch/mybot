import 'dotenv/config';
import { execSync } from 'node:child_process';

/**
 * Pre-start bootstrap.
 *
 * - Loads dotenv/.env if present (local dev).
 * - Rebuilds DATABASE_URL from individual PG* variables when it is missing
 *   (Railway sometimes exposes PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT
 *   instead of the full connection string).
 * - Applies `prisma migrate deploy`.
 * - Starts the bot in the SAME process so the resolved DATABASE_URL is
 *   visible to the app and to Prisma Client.
 */

function buildDatabaseUrlFromPgVars() {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? process.env.POSTGRES_USER;
  const db = process.env.PGDATABASE ?? process.env.POSTGRES_DB;
  const password = process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD;

  if (!host || !user || !db) return null;
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : user;
  return `postgresql://${auth}@${host}:${port}/${db}?sslmode=require`;
}

function safeSummary(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(malformed DATABASE_URL)';
  }
}

function resolveDatabaseUrl() {
  const fromUrl = (process.env.DATABASE_URL ?? '').trim();
  if (fromUrl) {
    console.log(`Using DATABASE_URL host: ${safeSummary(fromUrl)}`);
    if (fromUrl.includes('.railway.internal')) {
      console.warn(
        'HINT: postgres.railway.internal only resolves if the bot service and the',
        'database are in the SAME Railway project. Otherwise use the public proxy',
        'host (xxx.up.railway.app) version of the URL.',
      );
    }
    return fromUrl;
  }

  const fromPgVars = buildDatabaseUrlFromPgVars();
  if (fromPgVars) {
    console.log('DATABASE_URL missing — rebuilt from PG* environment variables.');
    process.env.DATABASE_URL = fromPgVars;
    return fromPgVars;
  }

  // Debug aid: show which db-related environment variables are actually present
  // on the host (names only, never values).
  const related = Object.keys(process.env).filter(
    (key) => key === 'DATABASE_URL' || /^(PG|POSTGRES_)/.test(key),
  );
  console.error('\n✖ DATABASE_URL is not defined.\n');
  console.error(`  Database-related env vars found on this host: ${related.length > 0 ? related.join(', ') : '(none — the PostgreSQL is NOT linked to this service)'}\n`);
  console.error('  Railway:   create a PostgreSQL database in the SAME project as this');
  console.error('             service, then add DATABASE_URL as a LITERAL variable:');
  console.error('             Service → Variables → New Variable → paste the connection URL.');
  console.error('             (See README section 10.1 for details and screenshots.)');
  console.error('  Render:    link the PostgreSQL instance (DATABASE_URL is injected).\n');
  process.exit(1);
}

resolveDatabaseUrl();

console.log('Applying database migrations…');
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
} catch {
  console.error('\n✖ Migration failed. DATABASE_URL is defined but Prisma could not connect.');
  console.error('  Check the URL, the credentials and that the database is reachable.\n');
  process.exit(1);
}

console.log('Migrations applied. Starting the bot…');
// `import()` accepts a URL string directly; passing an URL instance to
// pathToFileURL() throws ERR_INVALID_ARG_TYPE on newer Node versions.
await import(new URL('../dist/index.js', import.meta.url).href);