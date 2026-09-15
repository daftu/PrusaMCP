import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { fixture, tool, text, outputArg, ok } from './slice-fixtures.js';
const hash = content => createHash('sha256').update(content).digest('hex');

test('existing output hash is preserved', async t => {
  const f = await fixture(t);
  await writeFile(f.output, 'existing output');
  const before = hash(await readFile(f.output));
  const r = await tool(() => assert.fail('must not run'))({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.equal(hash(await readFile(f.output)), before);
});

test('parallel requests publish exactly one complete output', async t => {
  const f = await fixture(t);
  let entered = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const stages = [];
  const slice = tool(async (_config, args) => {
    const path = outputArg(args); stages.push(path);
    await writeFile(path, `complete ${entered++}`);
    if (entered === 2) release();
    await barrier;
    return ok;
  });
  const results = await Promise.all([1, 2].map(() => slice({ stl_path: f.input, output_gcode: f.output })));
  assert.equal(results.filter(r => !r.isError).length, 1);
  assert.match(text(results.find(r => r.isError)), /output_exists/);
  assert.equal(new Set(stages).size, 2);
  assert.match(await readFile(f.output, 'utf8'), /^complete [01]$/);
  assert.deepEqual((await readdir(f.dir)).sort(), ['renamed part.STL', 'result.gcode']);
});

test('publication failure leaves the competing destination untouched and removes staging', async t => {
  const f = await fixture(t);
  const r = await tool(async (_config, args) => {
    await writeFile(outputArg(args), 'complete');
    await mkdir(f.output);
    return ok;
  })({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.match(text(r), /output_exists/);
  assert.deepEqual(await readdir(f.output), []);
  assert.deepEqual((await readdir(f.dir)).sort(), ['renamed part.STL', 'result.gcode']);
});

test('renamed input with spaces uses isolated staging and conventional default name', async t => {
  const f = await fixture(t);
  const before = await readFile(f.input);
  const r = await tool(async (_config, args) => {
    assert.equal(args.at(-1), f.input);
    const path = outputArg(args);
    assert.notEqual(dirname(path), f.dir);
    assert.equal(dirname(dirname(path)), f.dir);
    assert.equal(basename(path), 'renamed part.gcode');
    await writeFile(path, 'complete'); return ok;
  })({ stl_path: f.input });
  assert.notEqual(r.isError, true);
  assert.deepEqual(await readFile(f.input), before);
  assert.deepEqual((await readdir(f.dir)).sort(), ['renamed part.STL', 'renamed part.gcode']);
});
