import { expect, test } from 'bun:test';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import { createTasksPlugin, TASKS_MANIFEST } from './client.mjs';
import { readStore, taskFields, validateStore, visibleTasks } from './tasks.mjs';
const KEY='task-lists-v1';
async function activate(storage, deny) {
  const host=createPortableTestHost({approvedGrants:TASKS_MANIFEST.requestedGrants,initialStorage:storage});
  const client=deny?{...host.client,call:(method,...args)=>method===deny?Promise.resolve({ok:false,code:'permission-denied',message:'denied'}):host.client.call(method,...args)}:host.client;
  const plugin=createTasksPlugin(client);
  await createPortablePlugin(plugin.definition,{client,bootstrap:host.bootstrap}).ready;
  return {...host,state:plugin.state,act:async(action,values={})=>(await host.invokeRequest('runtime.ui-event',{action,values})).result};
}
test('creates, edits, completes and persists tasks and subtasks',async()=>{
  const h=await activate();
  expect(await h.act('tasks.save',{title:'Ship plugin',notes:'Check staging',due:'2026-09-22',label:'work',difficulty:'4'})).toMatchObject({ok:true,fieldValues:{title:''}});
  const t=h.state.store.lists[0].tasks[0];
  expect(await h.act('tasks.edit:'+t.id)).toMatchObject({fieldValues:{title:'Ship plugin',notes:'Check staging'}});
  await h.act('tasks.sub-add',{subtask:'Install'});
  await h.act('tasks.sub-toggle:'+h.state.store.lists[0].tasks[0].subtasks[0].id);
  await h.act('tasks.save',{title:'Ship tested plugin',status:'doing',label:'health',difficulty:'2'});
  await h.act('tasks.toggle:'+t.id);
  const restored=await activate({[KEY]:h.storage.get(KEY)});
  expect(restored.state.store.lists[0].tasks[0]).toMatchObject({title:'Ship tested plugin',status:'done',subtasks:[{title:'Install',done:true}]});
});
test('deletes only after confirmation and supports an empty set of lists',async()=>{
  const h=await activate();
  await h.act('tasks.save',{title:'Temporary'});
  const id=h.state.store.lists[0].tasks[0].id;
  await h.act('tasks.edit:'+id);await h.act('tasks.ask-delete-task');
  expect(h.state.store.lists[0].tasks).toHaveLength(1);
  await h.act('tasks.keep');expect((await h.act('tasks.confirm-delete')).ok).toBe(false);
  await h.act('tasks.ask-delete-task');await h.act('tasks.confirm-delete');
  expect(h.state.store.lists[0].tasks).toHaveLength(0);
  await h.act('tasks.ask-delete-list');expect((await h.act('tasks.confirm-delete')).ok).toBe(true);
  expect(h.state.store.lists).toHaveLength(0);
  expect((await h.act('tasks.create-list',{newListTitle:'Work'})).ok).toBe(true);
  await h.act('tasks.rename-list',{listTitle:'Home'});
  expect(h.state.store.lists[0].title).toBe('Home');
});
test('refuses storage corruption and denied reads/writes without overwriting data',async()=>{
  const broken={schemaVersion:99,lists:[]};
  const h=await activate({[KEY]:broken});
  expect((await h.act('tasks.save',{title:'No'})).ok).toBe(false);
  expect(h.storage.get(KEY)).toEqual(broken);
  const denied=await activate(undefined,'storage.set');
  expect((await denied.act('tasks.save',{title:'No'})).ok).toBe(false);
  expect(denied.state.store.lists[0].tasks).toHaveLength(0);
  expect(denied.storage.has(KEY)).toBe(false);
  const unreadable=await activate(undefined,'storage.get');
  expect(unreadable.state.store).toBeNull();
});
test('validates input and quotas',async()=>{
  expect(()=>taskFields({title:'',due:''})).toThrow();
  expect(()=>taskFields({title:'x',due:'2026-02-30'})).toThrow();
  expect(()=>taskFields({title:'x',difficulty:8})).toThrow();
  const h=await activate();
  expect((await h.act('tasks.save',{title:'x'.repeat(161)})).ok).toBe(false);
  expect(h.state.store.lists[0].tasks).toHaveLength(0);
  const s=readStore(null);s.lists=Array.from({length:13},(_,i)=>({id:'list-'+i,title:'List',tasks:[]}));
  expect(()=>validateStore(s)).toThrow();
});
test('searches, filters, sorts and reorders without mutating the source',async()=>{
  const tasks=[{title:'A',notes:'urgent',label:'work',status:'todo',difficulty:1,due:''},{title:'B',notes:'',label:'home',status:'done',difficulty:5,due:'2026-09-20'}];
  expect(visibleTasks(tasks,'urgent','todo','manual')).toEqual([tasks[0]]);
  expect(visibleTasks(tasks,'','all','due')[0]).toBe(tasks[1]);
  expect(visibleTasks(tasks,'','all','hardest')[0]).toBe(tasks[1]);
  expect(tasks[0].title).toBe('A');
  const h=await activate();await h.act('tasks.save',{title:'A'});await h.act('tasks.save',{title:'B'});
  await h.act('tasks.up:'+h.state.store.lists[0].tasks[1].id);
  expect(h.state.store.lists[0].tasks[0].title).toBe('B');
});
test('renders maximum-size supported task data within host limits',async()=>{
  const s=readStore(null);
  s.lists=Array.from({length:12},(_,i)=>({id:'list-'+i,title:'界'.repeat(100),tasks:[]}));
  s.lists[0].tasks=Array.from({length:4},(_,i)=>({id:'task-'+i,...taskFields({title:'界'.repeat(160),notes:'界'.repeat(1500)}),subtasks:Array.from({length:12},(_,j)=>({id:`sub-${i}-${j}`,title:'界'.repeat(160),done:false}))}));
  const h=await activate({[KEY]:s});
  expect((await h.act('tasks.edit:task-0')).ok).toBe(true);
  expect((await h.act('tasks.ask-delete-task')).ok).toBe(true);
});
