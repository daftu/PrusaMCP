import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entries,model,mesh,writeFixture } from './project-fixtures.js';
import { analyzeModel } from '../build/model-analysis.js';
import { ConfigurationService } from '../build/config-resolver.js';
import { registerAnalyzeMesh } from '../build/tools/analyze-mesh.js';
import { registerCheckPrintability } from '../build/tools/check-printability.js';
import { registerSuggestOrientation } from '../build/tools/suggest-orientation.js';
import { registerRecommendProfile } from '../build/tools/recommend-profile.js';
import { registerGenerateConfig } from '../build/tools/generate-config.js';
import { registerPrintWizard } from '../build/tools/print-wizard.js';
import { registerEstimateCost } from '../build/tools/estimate-cost.js';
import { registerSlice } from '../build/tools/slice.js';
function tools(service, runner) { const tools={};const server={registerTool(name,config,handler){tools[name]=async args=>handler(config.inputSchema.parse(args));}};
 for(const register of [registerAnalyzeMesh,registerCheckPrintability,registerSuggestOrientation,registerGenerateConfig,registerPrintWizard,registerEstimateCost]) register(server);
 registerRecommendProfile(server,service);registerSlice(server,{executablePath:'fake',profilesDir:''},runner);return tools;
}
async function fixture(t) {const dir=await mkdtemp(join(tmpdir(),'model-analysis-'));t.after(()=>rm(dir,{recursive:true,force:true}));const project=await writeFixture(join(dir,'tetra.3mf')); const {mesh:parsed}=await analyzeModel(project);
 const stl=join(dir,'tetra.stl');await writeFile(stl,'solid tetra\n'+parsed.triangles.map(tri=>`facet normal ${tri.normal.x} ${tri.normal.y} ${tri.normal.z}\nouter loop\n`+[tri.v1,tri.v2,tri.v3].map(v=>`vertex ${v.x} ${v.y} ${v.z}\n`).join('')+'endloop\nendfacet\n').join('')+'endsolid tetra');return {dir,project,stl};}
test('AC03/04 actual analysis and recommendation handlers agree for equivalent STL/3MF and reject unavailable geometry',async t=>{
 const {dir,project,stl}=await fixture(t);const service=new ConfigurationService({executablePath:'',profilesDir:''});const snap=service.saveSnapshot({printer_technology:'FFF',nozzle_diameter:'.4',layer_height:'.2'}, {}, []); const call=tools(service);
 const a=(await call.analyze_mesh({file_path:stl})).structuredContent;
 const b=(await call.analyze_mesh({file_path:project})).structuredContent;
 assert.deepEqual(a.data.analysis,b.data.analysis);assert.equal(a.data.analysis.volume,1/6);
 for(const path of [stl,project]) {const result=(await call.recommend_profile({snapshot_id:snap.snapshot_id,goal:'strong',material_id:'PLA',model_ref:path})).structuredContent;
 assert.equal(result.source,'estimate');assert.equal(result.data.confidence,'heuristic');assert.deepEqual(result.data.analysis,a.data.analysis);}
 const empty=await writeFixture(join(dir,'empty.3mf'),entries(model('', '')));
 for(const path of [empty,join(dir,'missing.3mf')]) assert.equal((await call.recommend_profile({snapshot_id:snap.snapshot_id,goal:'strong',material_id:'PLA',model_ref:path})).isError,true);
});
test('AC05 transformed multiple objects and instances all contribute to saved geometry',async t=>{
 const {dir}=await fixture(t);const path=await writeFixture(join(dir,'many.3mf'),entries(model(`<object id="1">${mesh}</object><object id="2">${mesh}</object>`, '<item objectid="1"/><item objectid="1" transform="2 0 0 0 2 0 0 0 2 10 0 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>')));
 const result=(await tools().analyze_mesh({file_path:path})).structuredContent;
 assert.equal(result.data.evidence.printable_instances,3);assert.equal(result.data.analysis.triangleCount,12);assert.ok(Math.abs(result.data.analysis.volume-10/6)<1e-10);assert.deepEqual(result.data.analysis.boundingBox.size,{x:21,y:2,z:2});
});
test('AC06 all analysis consumers retain role exclusions and estimate provenance, including auto config slicing',async t=>{
 const {dir}=await fixture(t);const doubled=mesh.replace('</triangles>',mesh.split('<triangles>')[1].split('</triangles>')[0].repeat(2)+'</triangles>');
 const path=await writeFixture(join(dir,'modifier.3mf'),entries(model(`<object id="1">${doubled}</object>`),{'Metadata/Slic3r_PE_model.config':'<config><object id="1"><volume firstid="0" lastid="3"/><volume firstid="4" lastid="7"><metadata type="volume" key="volume_type" value="NegativeVolume"/></volume><volume firstid="8" lastid="11"><metadata type="volume" key="volume_type" value="ParameterModifier"/></volume></object></config>'}));
 let generated;
 const service=new ConfigurationService({executablePath:'',profilesDir:''});
 const snapshot=service.saveSnapshot({printer_technology:'FFF',nozzle_diameter:'.4',layer_height:'.2'}, {}, []);
 const call=tools(service,async(_config,args)=>{generated=await readFile(args[args.indexOf('--load')+1],'utf8');await writeFile(args[args.indexOf('--output')+1],'; generated fixture\nG1 X1\n');return {exitCode:0,stdout:'',stderr:''};});
 for(const name of ['analyze_mesh','check_printability','suggest_orientation','print_wizard','estimate_cost','recommend_profile','generate_prusaslicer_config','slice_prusaslicer']) {
  const args=name==='slice_prusaslicer' ? {stl_path:path,goal:'standard',material:'PLA',output_gcode:join(dir,'result.gcode')}
   : {file_path:path,stl_path:path,goal:'standard',material:'PLA',output_path:join(dir,'config.ini'),snapshot_id:snapshot.snapshot_id,material_id:'PLA',model_ref:path};
  const result=(await call[name](args)).structuredContent;
  assert.notEqual(result.status,'failed',JSON.stringify(result));
  const evidence=result.data.evidence??result.data.auto_config_evidence;
  assert.equal(evidence.coverage,'partial',name);assert.equal(evidence.effective_volume,'unknown');assert.deepEqual(evidence.excluded_roles,['NegativeVolume','ParameterModifier']);assert.equal(evidence.heuristic_source,'estimate');assert.match(result.warnings.join(' '),/toolpath/);
  if(result.data.analysis) assert.equal(result.data.analysis.volume,1/6);
  if(result.data.cost) assert.equal(result.data.cost.source,'estimate');
  if(result.data.estimates) assert.ok(result.data.estimates.every(e=>e.estimate.source==='estimate'));
 }
 assert.match(generated,/layer_height/);
});

test('AC02 omitted material does not create a PLA profile or auto config',async t=>{
 const {dir,stl}=await fixture(t);
 let runnerCalls=0;let loadedConfig;
 const call=tools(undefined,async(_config,args)=>{runnerCalls++;loadedConfig=args[args.indexOf('--load')+1];await writeFile(args[args.indexOf('--output')+1],'; generated fixture\nG1 X1\n');return {exitCode:0,stdout:'',stderr:''};});
 const wizard=(await call.print_wizard({file_path:stl,goal:'standard'})).structuredContent;
 assert.equal(wizard.status,'confirmed');
 assert.equal(wizard.data.profile,undefined);
 assert.equal(wizard.data.cost,undefined);
 assert.ok(wizard.data.questions.some(q=>/matériau/i.test(q.question)));
 await assert.rejects(call.generate_prusaslicer_config({goal:'standard',output_path:join(dir,'missing-material.ini')}),/material/);
 const auto=await call.slice_prusaslicer({stl_path:stl,goal:'standard',output_gcode:join(dir,'auto.gcode')});
 assert.equal(auto.isError,true);
 assert.match(auto.structuredContent.summary,/material_required/);
 assert.equal(runnerCalls,0);
 const configPath=join(dir,'provided.ini');await writeFile(configPath,'layer_height = 0.2\n');
 const explicit=(await call.slice_prusaslicer({stl_path:stl,config_path:configPath,goal:'standard',output_gcode:join(dir,'explicit.gcode')})).structuredContent;
 assert.equal(explicit.status,'confirmed');
 assert.equal(runnerCalls,1);
 assert.equal(loadedConfig,configPath);
});
