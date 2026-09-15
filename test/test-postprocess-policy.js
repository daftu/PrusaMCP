import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runPrusaSlicer } from '../build/prusa-cli.js';
import { registerSlice } from '../build/tools/slice.js';
import { loadConfig } from '../build/config.js';
import { fixture } from './slice-fixtures.js';

test('runner overrides loaded scripts, closes stdin, and uses only configured selected command', async t => {
  const f = await fixture(t);
  const script = join(f.dir, 'inspect.mjs');
  await writeFile(script, `let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(2),input})));`);
  const config = { executablePath: process.execPath, profilesDir: '', trustedScripts: { marker: '/approved/script --fixed' } };
  const args = [script, '--load', '/fixture/imported.ini', '/fixture/project.3mf'];
  const disabled = await runPrusaSlicer(config, args);
  assert.equal(disabled.exitCode, 0);
  assert.deepEqual(JSON.parse(disabled.stdout), { args: [...args.slice(1), '--post-process', ''], input: '' });
  const trusted = await runPrusaSlicer(config, args, undefined, 'marker');
  assert.equal(trusted.exitCode, 0);
  // The runner redacts the administrator command in returned native diagnostics.
  assert.deepEqual(JSON.parse(trusted.stdout), { args: [...args.slice(1), '--post-process', '"[trusted script marker]"'], input: 'Y\n' });
});

test('actual MCP boundary rejects unknown IDs and raw command fields before runner', async t => {
  const f = await fixture(t);
  let calls = 0;
  const server = new McpServer({ name: 'policy-test', version: '1' });
  const client = new Client({ name: 'policy-client', version: '1' });
  registerSlice(server, { executablePath: 'fixture', profilesDir: '', trustedScripts: { marker: '/approved/script' } }, async () => { calls++; throw Error('must not run'); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  for (const attempt of [{ trusted_script_id: 'unknown' }, { trusted_script_id: 'touch /tmp/arbitrary' }, { command: 'touch /tmp/arbitrary' }, { post_process: 'touch /tmp/arbitrary' }]) {
    const r = await client.callTool({ name: 'slice_prusaslicer', arguments: { stl_path: f.input, ...attempt } });
    assert.equal(r.isError, true);
  }
  assert.equal(calls, 0);
  const direct = await runPrusaSlicer({ executablePath: process.execPath, profilesDir: '' }, [], undefined, 'unknown');
  assert.equal(direct.errorCode, 'unknown_trusted_script');
});

test('administrator environment map loads and rejects non-command values', t => {
  const previous = process.env.PRUSASLICER_TRUSTED_SCRIPTS;
  t.after(() => { if (previous === undefined) delete process.env.PRUSASLICER_TRUSTED_SCRIPTS; else process.env.PRUSASLICER_TRUSTED_SCRIPTS = previous; });
  process.env.PRUSASLICER_TRUSTED_SCRIPTS = '{"marker":"/approved/script --fixed"}';
  assert.deepEqual(loadConfig().trustedScripts, { marker: '/approved/script --fixed' });
  process.env.PRUSASLICER_TRUSTED_SCRIPTS = '{"marker":42}';
  assert.throws(() => loadConfig());
});

test('spawn failure redacts the serialized configured command', async t => {
  const f = await fixture(t);
  const command = '"/approved path/script" --token "fixture-secret"';
  const r = await runPrusaSlicer({ executablePath: join(f.dir, 'missing'), profilesDir: '', trustedScripts: { marker: command } }, [], undefined, 'marker');
  assert.equal(r.errorCode, 'spawn_failed');
  assert.doesNotMatch(r.stderr, /fixture-secret|approved path/);
  assert.match(r.stderr, /ENOENT/);
});

test('process timeout remains a failure and redacts its command diagnostic', async t => {
  const f = await fixture(t);
  const script = join(f.dir, 'wait.mjs');
  await writeFile(script, 'setTimeout(() => {}, 30000);');
  const r = await runPrusaSlicer({ executablePath: process.execPath, profilesDir: '', trustedScripts: { marker: '"/approved path/script" --token "fixture-secret"' } }, [script], 100, 'marker');
  assert.equal(r.exitCode, 1);
  assert.equal(r.errorCode, 'process_timeout');
  assert.doesNotMatch(r.stderr, /fixture-secret|approved path/);
});
