import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationService } from '../build/config-resolver.js';
import { recommendProfile, recommendProfileDelta } from '../build/profile-engine.js';
import { validateSettingChanges } from '../build/setting-catalog.js';
import { registerRecommendProfile } from '../build/tools/recommend-profile.js';

export function fixtureSnapshot() {
  const service = new ConfigurationService({executablePath:'',profilesDir:''});
  const snapshot = service.saveSnapshot({printer_technology:'FFF', printer_model:'COREONE', nozzle_diameter:'0.4',
    min_layer_height:'0.07',max_layer_height:'0.3', layer_height:'0.2', perimeters:'3',fill_density:'15%',fill_pattern:'grid',
    spiral_vase:'0',top_solid_layers:'5',support_material:'0',perimeter_speed:'60',external_perimeter_speed:'40',infill_speed:'100',solid_infill_speed:'80',top_solid_infill_speed:'40',
    max_volumetric_speed:'8',filament_max_volumetric_speed:'6',start_gcode:'G28\\nCORE_ONE_START',end_gcode:'CORE_ONE_END',machine_max_acceleration_x:'4000',temperature:'220',bed_temperature:'60'}, {}, []);
  return {service,snapshot};
}
function handler(service) { let tool; registerRecommendProfile({registerTool(name,config,fn){tool={config,fn};}},service); return args=>tool.fn(tool.config.inputSchema.parse(args)); }

test('AC01 PLA, TPU, vase and strong deltas preserve CORE One machine settings and profile limits', () => {
  const {snapshot}=fixtureSnapshot(); const original=structuredClone(snapshot);
  for (const [goal, material] of [['standard','PLA'],['speed','TPU'],['vase','PLA'],['strong','PLA']]) {
    const delta=recommendProfileDelta(snapshot,goal,material);
    const validated=validateSettingChanges(snapshot,snapshot.revision.sha256,delta.changes.map(c=>({address:c.address,value:c.after})));
    assert.equal(validated.valid,true,JSON.stringify(validated.errors));
    const next={...snapshot.settings,...validated.overrides};
    for(const key of ['start_gcode','end_gcode','machine_max_acceleration_x','temperature','bed_temperature','nozzle_diameter','max_volumetric_speed','filament_max_volumetric_speed','min_layer_height','max_layer_height']) assert.equal(next[key],snapshot.settings[key],key);
    assert.equal(delta.source,'estimate'); assert.equal(delta.applied,false);
    if(goal==='vase'){assert.equal(next.spiral_vase,'1');assert.equal(next.fill_density,'0%');assert.equal(next.perimeters,'1');assert.equal(next.top_solid_layers,'0');}
    if(goal==='strong') {assert.equal(next.perimeters,'5');assert.equal(next.fill_density,'50%');}
    if(material==='TPU') assert.ok(Number(next.infill_speed)<=25);
  }
  assert.deepEqual(snapshot,original);
});
test('AC02 unknown material and goal fail explicitly in engine and actual handler',async()=>{
 const {service,snapshot}=fixtureSnapshot();const call=handler(service);
 for (const [goal,material] of [['unknown','PLA'],['standard','unknown']]) {
  assert.throws(()=>recommendProfile('CORE One',.4,goal,material),/unknown_/);
  const result=await call({snapshot_id:snapshot.snapshot_id,goal,material_id:material});
  assert.equal(result.isError,true);assert.equal(result.structuredContent.data,null);
 }
});
test('resolved profile changes the recommendation and absent geometry stays absent',async()=>{
 const {service,snapshot}=fixtureSnapshot();const call=handler(service);
 const result=(await call({snapshot_id:snapshot.snapshot_id,goal:'quality',material_id:'PLA'})).structuredContent;
 assert.equal(result.data.analysis,undefined);assert.match(result.warnings.join(' '),/No model geometry/);
 const delta=recommendProfileDelta(snapshot,'quality','PLA');
 const lower={...snapshot,settings:{...snapshot.settings,perimeter_speed:'20'}};
 assert.notEqual(delta.changes.find(c=>c.address.key==='perimeter_speed').after,recommendProfileDelta(lower,'quality','PLA').changes.find(c=>c.address.key==='perimeter_speed').after);
});
