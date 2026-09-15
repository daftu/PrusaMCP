import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSlice } from '../build/tools/slice.js';
export async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'prusa slice test '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'renamed part.STL');
  await writeFile(input, 'synthetic model');
  return { dir, input, output: join(dir, 'result.gcode') };
}
export function tool(runner, config = { executablePath: 'fixture', profilesDir: '' }) {
  let callback, schema;
  registerSlice({ registerTool(_name, options, handler) { callback = handler; schema = options.inputSchema; } }, config, runner);
  return async (input) => callback(schema.parse(input));
}
export const text = result => result.content[0].text;
export const outputArg = args => args[args.indexOf('--output') + 1];
export const ok = { exitCode: 0, stdout: '', stderr: '' };
