import test from 'node:test';
process.env.DEMO_AUTH='true';
import assert from 'node:assert/strict';
import { executeCoreRequest as core, getOrCreateSession } from '../agent-core/src/index.ts';
import { issueApproval } from '../agent-core/src/approvals.ts';
import { validateAGUISurface } from '../../packages/protocol-core/src/ag-ui.ts';
import type { UIComponentNode } from '../../packages/protocol-core/src/ag-ui.ts';

const surface=(view:UIComponentNode)=>({version:'1.0.0',sessionId:'p1_session',timestamp:Date.now(),view});

test('P1-12: dispatching an action advertised only by disabled buttons is rejected explicitly',async()=>{
  const sessionId='p1_disabled_session';
  await core('POST','/api/a2ui/intent',{},{sessionId,text:'show my wallet'});
  const state=getOrCreateSession(sessionId);
  state.currentSurface!.view={type:'SurfaceCard',id:'c',children:[
    {type:'Button',id:'go',properties:{label:'Activate',disabled:true},
      onEvents:[{event:'onPress',actionType:'AGENT_ACTION_DISPATCH',payload:{action:'activate_parking'}}]},
  ]};
  issueApproval(state);
  const res=await core('POST','/api/a2ui/action',{},{sessionId,surfaceRevision:state.currentSurface!.revision,action:'activate_parking',payload:{}});
  assert.equal(res.status,409);
  assert.equal(res.data.code,'ACTION_DISABLED');
  assert.match(res.data.error,/disabled for the current review state/);
});

test('P1-13: a dispatch without an explicit selected resource fails closed instead of using a demo default',async()=>{
  const sessionId='p1_selection_session';
  await core('POST','/api/a2ui/intent',{},{sessionId,text:'show my wallet'});
  const state=getOrCreateSession(sessionId);
  state.currentSurface!.view={type:'SurfaceCard',id:'c',children:[
    {type:'Button',id:'go',properties:{label:'Activate parking'},
      onEvents:[{event:'onPress',actionType:'AGENT_ACTION_DISPATCH',payload:{action:'activate_parking'}}]},
  ]};
  issueApproval(state);
  const res=await core('POST','/api/a2ui/action',{},{sessionId,surfaceRevision:state.currentSurface!.revision,action:'activate_parking',payload:{}});
  assert.equal(res.status,409);
  assert.match(res.data.error,/parking zone/);
});

test('P1-14: choice groups enforce option integrity and coherent preselections',()=>{
  const group=(properties:Record<string,unknown>):UIComponentNode=>({type:'SurfaceCard',id:'c',children:[{type:'ChoiceGroup',id:'g',properties}]});
  assert.equal(validateAGUISurface(surface(group({options:[{id:'a',title:'A'}],selectedId:'a'}))).success,true);
  assert.equal(validateAGUISurface(surface(group({options:[{id:'a',title:'A'}]}))).success,true,'selectedId stays optional');
  for(const properties of [
    {options:[{id:'',title:'A'}]},
    {options:[{id:'a',title:'   '}]},
    {options:[{id:'a',title:'A',},],selectedId:'missing'},
    {options:[{id:'a',title:'A'}],selectedId:7},
  ]){
    assert.equal(validateAGUISurface(surface(group(properties))).success,false,JSON.stringify(properties));
  }
});
