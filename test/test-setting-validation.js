import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettingCatalog, serializeSetting, deserializeSetting, validateSettingChanges } from '../build/setting-catalog.js';
import { validateSettings } from '../build/tools/validate-settings.js';
const revision = 'a'.repeat(64);
const snapshot = { revision: {kind:'file',sha256:revision}, version:'2.9.6', technology:'FFF', extruder_count:2,
  settings:{nozzle_diameter:'0.4,0.6',temperature:'210,215',wipe:'0,1',gcode_flavor:'marlin2'} };
const change = (key,value,extruder_index) => ({address:{scope:'global',key,...(extruder_index === undefined ? {} : {extruder_index})},value});
const definition = key => getSettingCatalog('2.9.6','FFF').find(d=>d.key===key);

test('native bool, percentage, enum and extruder vectors preserve typed round trips',()=>{
  for (const [key,value,native] of [['spiral_vase',true,'1'],['fill_density','25%','25%'],['gcode_flavor','marlin2','marlin2'],['temperature',[205,220],'205,220'],['wipe',[true,false],'1,0'],['first_layer_height','150%','150%'],['first_layer_height',0.25,'0.25'],['filament_type',['PLA','PET'],'"PLA";"PET"']]) {
    assert.equal(serializeSetting(definition(key),value),native);
    assert.deepEqual(deserializeSetting(definition(key),native),value);
  }
});
test('string serialization preserves custom G-code and vector separators',()=>{
  for (const [key,value] of [['start_gcode','G28\nM117 a;b=c \\ path'],['filament_type',['a;b','quote" and\\slash\nline']]]) {
    assert.deepEqual(deserializeSetting(definition(key),serializeSetting(definition(key),value)),value);
  }
});
test('invalid settings are rejected as a batch before native writes',async()=>{
  let calls=0;
  const service={getSnapshot:()=>snapshot,validateNative:async()=>{calls++;}};
  const changes=[change('missing_setting',1),change('spiral_vase','true'),change('temperature',220,2),change('exposure_time',5)];
  const result=await validateSettings(service,revision,changes);
  assert.equal(calls,0); assert.equal(result.valid,false); assert.equal(result.native_validated,false);
  assert.deepEqual(result.errors.map(e=>e.code),['unsupported','wrong_value','invalid_extruder_index','wrong_technology']);
  assert.deepEqual(result.changes,[]);
});
test('indexed edits preserve other extruders and accumulate before native validation',async()=>{
  let received;
  const service={getSnapshot:()=>snapshot,validateNative:async(s,o)=>{received=o;}};
  const result=await validateSettings(service,revision,[change('temperature',220,0),change('temperature',225,1)]);
  assert.equal(result.valid,true); assert.equal(result.native_validated,true);
  assert.deepEqual(received,{temperature:'220,225'}); assert.equal(snapshot.settings.temperature,'210,215');
});
test('native dependency rejection returns errors for the requested addresses',async()=>{
  const service={getSnapshot:()=>snapshot,validateNative:async()=>{throw new Error('native');}};
  const changes=[change('layer_height',0)];
  const result=await validateSettings(service,revision,changes);
  assert.equal(result.valid,false); assert.equal(result.native_validated,false);
  assert.deepEqual(result.errors.map(e=>e.address),changes.map(c=>c.address));
});
test('catalog is versioned, technology-specific and reports unknown GUI location as null',()=>{
  assert.deepEqual(definition('layer_height').gui_location,{tab:'print',category_id:'layers',required_ui_mode:'simple'});
  assert.equal(definition('start_gcode').gui_location,null);
  assert.equal(getSettingCatalog('2.9.6','FFF').some(d=>d.key==='exposure_time'),false);
  assert.ok(getSettingCatalog('2.9.6','SLA').some(d=>d.key==='exposure_time'));
  assert.throws(()=>getSettingCatalog('2.9.7','FFF'),/unsupported_version/);
});
test('revision, global scope, native bounds and script policy are enforced',()=>{
  assert.equal(validateSettingChanges(snapshot,'b'.repeat(64),[change('layer_height',0.2)]).errors[0].code,'revision_mismatch');
  assert.equal(validateSettingChanges(snapshot,revision,[change('fill_density','101%')]).valid,false);
  assert.equal(validateSettingChanges(snapshot,revision,[change('post_process',['echo unsafe'])]).errors[0].code,'script_policy');
  assert.equal(validateSettingChanges(snapshot,revision,[{address:{scope:'object',target_id:'x',key:'layer_height'},value:0.2}]).errors[0].code,'unsupported_scope');
});

test('typed validation accepts native bed-temperature and cooling-move values',async()=>{
  const one={...snapshot,extruder_count:1,settings:{...snapshot.settings,nozzle_diameter:'0.4'}};
  let nativeOverrides;
  const service={getSnapshot:()=>one,validateNative:async(_snapshot,overrides)=>{nativeOverrides=overrides;}};
  const result=await validateSettings(service,revision,[change('first_layer_bed_temperature',[60]),change('filament_cooling_moves',[4])]);
  assert.equal(result.valid,true);assert.equal(result.native_validated,true);
  assert.deepEqual(nativeOverrides,{first_layer_bed_temperature:'60',filament_cooling_moves:'4'});
});

import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConfigurationService} from '../build/config-resolver.js';
import {configurationFixture} from './config-fixtures.js';
test('stock two-extruder snapshot accepts native short temperature vector and indexed edits', {skip:!process.env.PRUSASLICER_REAL_TEST,timeout:60000},async t=>{
  const f=await configurationFixture(t);
  const input=join(f.directory,'two-extruders.ini');
  await writeFile(input,'printer_technology = FFF\nnozzle_diameter = 0.4,0.6\ntemperature = 210\n');
  const service=new ConfigurationService(f.config);
  const resolved=await service.resolveFile(input);
  assert.equal(resolved.extruder_count,2);
  assert.equal(resolved.settings.temperature,'210');
  for (const [changes,expected] of [
    [[change('temperature',[220])],'220'],
    [[change('temperature',220,0)],'220,210'],
    [[change('temperature',220,1)],'210,220'],
  ]) {
    const plan=validateSettingChanges(resolved,resolved.revision.sha256,changes);
    assert.equal(plan.valid,true,JSON.stringify(plan.errors));
    assert.equal(plan.overrides.temperature,expected);
    const publicResult=await validateSettings(service,resolved.revision.sha256,changes);
    assert.equal(publicResult.valid,true,JSON.stringify(publicResult.errors));
    assert.equal(publicResult.native_validated,true);
    const native=await service.resolveFile(input,plan.overrides);
    assert.equal(native.settings.temperature,expected);
    assert.equal(native.extruder_count,2);
  }
});
