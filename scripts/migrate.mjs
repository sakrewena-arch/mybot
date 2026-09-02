import 'dotenv/config';
import { execSync } from 'node:child_process';

/**
 * Pre-start migration runner.
 *
 * - Checks that DATABASE_URL is defined and gives a clear, actionable message
 *   when it is missing (this is the #1 cause of Railway/Render deploy crashes).
 * - Runs `prisma migrate deploy` so the tables are created/updated before the
 *   bot starts.
 */
const dbUrl = (process.env.DATABASE_URL ?? '').trim();

if (!dbUrl) {
  console.error('\n✖ DATABASE_URL is not defined.\n');
  console.error('  Local:     copy .env.example to .env and fill DATABASE_URL.');
  console.error('  Railway:   create a PostgreSQL database and LINK it to this service,');
  console.error('             or set the DATABASE_URL variable in the service environment.');
  console.error('             Service → Variables → New Variable → Add Reference');
  console.error('             → select your PostgreSQL → DATABASE_URL.');
  console.error('  Render:    link the PostgreSQL instance (DATABASE_URL is injected).');
  console.error('\nThe bot cannot start without a database.\n');
  process.exit(1);
}

console.log('Applying database migrations…');
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
} catch (error) {
  console.error('\n✖ Migration failed. DATABASE_URL is defined but Prisma could not connect.');
  console.error('  Check the URL, the credentials and that the database is reachable.\n');
  process.exit(1);
}

process.exit(0);