import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, link, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { registerPostprocessGcode } from '../build/tools/postprocess-gcode.js';

function handler() {
  let run;
  registerPostprocessGcode({ registerTool: (_name, _schema, callback) => { run = callback; } });
  return run;
}
const action = [{ layer: 1, type: 'pause' }];
const original = ';LAYER_CHANGE\nG1 X1 Y2\n';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const name of ['part.gcode', 'part.GCODE', 'part with spaces.gcode']) {
  test(`default output preserves source bytes: ${name}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'postprocess-path-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const input = join(dir, name);
    await writeFile(input, original);
    const before = hash(await readFile(input));
    const result = await handler()({ gcode_path: input, actions: action });
    assert.ok(!result.isError);
    assert.equal(hash(await readFile(input)), before);
    const output = join(dir, `${name.slice(0, -6)}_modified.gcode`);
    assert.equal(result.structuredContent.data.output_path, output);
    assert.match(await readFile(output, 'utf8'), /M601/);
    assert.deepEqual((await readdir(dir)).sort(), [name, basename(output)].sort());
  });
}

test('source paths, filesystem aliases and occupied output are rejected without changes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'postprocess-alias-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'part.gcode');
  const symbolic = join(dir, 'symbolic.gcode');
  const hard = join(dir, 'hard.gcode');
  const occupied = join(dir, 'occupied.gcode');
  await writeFile(input, original);
  await symlink(input, symbolic);
  await link(input, hard);
  await writeFile(occupied, 'previous result');
  const run = handler();
  for (const output of [input, join(dir, '.', 'part.gcode'), symbolic, hard, occupied]) {
    const result = await run({ gcode_path: input, actions: action, output_path: output });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /output_(exists|is_input)/);
    assert.equal(await readFile(input, 'utf8'), original);
    assert.equal(await readFile(occupied, 'utf8'), 'previous result');
  }
});

test('concurrent postprocess publication creates one complete result with no staging debris', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'postprocess-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'part.gcode');
  const output = join(dir, 'output.gcode');
  await writeFile(input, original);
  const run = handler();
  const results = await Promise.all(['M100', 'M200'].map((value) => run({
    gcode_path: input, output_path: output, actions: [{ layer: 1, type: 'custom', value }],
  })));
  assert.equal(results.filter((r) => !r.isError).length, 1);
  assert.equal(results.filter((r) => r.isError).length, 1);
  const content = await readFile(output, 'utf8');
  assert.equal(Number(content.includes('M100')) + Number(content.includes('M200')), 1);
  assert.ok(content.endsWith('G1 X1 Y2\n'));
  assert.equal(await readFile(input, 'utf8'), original);
  assert.deepEqual((await readdir(dir)).sort(), ['output.gcode', 'part.gcode']);
});
