const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { Client, Pool } = require('pg');
const { loadMigrations } = require('../../src/migrations/migrate');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function isolatedDatabase() {
  const url = new URL(process.env.PG_TEST_URL || process.env.PG_URL);
  // Session search_path and concurrent clients require a direct connection.
  url.hostname = url.hostname.replace('-pooler.', '.');
  const schema = `qa_${randomBytes(10).toString('hex')}`;
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000 });
  await client.connect();
  let db;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const migrations = loadMigrations(path.join(__dirname, '../../migrations'));
    await client.query(migrations.map(m => m.sql).join('\n'));
    await client.query('COMMIT');
    await client.query(`SET search_path TO "${schema}"`);
    db = new Pool({ connectionString: url.toString(), options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 15000 });
    return { client, db, schema, migrations, async close() {
      await db.end();
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await db?.end();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await client.end();
    throw error;
  }
}
module.exports = { isolatedDatabase };
