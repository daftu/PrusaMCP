import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliDetector, parseCliHelp } from '../build/capabilities.js';

const fixture = name => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const help = fixture('help-2.9.6.txt');
const fff = fixture('help-fff-2.9.6.txt');
const sla = fixture('help-sla-2.9.6.txt');

test('stock 2.9.6 help advertises export, transforms, FFF and SLA', () => {
  const result = parseCliHelp('/synthetic/PrusaSlicer', help, fff, sla);
  assert.equal(result.version, '2.9.6');
  assert.equal(result.tested_version, true);
  assert.deepEqual(result.technologies, { FFF: true, SLA: true });
  for (const action of ['--export-3mf', '--export-gcode', '--export-sla', '--export-stl']) {
    assert.ok(result.actions.includes(action), action);
  }
  for (const transform of ['--rotate', '--scale', '--duplicate-grid', '--cut']) {
    assert.ok(result.transforms.includes(transform), transform);
  }
});

test('missing executable and diagnostic timeout are explicit unavailable states', async () => {
  const missing = await createCliDetector(async () => { throw new Error('runner must not be called'); })('');
  assert.equal(missing.state, 'unavailable');
  assert.equal(missing.error_code, 'executable_missing');
  const root = mkdtempSync(join(tmpdir(), 'prusa-cli-capabilities-'));
  try {
    const binary = join(root, 'PrusaSlicer');
    writeFileSync(binary, 'synthetic binary');
    const args = [];
    const timeout = await createCliDetector(async (_executable, argv) => {
      args.push(argv[0]);
      return { exitCode: 1, stdout: '', stderr: '', errorCode: 'diagnostic_timeout' };
    })(binary);
    assert.equal(timeout.state, 'unavailable');
    assert.equal(timeout.error_code, 'diagnostic_timeout');
    assert.deepEqual(args, ['--help']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('path and binary content changes cause a new probe without carrying 2.9.6 claims forward', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prusa-cli-capabilities-'));
  try {
    const firstBinary = join(root, 'first');
    const secondBinary = join(root, 'second');
    writeFileSync(firstBinary, 'version one');
    writeFileSync(secondBinary, 'version two');
    const calls = [];
    const detector = createCliDetector(async (executable, argv) => {
      calls.push([executable, argv[0]]);
      const version = readFileSync(executable, 'utf8') === 'version one' ? '2.9.6' : '2.9.7';
      const text = argv[0] === '--help' ? help.replace('PrusaSlicer-2.9.6', `PrusaSlicer-${version}`) : argv[0] === '--help-fff' ? fff : sla;
      return { exitCode: 0, stdout: text, stderr: '' };
    });
    const first = await detector(firstBinary);
    assert.equal(first.version, '2.9.6');
    assert.equal(first.tested_version, true);
    await detector(firstBinary);
    assert.equal(calls.length, 3, 'unchanged binary uses the cached probe');
    const second = await detector(secondBinary);
    assert.equal(second.version, '2.9.7');
    assert.equal(second.tested_version, false);
    assert.equal(calls.length, 6, 'a different path is probed');
    writeFileSync(firstBinary, 'version two');
    const changed = await detector(firstBinary);
    assert.equal(changed.version, '2.9.7');
    assert.equal(changed.tested_version, false);
    assert.equal(calls.length, 9, 'changed bytes at the same path are probed');
    assert.ok(changed.limitations.some(item => item.includes('not been validated')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
