const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = process.argv[2];
if (target && !['frontend', 'backend'].includes(target)) throw new Error('Choose frontend or backend.');
for (const workspace of target ? [target] : ['frontend', 'backend']) {
  const cwd = path.join(root, workspace);
  const env = { ...process.env };
  if (workspace === 'backend') {
    const envFile = path.join(cwd, '.env');
    const configured = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
    Object.assign(env, configured, process.env);
    const connection = env.PG_TEST_URL || env.PG_URL;
    if (!connection) throw new Error('Backend tests require PG_TEST_URL or PG_URL (environment or backend/.env).');
    const url = new URL(connection);
    // The isolated suites and migration runner rely on session state.
    url.hostname = url.hostname.replace('-pooler.', '.');
    if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
    env.PG_URL = url.toString();
    env.PG_TEST_URL = url.toString();
  }
  const files = fs.readdirSync(path.join(cwd, 'tests')).filter(name => /\.test\.(?:ts|tsx|cjs)$/.test(name)).sort().map(name => `tests/${name}`);
  console.log(`Testing ${workspace}: ${files.length} files`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-timeout=600000', '--test-concurrency=3', ...files], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
