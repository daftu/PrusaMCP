import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConfigurationService} from '../build/config-resolver.js';
import {runPrusaSlicer} from '../build/prusa-cli.js';
import {readIni,omitPrivateSettings} from '../build/ini-reader.js';
import {configurationFixture} from './config-fixtures.js';
const real = Boolean(process.env.PRUSASLICER_REAL_TEST);

test('snapshots are content revisions and unknown IDs reject',()=>{
  const service=new ConfigurationService({profilesDir:'',executablePath:''});
  const one=service.saveSnapshot({printer_technology:'FFF',nozzle_diameter:'0.4',layer_height:'0.17'}, {}, []);
  const two=service.saveSnapshot({layer_height:'0.17',nozzle_diameter:'0.4',printer_technology:'FFF'}, {}, []);
  assert.equal(one.revision.sha256,two.revision.sha256);
  assert.notEqual(one.snapshot_id,two.snapshot_id);
  const returned=service.getSnapshot(one.snapshot_id); returned.settings.layer_height='99';
  assert.equal(service.getSnapshot(one.snapshot_id).settings.layer_height,'0.17');
  assert.throws(()=>service.getSnapshot('missing'),/unknown_snapshot/);
});

test('stock 2.9.6 inherited tuple equals native full export; overrides win; unknown/incompatible reject', {skip:!real,timeout:60000},async t=>{
  const f=await configurationFixture(t); const service=new ConfigurationService(f.config);
  const original=await readFile(join(f.profilesDir,'vendor','Synthetic.ini'));
  const models=await service.profiles.listPrinterModels('FFF');
  assert.equal(models.length,1);assert.equal(models[0].printers[0].nozzle_variant,'0.4');
  const printer=models[0].printers[0];
  const {profiles}=await service.profiles.listPresets(printer.id,'FFF');
  const print=profiles.find(p=>p.kind==='print');const material=profiles.find(p=>p.kind==='filament');
  assert.equal(print.vendor_id,'Synthetic');
  assert.equal(material.vendor_id,'Synthetic');
  const tuple={printer_profile_id:printer.id,print_profile_id:print.id,material_profile_ids:[material.id]};
  const snapshot=await service.resolvePresets(tuple);
  assert.equal(snapshot.settings.layer_height,'0.17');
  assert.equal(snapshot.settings.fill_density,'23%');
  assert.equal(snapshot.settings.temperature,'217');
  assert.equal(snapshot.settings.bed_shape,'0x0,250x0,250x220,0x220');
  const output=join(f.directory,'native.ini');
  const native=await runPrusaSlicer(f.config,['--datadir',f.profilesDir,'--printer-profile','Synthetic Printer','--print-profile','Synthetic Print','--material-profile','Synthetic Material','--save',output]);
  assert.equal(native.exitCode,0);
  assert.deepEqual(snapshot.settings,omitPrivateSettings(readIni(await readFile(output,'utf8')).settings).settings);
  const overridden=await service.resolvePresets(tuple,{layer_height:'0.21'});
  assert.equal(overridden.settings.layer_height,'0.21');
  await assert.rejects(service.resolvePresets({...tuple,print_profile_id:'missing'}),/unknown_preset/);
  await assert.rejects(service.resolvePresets({...tuple,material_profile_ids:[]}),/incompatible_preset/);
  assert.match(snapshot.layers[0].description,/Unsaved GUI state is not included/);
  assert.deepEqual(await readFile(join(f.profilesDir,'vendor','Synthetic.ini')),original);
  t.diagnostic(`stock 2.9.6 ${process.platform}/${process.arch}: ${Object.keys(snapshot.settings).length} native effective keys compared; inherited tuple and override verified`);
});

test('stock flat load preserves escaped G-code, reports dropped settings and natively rejects invalid configuration', {skip:!real,timeout:60000},async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'source.ini');
  await writeFile(input,'layer_height = 0.17\nstart_gcode = G28\\nM117 a=b;c\nunknown_fixture_key = 9\nconstructor = 9\n');
  const snapshot=await service.resolveFile(input,{layer_height:'0.23'});
  assert.equal(snapshot.settings.layer_height,'0.23');
  assert.equal(snapshot.settings.start_gcode,'G28\\nM117 a=b;c');
  assert.deepEqual(snapshot.unsupported_fields,['constructor','unknown_fixture_key']);
  await assert.rejects(service.validateNative(snapshot,{layer_height:'-1'}),/native_validation_failed/);
});

test('stock saved 3MF settings resolve with higher priority load overrides and unchanged source', {skip:!real,timeout:60000},async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'settings.ini');const project=join(f.directory,'saved.3mf');
  await writeFile(input,'layer_height = 0.17\nstart_gcode = G28\\nM117 fixture\n');
  const native=await runPrusaSlicer(f.config,['--datadir',f.profilesDir,'--load',input,'--export-3mf','--output',project,new URL('./cube.stl',import.meta.url).pathname]);
  assert.equal(native.exitCode,0);
  // CLI --export-3mf exports geometry only. Add the native configuration entry to
  // this synthetic project, as in the existing slicing acceptance fixture.
  await promisify(execFile)('python3',['-c',`import sys,zipfile,os
p,ini=sys.argv[1:]
with zipfile.ZipFile(p) as z: entries={name:z.read(name) for name in z.namelist()}
entries['Metadata/Slic3r_PE.config']=('; generated by PrusaSlicer 2.9.6\\n'+'\\n'.join('; '+line for line in open(ini).read().splitlines())+'\\n').encode()
with zipfile.ZipFile(p,'w') as z:
 for name,value in entries.items(): z.writestr(name,value)
`,project,input]);
  const before=await readFile(project);
  const snapshot=await service.resolveFile(project,{layer_height:'0.24'});
  assert.equal(snapshot.settings.layer_height,'0.24');
  assert.equal(snapshot.settings.start_gcode,'G28\\nM117 fixture');
  assert.equal(snapshot.input_diagnostics_known,false);
  assert.match(snapshot.layers[0].description,/unsaved GUI state is not included/);
  assert.deepEqual(await readFile(project),before);
});
