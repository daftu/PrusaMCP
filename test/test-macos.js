import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectMacWindow } from '../build/macos.js';
import { extractFilenameFromTitle } from '../build/tools/get-current-model.js';

const windows = [
  { id: 1063, pid: 100, title: 'PrusaSlicer-2.9.6 based on Slic3r' },
  { id: 533, pid: 200, title: '*tesla_tray - PrusaSlicer-2.9.6 based on Slic3r' },
];
test('two real project windows require explicit selection, including an untitled window', () => {
  assert.throws(() => selectMacWindow(windows), /1063:.*533: \*tesla_tray/);
  assert.equal(selectMacWindow(windows, 533).title, windows[1].title);
  assert.throws(() => selectMacWindow(windows, 99), /not available/);
});
test('one project is selectable; no project produces an error', () => {
  assert.deepEqual(selectMacWindow([windows[1]]), windows[1]);
  assert.throws(() => selectMacWindow([]), /No PrusaSlicer project/);
});
test('macOS titles with unsaved changes retain their project name', () => {
  assert.equal(extractFilenameFromTitle(windows[1].title), 'tesla_tray');
  assert.equal(extractFilenameFromTitle(windows[0].title), null);
  assert.equal(extractFilenameFromTitle('*part.stl - PrusaSlicer-2.9.4 basé sur Slic3r'), 'part.stl');
});
test('configuration honors explicit paths and macOS profile defaults without APPDATA', {skip: process.platform !== 'darwin'}, () => {
  const root = mkdtempSync(join(tmpdir(), 'prusa-config-test-'));
  try {
    const profiles = join(root, 'Library/Application Support/PrusaSlicer');
    mkdirSync(profiles, { recursive: true });
    const override = join(root, 'custom profiles');
    mkdirSync(override);
    const executable = join(root, 'Custom PrusaSlicer');
    writeFileSync(executable, '');
    const env = { ...process.env, HOME: root, PRUSASLICER_PATH: executable };
    delete env.APPDATA;
    delete env.PRUSASLICER_PROFILES_DIR;
    delete env.PRUSASLICER_TRUSTED_SCRIPTS;
    const read = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      'import {loadConfig} from "./build/config.js"; console.log(JSON.stringify(loadConfig()));'], { env, encoding: 'utf8' }));
    assert.deepEqual(read(), { executablePath: executable, profilesDir: profiles, trustedScripts: {} });
    env.PRUSASLICER_PROFILES_DIR = override;
    assert.equal(read().profilesDir, override);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
