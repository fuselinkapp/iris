import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = resolve(process.cwd(), '.iris/iris.db');
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');

const db = drizzle(sqlite);

migrate(db, { migrationsFolder: resolve(process.cwd(), 'db/migrations') });

console.log(`Migrations applied to ${dbPath}`);
sqlite.close();
