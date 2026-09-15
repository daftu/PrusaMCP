import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { domains } from '../build/tool-domains.js';
import { toolResultSchema } from '../build/contracts.js';
import { registerContractTool } from '../build/register-tool.js';
import { guiResult } from '../build/tools/gui-fields.js';
import { z } from 'zod';

const model = `solid tetra
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 0 10 0
vertex 10 0 0
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 0 10
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 0 10
vertex 0 10 0
endloop
endfacet
facet normal 1 1 1
outer loop
vertex 10 0 0
vertex 0 10 0
vertex 0 0 10
endloop
endfacet
endsolid tetra`;
function verify(name, response) {
  assert.ok(response.structuredContent, JSON.stringify(response));
  assert.deepEqual(JSON.parse(response.content.find(c => c.type === 'text').text), response.structuredContent);
  toolResultSchema(domains[name]).parse(response.structuredContent);
  return response.structuredContent;
}

test('STDIO tools/list exposes every output contract and read/write/failure calls agree with structured data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-contracts-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const file = join(dir,'tetra.stl'); await writeFile(file,model);
  const gcode = join(dir,'source.gcode'); await writeFile(gcode,';LAYER_CHANGE\nG1 X1\n');
  const transport = new StdioClientTransport({command:process.execPath,args:[resolve('build/index.js')],stderr:'pipe',env:{...process.env,HOME:dir,USERPROFILE:dir,PRUSASLICER_PATH:join(dir,'missing'),PRUSASLICER_PROFILES_DIR:dir}});
  let stderr=''; transport.stderr?.on('data', chunk => { stderr+=chunk; });
  const client = new Client({name:'contract-tests',version:'1'});
  await client.connect(transport); t.after(() => client.close());
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(t=>t.name).sort(),[...Object.keys(domains),'list_printer_models','list_presets','resolve_configuration','validate_settings','import_configuration','export_configuration'].sort());
  for (const tool of list.tools) {
    assert.equal(tool.outputSchema.type,'object', tool.name);
    assert.equal(typeof tool.annotations.readOnlyHint,'boolean',tool.name);
  }
  for (const name of ['generate_prusaslicer_config','submit_feedback','slice_prusaslicer','set_prusaslicer_field','open_prusaslicer_tab','screenshot_prusaslicer','postprocess_gcode','upload_print']) {
    assert.equal(list.tools.find(t=>t.name===name).annotations.readOnlyHint,false,name);
  }
  const call = async (name,args={}) => verify(name,await client.callTool({name,arguments:args}));
  const mesh = await call('analyze_mesh',{file_path:file});
  assert.equal(mesh.data.analysis.triangleCount,4); assert.equal(mesh.source,'file');
  await call('recommend_profile',{goal:'standard'});
  await call('check_printability',{file_path:file});
  await call('suggest_orientation',{file_path:file});
  const cost = await call('estimate_cost',{file_path:file}); assert.equal(cost.data.estimates.length,4);
  await call('estimate_cost',{file_path:file,compare_profiles:false});
  await call('print_wizard',{file_path:file,goal:'standard'});
  await call('search_filament',{material:'PLA'});
  await call('search_filament',{query:'no-such-filament-fixture'});
  await call('diagnose_print',{defect:'warping'});
  await call('diagnose_print',{defect:'no-such-defect-fixture'});
  await call('feedback_stats'); await call('export_feedback');
  const feedback = await call('submit_feedback',{model_name:'synthetic tetra',material:'PLA',printer:'Fixture',nozzle:0.4,goal:'standard',layer_height:0.2,infill_percent:15,perimeters:2,print_speed:40,nozzle_temp:210,bed_temp:60,support_used:false,brim_used:false,quality_score:4,adhesion_score:4,strength_score:4,overall_score:4});
  assert.equal(feedback.data.stored,true);
  const storedFeedback = JSON.parse(await readFile(join(dir,'.prusa-mcp','feedback.json'),'utf8'));
  assert.equal(storedFeedback.length,1);
  assert.equal(storedFeedback[0].modelName,'synthetic tetra');
  assert.equal((await call('feedback_stats')).data.stats.totalPrints,1);
  const exported = await call('export_feedback'); assert.equal(exported.data.print_count,1); assert.equal(exported.data.feedbacks[0].material,'PLA');
  const config = await call('generate_prusaslicer_config',{goal:'standard',output_path:join(dir,'result.ini')});
  assert.match(await readFile(config.data.artifact.path,'utf8'), /layer_height/);
  const partial = await call('postprocess_gcode',{gcode_path:gcode,actions:[{layer:1,type:'pause'},{layer:99,type:'pause'}]});
  assert.equal(partial.status,'partial'); assert.equal(partial.data.inserted,1);
  assert.match(await readFile(partial.data.output_path,'utf8'),/M601/);
  const failed = await client.callTool({name:'analyze_mesh',arguments:{file_path:join(dir,'missing.stl')}});
  assert.equal(failed.isError,true); assert.equal(verify('analyze_mesh',failed).status,'failed');
  assert.ok(failed.structuredContent.error.code);
  assert.match(stderr,/PrusaMCP/);
});

test('raw STDOUT contains JSON-RPC only and startup logs use STDERR', async () => {
  const child = spawn(process.execPath,[resolve('build/index.js')],{stdio:['pipe','pipe','pipe'],env:{...process.env,PRUSASLICER_PATH:'/missing-prusaslicer-fixture'}});
  let stdout='',stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'raw-test',version:'1'}}})+'\n');
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const messages=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(messages.length>0); assert.ok(messages.every(m=>m.jsonrpc==='2.0')); assert.match(stderr,/STDIO/);
});

test('GUI validation and normalized readback retain partial mutation evidence at registration boundary',async()=>{
  for (const verification of ['validation_pending','application_normalized_or_rejected_value']) {
    let invoke;
    registerContractTool({registerTool(_name,_options,fn){invoke=fn;}},'set_prusaslicer_field',{inputSchema:{parameter:z.string()}},async()=>guiResult(async()=>({editor_changed:true,saved:false,parameter:'layer_height',verification,committed:null,requested:'0.2',actual:'0.3'})));
    const response=await invoke({parameter:'layer_height'});
    const data=verify('set_prusaslicer_field',response);
    assert.equal(data.status,verification==='validation_pending'?'needs_user_action':'partial');
    assert.equal(data.data.editor_changed,true);assert.equal(data.data.saved,false);
  }
});
