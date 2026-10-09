import assert from 'node:assert/strict';
import { createConnection, createServer, Socket } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

test('application pool connects when PostgreSQL negotiation takes more than two seconds', { timeout: 30000 }, async () => {
  // This proxy delays a real PostgreSQL connection, preserving the original
  // host for TLS verification. It performs only SELECT, with no schema/data writes.
  const { pool } = await import('../src/db');
  const target = new URL(process.env.PG_URL!);
  const sockets = new Set<Socket>();
  const gateway = createServer((downstream) => {
    sockets.add(downstream);
    downstream.pause();
    const delay = setTimeout(() => {
      if (downstream.destroyed) return;
      const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
      sockets.add(upstream);
      upstream.on('error', () => downstream.destroy());
      upstream.on('close', () => { sockets.delete(upstream); downstream.destroy(); });
      downstream.on('close', () => upstream.destroy());
      upstream.on('connect', () => {
        downstream.pipe(upstream);
        upstream.pipe(downstream);
        downstream.resume();
      });
    }, 2500);
    downstream.on('error', () => undefined);
    downstream.on('close', () => { clearTimeout(delay); sockets.delete(downstream); });
  });
  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const address = gateway.address();
  assert.ok(address && typeof address !== 'string');
  const stream = () => {
    const socket = new Socket();
    const connect = socket.connect.bind(socket);
    // pg supplies the original host/port; route only the transport through
    // the delay gateway so SSL and all application pool settings stay intact.
    socket.connect = (() => connect(address.port, '127.0.0.1')) as typeof socket.connect;
    return socket;
  };
  const oldPool = new Pool({ ...pool.options, stream, connectionTimeoutMillis: 2000 });
  const appPool = new Pool({ ...pool.options, stream });
  try {
    await assert.rejects(oldPool.query('SELECT 1 AS connected'), /timeout/i,
      'the original two-second limit rejects a healthy but delayed connection');
    assert.equal((await appPool.query('SELECT 1 AS connected')).rows[0].connected, 1,
      'the application connection window accepts the same delayed database');
  } finally {
    await Promise.all([oldPool.end(), appPool.end(), pool.end()]);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  }
});
