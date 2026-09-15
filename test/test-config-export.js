import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConfigurationService} from '../build/config-resolver.js';
import {readIni} from '../build/ini-reader.js';
test('flat export retains safe settings, omits secrets and never overwrites a target',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'prusamcp-export-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const service=new ConfigurationService({profilesDir:'',executablePath:''});
  const snapshot=service.saveSnapshot({printer_technology:'FFF',nozzle_diameter:'0.4',layer_height:'0.17',start_gcode:'G28\\nM117 a=b;c',printhost_apikey:'private-fixture',post_process:'private-fixture'}, {},[]);
  const path=join(dir,'export.ini');
  const result=await service.exportConfiguration(snapshot.snapshot_id,'flat_ini',path);
  const content=await readFile(path,'utf8');
  assert.deepEqual(readIni(content).settings,snapshot.settings);
  assert.equal(result.source_revision.sha256,snapshot.revision.sha256);
  assert.doesNotMatch(content+JSON.stringify(snapshot)+JSON.stringify(result),/private-fixture/);
  await assert.rejects(service.exportConfiguration(snapshot.snapshot_id,'flat_ini',path),/output_exists/);
  assert.equal(await readFile(path,'utf8'),content);
});

import {writeFile} from 'node:fs/promises';
import {configurationFixture} from './config-fixtures.js';
test('stock flat export reimports effective settings except explicit omissions', {skip:!process.env.PRUSASLICER_REAL_TEST,timeout:60000},async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'source.ini');
  await writeFile(input,'layer_height = 0.17\nstart_gcode = G28\\nM117 a=b;c\nprinthost_apikey = private-fixture\npost_process = private-fixture\n');
  const first=await service.resolveFile(input);
  const output=join(f.directory,'export.ini');
  const result=await service.exportConfiguration(first.snapshot_id,'flat_ini',output);
  const second=await service.resolveFile(output);
  assert.deepEqual(second.settings,first.settings);
  assert.deepEqual(second.revision,first.revision);
  assert.ok(result.omitted_fields.includes('printhost_apikey'));
  assert.ok(result.omitted_fields.includes('post_process'));
  assert.doesNotMatch(await readFile(output,'utf8'),/private-fixture/);
  await assert.rejects(service.exportConfiguration(first.snapshot_id,'bundle',join(f.directory,'bundle.ini')),/blocked_by_capability/);
});
