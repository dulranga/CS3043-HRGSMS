import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const PG_URL = process.env.PG_URL;

if (!PG_URL) {
  throw new Error('PG_URL environment variable is not set. Please configure your database connection URL.');
}

export const pool = new Pool({
  connectionString: PG_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Event handlers for pool
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Test connection on startup
export async function initializeDatabase(): Promise<void> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connection verified:', result.rows[0].now);
    client.release();
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    process.exit(1);
  }
}
