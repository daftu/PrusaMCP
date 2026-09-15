import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileService, parseProfileQuery, printerQuerySchema, presetQuerySchema } from '../build/profiles.js';
const native = { printer_models: [{id:'fixture',name:'Fixture',technology:'FFF',vendor_id:'Fixture',vendor_name:'Fixture',variants:[{name:0.4,printer_profiles:[{name:'Same',extruders_cnt:1,bed:{}}],user_printer_profiles:[{name:'Same',extruders_cnt:1,bed:{}}]}]}] };
test('2.9.6 query exception requires valid JSON/schema and empty native stderr', () => {
  assert.deepEqual(parseProfileQuery({exitCode:1,stdout:JSON.stringify(native),stderr:'',errorCode:'process_failed'},'2.9.6',printerQuerySchema),native);
  for (const [result,version] of [
    [{exitCode:1,stdout:'{broken',stderr:''},'2.9.6'],
    [{exitCode:1,stdout:'{}',stderr:''},'2.9.6'],
    [{exitCode:1,stdout:JSON.stringify(native),stderr:'real error'},'2.9.6'],
    [{exitCode:1,stdout:JSON.stringify(native),stderr:''},'2.9.7'],
    [{exitCode:2,stdout:JSON.stringify(native),stderr:''},'2.9.6'],
  ]) assert.throws(()=>parseProfileQuery(result,version,printerQuerySchema));
});
test('same user/system names have distinct IDs and reject ambiguous native selection', async () => {
  const service=new ProfileService({profilesDir:'/fixture',executablePath:''});
  service.query=async()=>native;
  const [model]=await service.listPrinterModels('FFF');
  assert.notEqual(model.printers[0].id,model.printers[1].id);
  await assert.rejects(service.listPresets(model.printers[0].id,'FFF'),/ambiguous_preset/);
});
test('SLA compatibility results never include FFF filaments', async()=>{
  const service=new ProfileService({profilesDir:'/fixture',executablePath:''});
  service.query=async()=>({printer_models:[{id:'sla',name:'SLA',technology:'SLA',vendor_id:'Fixture',vendor_name:'Fixture',printer_profiles:[{name:'SLA Printer',bed:{}}]}]});
  const [model]=await service.listPrinterModels('SLA');
  service.query=async()=>({printer_profile:'SLA Printer',print_profiles:[{name:'SLA Print',sla_material_profiles:['Resin'],filament_profiles:['PLA']} ]});
  const {profiles}=await service.listPresets(model.printers[0].id,'SLA');
  assert.deepEqual(profiles.map(p=>p.kind),['sla_print','sla_material']);
  assert.deepEqual(profiles[1].compatible_printer_ids,[model.printers[0].id]);
  assert.deepEqual(profiles[1].compatible_print_ids,[profiles[0].id]);
});

import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConfigurationService} from '../build/config-resolver.js';
import {configurationFixture} from './config-fixtures.js';
test('stock SLA queries return native resin compatibility and native SLA tuple resolution', {skip:!process.env.PRUSASLICER_REAL_TEST,timeout:60000},async t=>{
  const f=await configurationFixture(t);
  await writeFile(join(f.profilesDir,'PrusaSlicer.ini'),'version = 2.9.6\n\n[vendor:SyntheticSLA]\nmodel:SYNTHSLA = default\n');
  await writeFile(join(f.profilesDir,'vendor','SyntheticSLA.ini'),`[vendor]
name = Synthetic SLA Vendor
config_version = 1.0.0

[printer_model:SYNTHSLA]
name = Synthetic SLA Printer
variants = default
technology = SLA

[printer:Synthetic SLA Printer]
printer_model = SYNTHSLA
printer_variant = default
printer_technology = SLA

[sla_print:Synthetic SLA Print]
layer_height = 0.05
compatible_printers_condition = printer_model=="SYNTHSLA"

[sla_material:Synthetic Resin]
material_type = Tough
compatible_printers_condition = printer_model=="SYNTHSLA"
`);
  const service=new ConfigurationService(f.config);
  const models=await service.profiles.listPrinterModels('SLA');
  assert.equal(models.length,1);const printer=models[0].printers[0];
  const {profiles}=await service.profiles.listPresets(printer.id,'SLA');
  assert.deepEqual(profiles.map(p=>p.kind),['sla_print','sla_material']);
  const snapshot=await service.resolvePresets({printer_profile_id:printer.id,print_profile_id:profiles[0].id,material_profile_ids:[profiles[1].id]});
  assert.equal(snapshot.technology,'SLA');assert.equal(snapshot.extruder_count,0);assert.equal(snapshot.settings.layer_height,'0.05');
  t.diagnostic(`stock 2.9.6 ${process.platform}/${process.arch}: SLA query and native tuple verified with ${Object.keys(snapshot.settings).length} effective settings`);
});

test('query schemas reject missing technology-specific arrays',()=>{
  assert.throws(()=>parseProfileQuery({exitCode:1,stdout:JSON.stringify({printer_models:[{id:'x',name:'x',technology:'FFF',vendor_id:'x',vendor_name:'x'}]}),stderr:''},'2.9.6',printerQuerySchema),/invalid_profile_query/);
  assert.throws(()=>parseProfileQuery({exitCode:1,stdout:JSON.stringify({printer_profile:'x',print_profiles:[{name:'x'}]}),stderr:''},'2.9.6',presetQuerySchema),/invalid_profile_query/);
});

test('material query with wrong native technology array is rejected',async()=>{
  const service=new ProfileService({profilesDir:'/fixture',executablePath:''});
  service.query=async()=>({printer_models:[{id:'sla',name:'SLA',technology:'SLA',vendor_id:'Fixture',vendor_name:'Fixture',printer_profiles:[{name:'SLA Printer',bed:{}}]}]});
  const [model]=await service.listPrinterModels('SLA');
  service.query=async()=>({printer_profile:'SLA Printer',print_profiles:[{name:'Print',filament_profiles:['PLA']}]});
  await assert.rejects(service.listPresets(model.printers[0].id,'SLA'),/invalid_profile_query/);
});
