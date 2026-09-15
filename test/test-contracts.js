import test from 'node:test';
import assert from 'node:assert/strict';
import { fileRevision, revisionSchema, settingAddressSchema, toolResultSchema, typedSettingSchema } from '../build/contracts.js';
import { domains } from '../build/tool-domains.js';

const result = (source, data, revision) => ({
  source, status: 'confirmed', coverage: 'complete', warnings: [], summary: 'Operation confirmed', data,
  ...(revision ? { revision } : {}),
});

test('realistic slice, live read, estimate and printer results use their domain schemas', () => {
  const examples = [
    ['slice_prusaslicer', result('cli', {
      artifact: { path: '/tmp/part.gcode', media_type: 'text/x-gcode', revision: fileRevision('G1 X1') },
      exit_code: 0, stats: { layerCount: 20, estimatedTimeSeconds: 600 }, post_process_policy: 'disabled',
    })],
    ['read_prusaslicer_fields', result('live_gui', {
      source: 'live_gui', coverage: 'currently_exposed_controls_only', window_id: 101,
      title: 'part - PrusaSlicer-2.9.6', fields: [{ parameter: 'layer_height', value: 0.2, enabled: true, role: 'AXTextField', section: 'Layers' }],
    }, { kind: 'live', session_id: 'window-101', observed_revision: 'observation-1' })],
    ['estimate_cost', result('estimate', { estimates: [{ goal: 'standard', estimate: {
      filamentWeightG: 20, filamentLengthMm: 6600, filamentCostEur: 0.5,
      electricityCostEur: 0.2, totalCostEur: 0.7, printTimeSeconds: 3600, printTimeFormatted: '1h',
    } }] })],
    ['upload_print', result('printer', {
      http_status: 201, file_name: 'part.gcode', server: 'test-printer', start_requested: false, physical_state: 'unknown',
    })],
  ];
  for (const [name, value] of examples) assert.equal(toolResultSchema(domains[name]).safeParse(value).success, true, name);
});

test('confirmed cannot carry an error and partial coverage cannot claim a complete result', () => {
  const schema = toolResultSchema(domains.upload_print);
  const data = { http_status: 201, file_name: 'part.gcode', server: 'test-printer', start_requested: false, physical_state: 'unknown' };
  const confirmed = result('printer', data);
  assert.equal(schema.safeParse({ ...confirmed, error: { code: 'upload_failed', message: 'Upload failed' } }).success, false);
  assert.equal(schema.safeParse({ ...confirmed, status: 'partial', coverage: 'partial', summary: 'Upload accepted; physical state unknown' }).success, true);
  assert.equal(schema.safeParse({ ...confirmed, status: 'partial', coverage: 'complete' }).success, false);
  assert.equal(schema.safeParse({ ...confirmed, coverage: 'partial' }).success, false);
});

test('setting addresses identify non-global targets and use zero-based extruder indexes', () => {
  assert.equal(settingAddressSchema.safeParse({ scope: 'global', key: 'layer_height' }).success, true);
  for (const scope of ['object', 'volume', 'height_range']) {
    assert.equal(settingAddressSchema.safeParse({ scope, key: 'layer_height' }).success, false, scope);
    assert.equal(settingAddressSchema.safeParse({ scope, key: 'layer_height', target_id: `${scope}-1`, extruder_index: 0 }).success, true, scope);
  }
  assert.equal(settingAddressSchema.safeParse({ scope: 'object', key: 'layer_height', target_id: 'object-1', extruder_index: -1 }).success, false);
});

test('unknown effective setting remains null; file and live revisions have distinct meanings', () => {
  const address = { scope: 'object', key: 'layer_height', target_id: 'object-1' };
  const unknown = { address, displayed: '0.20', value: 0.2, inherited: true, effective_known: false, effective_value: null };
  assert.equal(typedSettingSchema.safeParse(unknown).success, true);
  assert.equal(typedSettingSchema.safeParse({ ...unknown, effective_value: 0.2 }).success, false);
  assert.equal(typedSettingSchema.safeParse({ ...unknown, effective_known: true, effective_value: 0.2 }).success, true);
  assert.equal(typedSettingSchema.safeParse({ ...unknown, effective_known: true }).success, false);

  const first = fileRevision('same file contents');
  assert.deepEqual(first, fileRevision('same file contents'));
  assert.notDeepEqual(first, fileRevision('changed file contents'));
  assert.equal(revisionSchema.safeParse(first).success, true);
  const live = { kind: 'live', session_id: 'window-101', observed_revision: 'observation-2' };
  assert.equal(revisionSchema.safeParse(live).success, true);
  assert.equal('sha256' in live, false);
});
