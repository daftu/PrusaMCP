// Explicit installed-slicer acceptance; uses only synthetic fixtures and temporary datadirs.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ConfigurationService} from '../../build/config-resolver.js';
import {validateSettings} from '../../build/tools/validate-settings.js';
import {getSettingCatalog,deserializeSetting,serializeSetting,validateSettingChanges} from '../../build/setting-catalog.js';
const executablePath=process.argv[2];
if(!executablePath)throw new Error('Usage: node test/acceptance/configuration.js /path/to/PrusaSlicer');
const dir=await mkdtemp('/tmp/prusamcp-g03-catalog-');
const service=new ConfigurationService({executablePath,profilesDir:''});
const results=[];
try{
for(const technology of ['FFF','SLA']){
 const input=join(dir,technology+'.ini');await writeFile(input,`printer_technology = ${technology}\n`);
 const snapshot=await service.resolveFile(input);const catalog=getSettingCatalog('2.9.6',technology);
 const serialized={};const typedChanges=[];let checked=0;
 for(const definition of catalog){
  const raw=snapshot.settings[definition.key]; if(raw===undefined)continue;
  const typed=deserializeSetting(definition,raw);
  const encoded=serializeSetting(definition,typed);
  assert.deepEqual(deserializeSetting(definition,encoded),typed,definition.key);
  assert.ok(!JSON.stringify(typed).includes('null'),definition.key+' non-finite numeric decoding');
  serialized[definition.key]=encoded;
  typedChanges.push({address:{scope:"global",key:definition.key},value:typed});checked++;
 }
 const boundary=validateSettingChanges(snapshot,snapshot.revision.sha256,typedChanges);
 assert.deepEqual(boundary.errors,[],`${technology} native values rejected by typed boundary`);
 const nativeValidation=await validateSettings(service,snapshot.revision.sha256,typedChanges);
 assert.equal(nativeValidation.native_validated,true);
 const roundtrip=await service.resolveFile(input,serialized);
 for(const key of Object.keys(serialized))assert.equal(roundtrip.settings[key],snapshot.settings[key],`${technology} ${key}`);
 if(technology==='FFF'){
 const nativeInvalid=await validateSettings(service,snapshot.revision.sha256,[{address:{scope:'global',key:'layer_height'},value:0}]);
 assert.equal(nativeInvalid.valid,false);assert.equal(nativeInvalid.native_validated,false);
  const changes=[['fill_density','25%'],['avoid_crossing_perimeters',true],['gcode_flavor','marlin2'],['temperature',[215]],['first_layer_bed_temperature',[60]],['filament_cooling_moves',[4]],['start_gcode','G28\nM117 a;b=c']].map(([key,value])=>({address:{scope:'global',key},value}));
  const valid=await validateSettings(service,snapshot.revision.sha256,changes);assert.equal(valid.native_validated,true);
  const overrides=Object.fromEntries(changes.map(({address,value})=>[address.key,serializeSetting(catalog.find(d=>d.key===address.key),value)]));
  const edited=await service.resolveFile(input,overrides);
  for(const {address,value} of changes)assert.deepEqual(deserializeSetting(catalog.find(d=>d.key===address.key),edited.settings[address.key]),value);
 }
 results.push({technology,checked,status:'PASS'});
}
console.log(JSON.stringify({version:'2.9.6',architecture:process.arch,results}));
}finally{await rm(dir,{recursive:true,force:true});}
