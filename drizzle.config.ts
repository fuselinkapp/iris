import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: {
    url: '.iris/iris.db',
  },
  strict: true,
  verbose: true,
});
