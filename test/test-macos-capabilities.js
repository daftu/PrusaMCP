import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSION_PROBE_SCRIPT, probeMacCapabilities } from '../build/macos.js';
import { createCliDetector } from '../build/capabilities.js';

test('Screen Recording denial blocks capture and current Quartz GUI selector', async () => {
  const result = await probeMacCapabilities('darwin', async () => JSON.stringify({
    screen_recording: 'denied', accessibility: 'granted', automation: 'unknown', gui_session: 'unknown',
  }));
  assert.equal(result.permissions.screen_recording, 'denied');
  assert.equal(result.backends.capture.state, 'blocked');
  assert.equal(result.backends.jxa_gui.state, 'blocked');
  assert.ok(result.backends.jxa_gui.limitations.some(item => item.includes('Quartz')));
  assert.equal(result.permissions.automation, 'unknown');
});

test('absent GUI session and missing CLI binary remain distinct diagnostics', async () => {
  const mac = await probeMacCapabilities('darwin', async () => JSON.stringify({
    screen_recording: 'granted', accessibility: 'granted', automation: 'unknown', gui_session: 'absent',
  }));
  const cli = await createCliDetector()('');
  assert.equal(mac.permissions.gui_session, 'absent');
  assert.equal(mac.backends.jxa_gui.state, 'unavailable');
  assert.equal(mac.backends.capture.state, 'unavailable');
  assert.equal(cli.error_code, 'executable_missing');
  assert.equal(cli.state, 'unavailable');
});

test('permission preflight does not request access or activate a project', async () => {
  let invoked = 0;
  const result = await probeMacCapabilities('darwin', async script => {
    invoked++;
    assert.equal(script, PERMISSION_PROBE_SCRIPT);
    assert.match(script, /CGPreflightScreenCaptureAccess/);
    assert.match(script, /AXIsProcessTrusted/);
    assert.doesNotMatch(script, /CGRequestScreenCaptureAccess|AXIsProcessTrustedWithOptions|Application\(|frontmost\s*=|activate\(|\.open\(/);
    return JSON.stringify({ screen_recording: 'granted', accessibility: 'granted', automation: 'unknown', gui_session: 'active' });
  });
  assert.equal(invoked, 1);
  assert.equal(result.permissions.gui_session, 'active');
  assert.equal(result.backends.capture.state, 'available');
});
