import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPostprocessGcode } from '../build/tools/postprocess-gcode.js';

async function fixture(t, content = ';LAYER_CHANGE\nG1 X1\n;LAYER_CHANGE\nG1 X2\n') {
  const dir = await mkdtemp(join(tmpdir(), 'postprocess-actions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'part.gcode');
  await writeFile(input, content);
  let handler;
  registerPostprocessGcode({ registerTool: (_name, _schema, callback) => { handler = callback; } });
  return { dir, run: (actions) => handler({ gcode_path: input, actions }) };
}

test('mixed present and missing layers report actual inserted and skipped counts', async (t) => {
  const { run } = await fixture(t);
  const result = await run([{ layer: 1, type: 'pause' }, { layer: 99, type: 'color_change' }]);
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.status, 'partial');
  assert.equal(result.structuredContent.coverage, 'partial');
  const data = result.structuredContent.data;
  assert.equal(data.changed, true);
  assert.equal(data.inserted, 1);
  assert.equal(data.skipped, 1);
  const text = await readFile(data.output_path, 'utf8');
  assert.match(text, /M601/);
  assert.doesNotMatch(text, /M600/);
});

for (const content of [';LAYER_CHANGE\nG1 X1\n', 'G1 X1\n']) {
  test(`all skipped actions create no new file (markers=${content.includes('LAYER')})`, async (t) => {
    const { run, dir } = await fixture(t, content);
    const result = await run([{ layer: 99, type: 'pause' }]);
    assert.deepEqual(result.structuredContent.data, { changed: false, inserted: 0, skipped: 1 });
    assert.equal(result.structuredContent.status, 'partial');
    assert.equal(result.structuredContent.coverage, 'partial');
    assert.doesNotMatch(result.content[0].text, /G-code modifié/);
    assert.deepEqual(await readdir(dir), ['part.gcode']);
  });
}

for (const markers of [[';LAYER_CHANGE', ';LAYER_CHANGE'], [';LAYER:0', ';LAYER:1']]) {
  test(`same-layer actions preserve request order and layer placement: ${markers[0]}`, async (t) => {
    const { run } = await fixture(t, `${markers[0]}\nG1 X1\n${markers[1]}\nG1 X2\n`);
    const result = await run([
      { layer: 2, type: 'custom', value: 'M222' },
      { layer: 1, type: 'temperature', value: '220' },
      { layer: 1, type: 'color_change' },
      { layer: 2, type: 'pause' },
    ]);
    assert.equal(result.structuredContent.data.inserted, 4);
    assert.equal(result.structuredContent.data.skipped, 0);
    assert.equal(result.structuredContent.status, 'confirmed');
    const text = await readFile(result.structuredContent.data.output_path, 'utf8');
    const expected = [markers[0], 'M104 S220', 'M600', 'G1 X1', markers[1], 'M222', 'M601', 'G1 X2'];
    let position = -1;
    for (const token of expected) {
      const next = text.indexOf(token, position + 1);
      assert.ok(next > position, `${token} follows previous instruction`);
      position = next;
    }
  });
}
