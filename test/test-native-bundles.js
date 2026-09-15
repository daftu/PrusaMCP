import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {ConfigurationService} from '../build/config-resolver.js';
import {readIni} from '../build/ini-reader.js';
import {configurationFixture} from './config-fixtures.js';
const native={skip:!process.env.PRUSAMCP_NATIVE_CONFIG_PATH||!process.env.PRUSASLICER_REAL_TEST,timeout:120000};
const fixture=`[print:*base*]
layer_height = 0.17
fill_density = 23%
[print:Same]
inherits = *base*
[filament:Same]
temperature = 217
filament_type = PLA
[printer:Same]
printer_technology = FFF
nozzle_diameter = 0.4
bed_shape = 0x0,250x0,250x220,0x220
start_gcode = G28\\nM117 a=b;c
printhost_apikey = private-bundle-fixture
post_process = private-bundle-fixture
[presets]
print = Same
filament = Same
printer = Same
`;
function tuple(imported,technology='FFF') {
  const id=kind=>imported.profiles.find(p=>p.kind===kind&&p.name==='Same')?.id;
  return {printer_profile_id:id('printer'),print_profile_id:id(technology==='FFF'?'print':'sla_print'),material_profile_ids:[id(technology==='FFF'?'filament':'sla_material')]};
}
function settingsWithoutPresetNames(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key])=>!['print_settings_id','filament_settings_id','printer_settings_id','sla_print_settings_id','sla_material_settings_id','inherits'].includes(key)));
}
test('native bundle imports distinct inherited presets and selected export roundtrips without private values',native,async t=>{
  const f=await configurationFixture(t); const service=new ConfigurationService(f.config);
  await mkdir(join(f.profilesDir,'print'),{recursive:true});
  await writeFile(join(f.profilesDir,'print','Unrelated.ini'),'layer_height = 0.29\n');
  const input=join(f.directory,'bundle.ini');await writeFile(input,fixture);
  const source=await readFile(input),user=await readFile(join(f.profilesDir,'vendor','Synthetic.ini'));
  const imported=await service.importConfiguration(input,'bundle-workspace');
  t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  assert.equal(imported.native_validated,true);assert.equal(imported.format,'bundle');
  assert.equal(imported.profiles.some(p=>p.name==='Unrelated'),false);
  const same=imported.profiles.filter(p=>p.name==='Same');
  assert.deepEqual(same.map(p=>p.kind).sort(),['filament','print','printer']);
  assert.equal(new Set(same.map(p=>p.id)).size,3);
  assert.doesNotMatch(JSON.stringify(imported)+await readFile(imported.artifact.path,'utf8'),/private-bundle-fixture/);
  const first=await service.resolvePresets(tuple(imported));
  assert.equal(first.settings.layer_height,'0.17');assert.equal(first.settings.temperature,'217');
  assert.equal(first.settings.start_gcode,'G28\\nM117 a=b;c');
  const output=join(f.directory,'selected.ini');
  await service.exportConfiguration(first.snapshot_id,'bundle',output);
  const exported=await readFile(output,'utf8');
  assert.doesNotMatch(exported,/private-bundle-fixture/);
  assert.equal(readIni(exported).sections.filter(s=>/^(print|filament|printer):/.test(s.name)).length,3);
  const again=await service.importConfiguration(output,'second-workspace');t.after(()=>rm(dirname(again.artifact.path),{recursive:true,force:true}));
  const second=await service.resolvePresets(tuple(again));
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(first.settings));
  await assert.rejects(service.exportConfiguration(first.snapshot_id,'bundle',output),/output_exists/);
  assert.equal(await readFile(output,'utf8'),exported);
  assert.deepEqual(await readFile(input),source);assert.deepEqual(await readFile(join(f.profilesDir,'vendor','Synthetic.ini')),user);
});
test('installed native preset tuple exports only selected profiles and preserves overrides',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const models=await service.profiles.listPrinterModels('FFF');const printer=models[0].printers[0];
  const presets=await service.profiles.listPresets(printer.id,'FFF');
  const first=await service.resolvePresets({printer_profile_id:printer.id,print_profile_id:presets.profiles.find(p=>p.kind==='print').id,material_profile_ids:[presets.profiles.find(p=>p.kind==='filament').id]}, {layer_height:'0.21',temperature:'223'});
  const path=join(f.directory,'override-bundle.ini');await service.exportConfiguration(first.snapshot_id,'bundle',path);
  const imported=await service.importConfiguration(path,'overrides');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  const selected=kind=>imported.profiles.find(p=>p.kind===kind).id;
  const second=await service.resolvePresets({printer_profile_id:selected('printer'),print_profile_id:selected('print'),material_profile_ids:[selected('filament')]});
  assert.equal(second.settings.layer_height,'0.21');assert.equal(second.settings.temperature,'223');
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(first.settings));
});
test('installed native preset tuple exports and reimports unchanged names',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const models=await service.profiles.listPrinterModels('FFF');const printer=models[0].printers[0];
  const presets=await service.profiles.listPresets(printer.id,'FFF');
  const print=presets.profiles.find(p=>p.kind==='print');const filament=presets.profiles.find(p=>p.kind==='filament');
  const first=await service.resolvePresets({printer_profile_id:printer.id,print_profile_id:print.id,material_profile_ids:[filament.id]});
  const path=join(f.directory,'installed-export.ini');await service.exportConfiguration(first.snapshot_id,'bundle',path);
  const exported=readIni(await readFile(path,'utf8')).sections.filter(s=>/^(print|filament|printer):/.test(s.name));
  assert.deepEqual(exported.map(s=>s.name).sort(),[`filament:${filament.name}`,`print:${print.name}`,`printer:${printer.name}`].sort());
  const imported=await service.importConfiguration(path,'installed-again');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  assert.deepEqual(imported.profiles.map(p=>`${p.kind}:${p.name}`).sort(),exported.map(s=>s.name).sort());
  const selected=kind=>imported.profiles.find(p=>p.kind===kind).id;
  const second=await service.resolvePresets({printer_profile_id:selected('printer'),print_profile_id:selected('print'),material_profile_ids:[selected('filament')]});
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(first.settings));
});
test('native override export preserves printer name used by compatibility condition',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'condition.ini');
  await writeFile(input,'[printer:Same]\nprinter_technology = FFF\nnozzle_diameter = 0.4\n[print:Same]\nlayer_height = 0.2\ncompatible_printers_condition = printer_preset=="Same"\n[filament:Same]\ntemperature = 217\n');
  const imported=await service.importConfiguration(input,'condition');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  const first=await service.resolvePresets(tuple(imported));assert.equal(first.settings.temperature,'217');
  const changed=await service.resolvePresets(tuple(imported),{temperature:'220'});
  const path=join(f.directory,'condition-export.ini');await service.exportConfiguration(changed.snapshot_id,'bundle',path);
  const exported=readIni(await readFile(path,'utf8')).sections;
  assert.equal(exported.find(s=>s.name==='print:Same').settings.compatible_printers_condition,'printer_preset=="Same"');
  assert.ok(exported.some(s=>s.name==='printer:Same'));
  const again=await service.importConfiguration(path,'condition-again');t.after(()=>rm(dirname(again.artifact.path),{recursive:true,force:true}));
  const selected=kind=>again.profiles.find(p=>p.kind===kind).id;
  const second=await service.resolvePresets({printer_profile_id:selected('printer'),print_profile_id:selected('print'),material_profile_ids:[selected('filament')]});
  assert.equal(second.settings.temperature,'220');
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(changed.settings));
});
test('native SLA bundle retains resin settings and rejects mixed technology tuple',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const path=join(f.directory,'sla.ini');await writeFile(path,'[printer:Same]\nprinter_technology = SLA\n[sla_print:Same]\nlayer_height = 0.05\n[sla_material:Same]\nmaterial_type = Tough\nexposure_time = 7\n');
  const imported=await service.importConfiguration(path,'sla');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  const first=await service.resolvePresets(tuple(imported,'SLA'));
  assert.equal(first.technology,'SLA');assert.equal(first.settings.exposure_time,'7');
  const out=join(f.directory,'sla-export.ini');await service.exportConfiguration(first.snapshot_id,'bundle',out);
  const again=await service.importConfiguration(out,'sla-again');t.after(()=>rm(dirname(again.artifact.path),{recursive:true,force:true}));
  const second=await service.resolvePresets(tuple(again,'SLA'));
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(first.settings));
  await assert.rejects(service.resolvePresets({...tuple(imported,'SLA'),print_profile_id:tuple(imported,'SLA').printer_profile_id}),/incompatible_preset/);
});

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerProfileTools} from '../build/tools/profiles.js';
test('bundle MCP import schema exposes usable IDs and selected export with explicit diagnostics',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'mcp.ini');await writeFile(input,fixture);
  const server=new McpServer({name:'native-bundle-test',version:'1'});registerProfileTools(server,service);
  const [s,c]=InMemoryTransport.createLinkedPair();const client=new Client({name:'bundle-client',version:'1'});
  await server.connect(s);await client.connect(c);t.after(async()=>{await client.close();await server.close();});
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);return result.structuredContent;};
  const imported=await call('import_configuration',{path:input,workspace_id:'mcp'});
  assert.equal(imported.status,'partial');assert.equal(imported.data.input_diagnostics_known,false);
  t.after(()=>rm(dirname(imported.data.artifact.path),{recursive:true,force:true}));
  const resolved=await call('resolve_configuration',{base:{type:'presets',...tuple(imported.data)}});
  assert.equal(resolved.data.settings.layer_height,'0.17');
  const exported=await call('export_configuration',{snapshot_id:resolved.data.snapshot_id,format:'bundle',output_path:join(f.directory,'mcp-out.ini')});
  assert.equal(exported.data.format,'bundle');assert.equal(exported.data.source_revision.sha256,resolved.data.revision.sha256);
});

test('native selected export preserves different override values for two extruders',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'two.ini');await writeFile(input,fixture.replace('nozzle_diameter = 0.4','nozzle_diameter = 0.4,0.6'));
  const imported=await service.importConfiguration(input,'two');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  const chosen=tuple(imported);chosen.material_profile_ids.push(chosen.material_profile_ids[0]);
  const first=await service.resolvePresets(chosen,{temperature:'210,220'});
  const path=join(f.directory,'two-export.ini');await service.exportConfiguration(first.snapshot_id,'bundle',path);
  const again=await service.importConfiguration(path,'two-again');t.after(()=>rm(dirname(again.artifact.path),{recursive:true,force:true}));
  const selection=readIni(await readFile(path,'utf8')).sections.find(section=>section.name==='presets').settings;
  const id=(kind,name)=>again.profiles.find(profile=>profile.kind===kind&&profile.name===name).id;
  const second=await service.resolvePresets({printer_profile_id:id('printer',selection.printer),print_profile_id:id('print',selection.print),material_profile_ids:[id('filament',selection.filament),id('filament',selection.filament_1)]});
  assert.equal(second.settings.temperature,'210,220');assert.equal(second.extruder_count,2);
  assert.deepEqual(settingsWithoutPresetNames(second.settings),settingsWithoutPresetNames(first.settings));
});

import {validateSettings} from '../build/tools/validate-settings.js';
test('bundle export discloses project-only omissions while snapshot and flat INI retain purge settings',native,async t=>{
  const f=await configurationFixture(t);const service=new ConfigurationService(f.config);
  const input=join(f.directory,'purge.ini');await writeFile(input,fixture.replace('nozzle_diameter = 0.4','nozzle_diameter = 0.4,0.6'));
  const imported=await service.importConfiguration(input,'purge');t.after(()=>rm(dirname(imported.artifact.path),{recursive:true,force:true}));
  const selected=tuple(imported);selected.material_profile_ids.push(selected.material_profile_ids[0]);
  const base=await service.resolvePresets(selected);
  const valid=await validateSettings(service,base.revision.sha256,[{address:{scope:'global',key:'wiping_volumes_matrix'},value:[0,150,200,0]},{address:{scope:'global',key:'wiping_volumes_use_custom_matrix'},value:true}]);
  assert.equal(valid.valid,true);assert.equal(valid.native_validated,true);
  const snapshot=await service.resolvePresets(selected,{wiping_volumes_matrix:'0,150,200,0',wiping_volumes_use_custom_matrix:'1'});
  const retained={wiping_volumes_matrix:'0,150,200,0',wiping_volumes_use_custom_matrix:'1'};
  const flatPath=join(f.directory,'purge-flat.ini');const flat=await service.exportConfiguration(snapshot.snapshot_id,'flat_ini',flatPath);
  const flatSettings=readIni(await readFile(flatPath,'utf8')).settings;
  for(const [key,value] of Object.entries(retained)) {
    assert.equal(snapshot.settings[key],value);assert.equal(flatSettings[key],value);
    assert.equal(snapshot.omitted_fields.includes(key),false);assert.equal(flat.omitted_fields.includes(key),false);
  }
  assert.deepEqual(flat.bundle_omitted_fields,[]);
  const server=new McpServer({name:'purge-bundle-test',version:'1'});registerProfileTools(server,service);
  const [s,c]=InMemoryTransport.createLinkedPair();const client=new Client({name:'purge-client',version:'1'});
  await server.connect(s);await client.connect(c);t.after(async()=>{await client.close();await server.close();});
  const path=join(f.directory,'purge-bundle.ini');
  const response=await client.callTool({name:'export_configuration',arguments:{snapshot_id:snapshot.snapshot_id,format:'bundle',output_path:path}});
  const result=response.structuredContent;
  assert.equal(result.status,'partial');assert.equal(result.coverage,'partial');assert.ok(result.warnings.some(w=>w.includes('project settings')));
  for(const key of Object.keys(retained)) {assert.ok(result.data.omitted_fields.includes(key));assert.ok(result.data.bundle_omitted_fields.includes(key));}
  const again=await service.importConfiguration(path,'purge-again');t.after(()=>rm(dirname(again.artifact.path),{recursive:true,force:true}));
  const names=readIni(await readFile(path,'utf8')).sections.find(s=>s.name==='presets').settings;
  const id=(kind,name)=>again.profiles.find(p=>p.kind===kind&&p.name===name).id;
  const restored=await service.resolvePresets({printer_profile_id:id('printer',names.printer),print_profile_id:id('print',names.print),material_profile_ids:[id('filament',names.filament),id('filament',names.filament_1)]});
  assert.equal(restored.settings.wiping_volumes_matrix,'0,140,140,0');assert.equal(restored.settings.wiping_volumes_use_custom_matrix,'0');
  const remaining=settings=>Object.fromEntries(Object.entries(settingsWithoutPresetNames(settings)).filter(([key])=>!result.data.omitted_fields.includes(key)));
  assert.deepEqual(remaining(restored.settings),remaining(snapshot.settings));
  assert.equal(service.getSnapshot(snapshot.snapshot_id).settings.wiping_volumes_matrix,'0,150,200,0');
});
