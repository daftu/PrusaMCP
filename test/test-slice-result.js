import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { runPrusaSlicer } from '../build/prusa-cli.js';
import { fixture, tool, text, outputArg, ok } from './slice-fixtures.js';

test('nonzero process result rejects an output and retains stderr', async t => {
  const f = await fixture(t);
  const slice = tool(async (_config, args) => {
    await writeFile(outputArg(args), 'partial');
    return { exitCode: 1, stdout: '', stderr: 'fixture slicing failure' };
  });
  const r = await slice({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.match(text(r), /exit code 1/);
  assert.match(text(r), /fixture slicing failure/);
  assert.doesNotMatch(text(r), /Slicing terminé/);
  assert.deepEqual(await readdir(f.dir), ['renamed part.STL']);
});

test('old destination is rejected before a failing runner can touch it', async t => {
  const f = await fixture(t);
  await writeFile(f.output, 'old output');
  let calls = 0;
  const r = await tool(async () => { calls++; return { ...ok, exitCode: 1 }; })({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.match(text(r), /output_exists/);
  assert.doesNotMatch(text(r), /Slicing terminé/);
  assert.equal(calls, 0);
  assert.equal(await readFile(f.output, 'utf8'), 'old output');
});

for (const empty of [false, true]) test(`exit zero with ${empty ? 'empty' : 'missing'} output fails`, async t => {
  const f = await fixture(t);
  const r = await tool(async (_config, args) => { if (empty) await writeFile(outputArg(args), ''); return ok; })({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.match(text(r), /output_missing/);
  assert.deepEqual(await readdir(f.dir), ['renamed part.STL']);
});

test('complete result publishes the requested path and stats', async t => {
  const f = await fixture(t);
  const content = 'G1 X1\n; estimated printing time (normal mode) = 1h 2m\n; total filament used [g] = 4.5\n';
  const r = await tool(async (_config, args) => { await writeFile(outputArg(args), content); return ok; })({ stl_path: f.input, output_gcode: f.output });
  assert.notEqual(r.isError, true);
  assert.ok(text(r).includes(f.output));
  assert.match(text(r), /1h 2m/);
  assert.match(text(r), /4.5g/);
  assert.equal(await readFile(f.output, 'utf8'), content);
});

test('spawn failure is distinguished and diagnostic retained', async t => {
  const f = await fixture(t);
  const config = { executablePath: `${f.dir}/missing-executable`, profilesDir: '' };
  const result = await runPrusaSlicer(config, []);
  assert.equal(result.exitCode, 1);
  assert.equal(result.errorCode, 'spawn_failed');
  assert.match(result.stderr, /ENOENT/);
  const r = await tool(runPrusaSlicer, config)({ stl_path: f.input, output_gcode: f.output });
  assert.equal(r.isError, true);
  assert.match(text(r), /spawn_failed/);
});
