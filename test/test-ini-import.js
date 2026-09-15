import test from 'node:test';
import assert from 'node:assert/strict';
import {readIni,serializeNativeSettings,omitPrivateSettings} from '../build/ini-reader.js';
test('bundle sections stay distinct and native multiline/separators roundtrip',()=>{
  const input='[print:Same]\nlayer_height = 0.17\n[filament:Same]\nstart_filament_gcode = G1 X1\\nM117 a=b;c\n[printer:Same]\ninherits = Parent\nstart_gcode = G28\\nM117 a=b;c\n';
  const document=readIni(input);
  assert.equal(document.format,'bundle');
  assert.equal(document.sections.length,3);
  assert.equal(document.sections[2].settings.inherits,'Parent');
  for(const section of document.sections) assert.deepEqual(readIni(serializeNativeSettings(section.settings)).settings,section.settings);
  assert.equal(document.sections[2].settings.start_gcode,'G28\\nM117 a=b;c');
});
test('host credentials and host scripts omitted by name, printer G-code retained',()=>{
  const result=omitPrivateSettings({printhost_apikey:'private-fixture',print_host:'private-fixture',post_process:'private-fixture',start_gcode:'G28\\nM117 ready'});
  assert.deepEqual(result.settings,{start_gcode:'G28\\nM117 ready'});
  assert.deepEqual(result.omitted_fields,['post_process','print_host','printhost_apikey']);
  assert.doesNotMatch(JSON.stringify(result),/private-fixture/);
});

import {writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {ConfigurationService} from '../build/config-resolver.js';
import {configurationFixture} from './config-fixtures.js';
test('stock flat import validates in managed workspace without changing input or configured profiles', {skip:!process.env.PRUSASLICER_REAL_TEST,timeout:60000},async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const path=join(f.directory,'input.ini');
  await writeFile(path,'layer_height = 0.19\nstart_gcode = G28\\nM117 a=b;c\n');
  const before=await readFile(path);const profilesBefore=await readFile(join(f.profilesDir,'vendor','Synthetic.ini'));
  const result=await service.importConfiguration(path,'fixture-workspace');
  t.after(()=>rm(dirname(result.artifact.path),{recursive:true,force:true}));
  assert.equal(result.native_validated,true);assert.equal(result.format,'flat_ini');assert.deepEqual(result.profiles,[]);
  assert.equal(result.snapshot.settings.layer_height,'0.19');
  assert.notEqual(dirname(result.artifact.path),f.profilesDir);
  assert.deepEqual(await readFile(path),before);
  assert.deepEqual(await readFile(join(f.profilesDir,'vendor','Synthetic.ini')),profilesBefore);
});
test('bundle import requires the configured native helper rather than importing defaults',async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const path=join(f.directory,'bundle.ini');
  await writeFile(path,'[print:Print]\nlayer_height = 0.17\n[filament:Material]\ntemperature = 217\n[printer:Printer]\nnozzle_diameter = 0.6\n');
  service.requireVersion=async()=>{};
  const previous=process.env.PRUSAMCP_NATIVE_CONFIG_PATH;delete process.env.PRUSAMCP_NATIVE_CONFIG_PATH;
  t.after(()=>{if(previous===undefined)delete process.env.PRUSAMCP_NATIVE_CONFIG_PATH;else process.env.PRUSAMCP_NATIVE_CONFIG_PATH=previous;});
  await assert.rejects(service.importConfiguration(path,'fixture'),/native_backend_missing/);
});
