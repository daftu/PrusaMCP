import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, stat } from 'node:fs/promises';
import { registerScreenshotPrusaSlicer } from '../build/tools/screenshot-prusaslicer.js';
import { domains } from '../build/tool-domains.js';
import { toolResultSchema } from '../build/contracts.js';

test('screenshot returns embedded image data after its temporary file is removed', { skip: process.platform !== 'darwin' }, async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let invoke;
  let screenshotPath;
  const server = { registerTool(_name, _options, handler) { invoke = handler; } };
  registerScreenshotPrusaSlicer(server, async path => {
    screenshotPath = path;
    await writeFile(path, png);
  });

  const response = await invoke({});
  const result = toolResultSchema(domains.screenshot_prusaslicer).parse(response.structuredContent);
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.data, { image: { media_type: 'image/png', content_index: 0 } });
  assert.deepEqual(Buffer.from(response.content[result.data.image.content_index].data, 'base64'), png);
  assert.equal(response.content[result.data.image.content_index].mimeType, result.data.image.media_type);
  assert.deepEqual(JSON.parse(response.content.find(c => c.type === 'text').text), result);
  await assert.rejects(stat(screenshotPath), { code: 'ENOENT' });
});
