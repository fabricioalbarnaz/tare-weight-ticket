import { createDb } from './client.js';
import { parseArgs, seedAdminUser } from './seed-admin.js';

const { username, password } = parseArgs(process.argv.slice(2));
const dbPath = process.env.DB_PATH ?? './data/tare.sqlite';

const { db, sqlite } = createDb(dbPath);
try {
  const { created } = seedAdminUser(db, username, password);
  console.log(
    created ? `Created admin user "${username}".` : `Updated password for admin user "${username}".`,
  );
} finally {
  sqlite.close();
}
