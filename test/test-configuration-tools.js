import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerProfileTools } from '../build/tools/profiles.js';
import { registerValidateSettings } from '../build/tools/validate-settings.js';

const revision = {kind:'file',sha256:'a'.repeat(64)};
const snapshot = {snapshot_id:'snapshot-fixture',revision,version:'2.9.6',technology:'FFF',extruder_count:1,
  settings:{layer_height:'0.2',nozzle_diameter:'0.4'},layers:[{source:'saved_file',description:'saved fixture'}],omitted_fields:[],unsupported_fields:[],converted_fields:[],input_diagnostics_known:true};

test('configuration MCP schemas validate resolve, typed validation and private native failures',async t=>{
  let nativeCalls=0;
  const service={profiles:{listPrinterModels:async()=>[],listPresets:async()=>{throw new Error('native_validation_failed: secret-value-must-not-escape');}},
    resolveFile:async()=>snapshot,resolvePresets:async()=>snapshot,getSnapshot:()=>snapshot,
    validateNative:async()=>{nativeCalls++;},exportConfiguration:async()=>{throw new Error('output_exists: private-native-message');}};
  const server=new McpServer({name:'configuration-tools-test',version:'1'});
  registerProfileTools(server,service); registerValidateSettings(server,service);
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'configuration-test',version:'1'});
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async()=>{await client.close();await server.close();});
  const tools=await client.listTools();
  for (const tool of tools.tools) assert.equal(tool.outputSchema.type,'object',tool.name);
  const call=async(name,args)=>{
    const result=await client.callTool({name,arguments:args});
    assert.deepEqual(JSON.parse(result.content.find(c=>c.type==='text').text),result.structuredContent);
    return result;
  };
  const resolved=await call('resolve_configuration',{base:{type:'file',path:'fixture.ini'}});
  assert.equal(resolved.structuredContent.data.revision.sha256,revision.sha256);
  const valid=await call('validate_settings',{snapshot_revision:revision.sha256,changes:[{address:{scope:'global',key:'layer_height'},value:0.15}]});
  assert.equal(valid.structuredContent.data.native_validated,true); assert.equal(nativeCalls,1);
  const invalid=await call('validate_settings',{snapshot_revision:revision.sha256,changes:[{address:{scope:'global',key:'exposure_time'},value:2}]});
  assert.equal(invalid.structuredContent.data.valid,false); assert.equal(nativeCalls,1);
  const failed=await call('list_presets',{printer_profile_id:'fixture',technology:'FFF'});
  assert.equal(failed.isError,true);assert.equal(failed.structuredContent.error.code,'native_validation_failed');
  assert.ok(!JSON.stringify(failed).includes('secret-value'));
  const exported=await call('export_configuration',{snapshot_id:'snapshot-fixture',format:'flat_ini',output_path:'output.ini'});
  assert.equal(exported.isError,true);assert.equal(exported.structuredContent.error.code,'output_exists');
  assert.ok(!JSON.stringify(exported).includes('private-native-message'));
  for (const name of ['import_configuration','export_configuration']) assert.equal(tools.tools.find(t=>t.name===name).annotations.readOnlyHint,false);
});
