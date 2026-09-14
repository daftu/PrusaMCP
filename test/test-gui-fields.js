import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { GUI_SCRIPT, numericFieldValue } from '../build/tools/gui-fields.js';
function harness({value='15',enabled=true,duplicate=false,validationDialog=false}={}) {
 let current=value, writes=0, tabs=0, frontmost=false;
 const field={role:()=> 'AXTextField',enabled:()=>enabled, attributes:{byName:()=>({value:()=> 'Top surface speed.\ndefault value\t: 50\nparameter name\t: top_solid_infill_speed'})}};
 Object.defineProperty(field,'value',{get:()=>()=>current,set:v=>{current=v;writes++;}});
 const root={role:()=> 'AXWindow',uiElements:()=>[{role:()=> 'AXGroup',name:()=> 'Speed',uiElements:()=>duplicate?[field,field]:[field]}]};
 root.name=()=> 'model';
 const windowList=()=>tabs && validationDialog ? [root,{uiElements:()=>[],name:()=> 'Validation'}] : [root];
 windowList.whose=()=>()=>[root];
 const process={windows:windowList};
 Object.defineProperty(process,'frontmost',{get:()=>()=>frontmost,set:v=>{frontmost=v;}});
 const context={ObjC:{import:()=>{}},$:{NSThread:{sleepForTimeInterval:()=>{}}},Application:()=>({applicationProcesses:{whose:()=>[process]},keyCode:()=>tabs++})};
 vm.createContext(context);vm.runInContext(GUI_SCRIPT,context);
 return {run:r=>JSON.parse(context.run([JSON.stringify({window:{pid:1,id:2,title:'model'},...r})])),state:()=>({current,writes,tabs})};
}
test('live fields use native parameter names and disclose limited coverage',()=>{
 const h=harness(); const r=h.run({});assert.equal(r.fields[0].parameter,'top_solid_infill_speed');assert.equal(r.fields[0].value,'15');assert.equal(r.coverage,'currently_exposed_controls_only');assert.equal(h.state().writes,0);
});
test('stale expected value cannot edit the field',()=>{
 const h=harness();assert.throws(()=>h.run({parameter:'top_solid_infill_speed',expected_value:'50',value:'20'}),/differs/);assert.equal(h.state().writes,0);
});
test('disabled and ambiguous controls cannot be written',()=>{
 for(const options of [{enabled:false},{duplicate:true}]) {const h=harness(options);assert.throws(()=>h.run({parameter:'top_solid_infill_speed',expected_value:'15',value:'20'}));assert.equal(h.state().writes,0);}
});
test('same-value request is a no-op without a keyboard commit',()=>{
 const h=harness();const r=h.run({parameter:'top_solid_infill_speed',expected_value:'15',value:'15'});assert.equal(r.changed,false);assert.deepEqual(h.state(),{current:'15',writes:0,tabs:0});
});
test('authorized numeric write returns readback without saving',()=>{
 const h=harness();const r=h.run({parameter:'top_solid_infill_speed',expected_value:'15',value:'20'});assert.equal(r.actual,'20');assert.equal(r.saved,false);assert.equal(r.verification,'readback_matches');assert.deepEqual(h.state(),{current:'20',writes:1,tabs:1});
});
test('input boundary rejects expressions, non-finite numbers and arbitrary text',()=>{
 for(const v of ['15','0.42','-0.2','60%']) assert.equal(numericFieldValue(v),true);
 for(const v of ['NaN','Infinity','1; delete all','PLA','1e309','']) assert.equal(numericFieldValue(v),false);
});

test('retained editor text plus validation dialog is not reported as success',()=>{
 const h=harness({validationDialog:true});const r=h.run({parameter:'top_solid_infill_speed',expected_value:'15',value:'-20'});
 assert.equal(r.verification,'validation_pending');assert.equal(r.committed,null);assert.equal(r.saved,false);
 assert.equal(h.state().current,'-20');
});
