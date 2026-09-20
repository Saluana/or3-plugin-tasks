import { createPortableClient, createPortablePlugin, defineOr3Plugin, definePortableUi, ui } from '@or3/plugin-sdk';
import { TASKS_MANIFEST } from './manifest.mjs';
import { LABELS, STATUSES, newId, text, readStore, validateStore, taskFields, visibleTasks } from './lib/tasks.mjs';
export { TASKS_MANIFEST };
const KEY = 'task-lists-v1';
const preview = (value, limit = 80) => value.length > limit ? value.slice(0, limit - 1) + '…' : value;
const choices = values => values.map(value=>({value,label:value}));
export function createTasksPlugin(client = createPortableClient()) {
  const state = { store: null, listId: '', editing: '', query: '', filter: 'all', sort: 'manual', page: 0, error: '', notice: '', deleting: '', busy: false, draft: null };
  let context;
  const list = () => state.store?.lists.find(l=>l.id === state.listId);
  function render() {
    const nodes = [];
    if (state.error) nodes.push(ui.text(state.error));
    if (state.notice) nodes.push(ui.text(state.notice));
    if (!state.store) { nodes.push(ui.button('retry','Retry loading','tasks.reload')); context.render(definePortableUi({title:'OR3 Tasks',nodes})); return; }
    const current = list();
    nodes.push(ui.form('lists',[
      ...(state.store.lists.length ? [ui.select('listId','Task list', state.store.lists.map(l=>({value:l.id,label:preview(l.title,40)})), {value:state.listId}), ui.button('open','Open list','tasks.open')] : []),
      ui.textField('newListTitle','New list name',{placeholder:'Work, home, or a project'}),
      ui.button('create-list','Create list','tasks.create-list',{disabled:state.busy}),
    ]));
    if (!current) { context.render(definePortableUi({title:'OR3 Tasks',nodes})); return; }
    nodes.push(ui.form('list-settings',[
      ui.textField('listTitle','List name',{value:current.title}),
      ui.button('rename-list','Rename list','tasks.rename-list',{disabled:state.busy}),
      ui.button('delete-list','Delete list','tasks.ask-delete-list',{variant:'danger',disabled:state.busy}),
    ]));
    const complete = current.tasks.filter(t=>t.status==='done').length;
    nodes.push(ui.text(`${complete} of ${current.tasks.length} tasks complete.`));
    nodes.push(ui.form('filters',[
      ui.textField('query','Search tasks',{value:state.query}),
      ui.select('filter','Status',choices(['all',...STATUSES]),{value:state.filter}),
      ui.select('sort','Sort',choices(['manual','due','hardest','easiest']),{value:state.sort}),
      ui.button('filter-tasks','Apply filters','tasks.filter'),
    ]));
    const tasks = visibleTasks(current.tasks,state.query,state.filter,state.sort);
    const pages = Math.max(1,Math.ceil(tasks.length/4)); state.page=Math.min(state.page,pages-1);
    for (const task of tasks.slice(state.page*4,state.page*4+4)) nodes.push(ui.box(
      ui.text(`${task.status==='done'?'✓ ':''}${preview(task.title)}`),
      ui.text(`${task.status} · ${task.label} · difficulty ${task.difficulty}/5${task.due?' · due '+task.due:''} · ${task.subtasks.filter(s=>s.done).length}/${task.subtasks.length} subtasks`),
      ui.row(ui.button('edit-'+task.id,'Edit','tasks.edit:'+task.id),ui.button('toggle-'+task.id,task.status==='done'?'Reopen':'Complete','tasks.toggle:'+task.id,{disabled:state.busy}),ui.button('up-'+task.id,'Move up','tasks.up:'+task.id,{disabled:state.busy||state.sort!=='manual'})),
    ));
    if (!tasks.length) nodes.push(ui.text('No tasks match. Add your first task below.'));
    if(pages>1) nodes.push(ui.row(ui.button('previous','Previous','tasks.previous',{disabled:state.page===0}),ui.text(`Page ${state.page+1} of ${pages}`),ui.button('next','Next','tasks.next',{disabled:state.page+1>=pages})));
    const edited=current.tasks.find(t=>t.id===state.editing);
    const draft=state.draft ?? edited ?? {title:'',notes:'',due:'',status:'todo',label:'uncategorized',difficulty:3};
    nodes.push(ui.form('task-editor',[
      ui.textField('title',edited?'Edit task':'New task',{value:draft.title,required:true}),
      ui.textarea('notes','Notes',{value:draft.notes,rows:3}),
      ui.textField('due','Due date (YYYY-MM-DD)',{value:draft.due}),
      ui.select('status','Task status',choices(STATUSES),{value:draft.status}),
      ui.select('label','Label',choices(LABELS),{value:draft.label}),
      ui.select('difficulty','Difficulty',choices(['1','2','3','4','5']),{value:String(draft.difficulty)}),
      ui.button('save-task',edited?'Save task':'Add task','tasks.save',{disabled:state.busy}),
      ui.button('cancel-edit','Clear editor','tasks.cancel'),
    ]));
    if(edited) {
      nodes.push(ui.button('delete-task','Delete this task','tasks.ask-delete-task',{variant:'danger',disabled:state.busy}));
      for(const sub of edited.subtasks) nodes.push(ui.row(ui.text((sub.done?'✓ ':'')+preview(sub.title)),ui.button('sub-'+sub.id,sub.done?'Reopen':'Complete','tasks.sub-toggle:'+sub.id,{disabled:state.busy}),ui.button('remove-'+sub.id,'Remove','tasks.sub-remove:'+sub.id,{disabled:state.busy})));
      nodes.push(ui.form('subtask',[ui.textField('subtask','New subtask'),ui.button('add-subtask','Add subtask','tasks.sub-add',{disabled:state.busy})]));
    }
    if(state.deleting) nodes.push(ui.box(ui.text('Permanently delete '+(state.deleting==='list'?'this list and all its tasks?':'this task and its subtasks?')),ui.button('confirm-delete','Confirm deletion','tasks.confirm-delete',{variant:'danger',disabled:state.busy}),ui.button('cancel-delete','Keep it','tasks.keep')));
    context.render(definePortableUi({title:'OR3 Tasks',nodes}));
  }
  function fieldValues() {
    const current = list();
    const task = state.draft ?? current?.tasks.find(t=>t.id===state.editing) ?? {title:'',notes:'',due:'',status:'todo',label:'uncategorized',difficulty:3};
    return {listId:state.listId,listTitle:current?.title??'',newListTitle:'',query:state.query,filter:state.filter,sort:state.sort,title:task.title,notes:task.notes,due:task.due,status:task.status,label:task.label,difficulty:String(task.difficulty),subtask:''};
  }
  async function load() {
    const result=await context.storage.get(KEY);
    if(!result.ok) throw new Error(result.error?.message||'Task storage is unavailable.');
    state.store=readStore(result.value); state.listId=state.store.lists[0]?.id??''; state.error='';
  }
  async function mutate(change) {
    if(state.busy) throw new Error('A save is already in progress.');
    state.busy=true;
    try {
      const next=JSON.parse(JSON.stringify(state.store));
      change(next,next.lists.find(l=>l.id===state.listId)); validateStore(next);
      const result=await context.storage.set(KEY,next);
      if(!result.ok) throw new Error(result.error?.message||'Could not save tasks. Your changes have not been stored.');
      state.store=next; state.notice='Saved.';
    } finally { state.busy=false; }
  }
  async function handle(params={}) {
    const action=typeof params.action==='string'?params.action:'';const v=params.values??{};
    state.error='';state.notice='';
    try {
      if(state.busy) throw new Error('A save is already in progress.');
      if(action==='tasks.reload'||action==='host.first-action.run') { await load();render();return {ok:true,fieldValues:fieldValues()}; }
      if(!state.store) throw new Error('Load your saved tasks before editing.');
      if(state.busy) throw new Error('A save is already in progress.');
      if(action==='tasks.open') { state.listId=state.store.lists.some(l=>l.id===v.listId)?v.listId:state.listId;state.editing='';state.draft=null;state.deleting='';state.page=0; }
      else if(action==='tasks.create-list') { const id=newId();await mutate(s=>s.lists.push({id,title:text(v.newListTitle,100,true),tasks:[]}));state.listId=id;state.editing='';state.draft=null;state.deleting=''; }
      else if(action==='tasks.rename-list') await mutate((s,l)=>{l.title=text(v.listTitle,100,true);});
      else if(action==='tasks.filter') {state.query=text(v.query??'',160);state.filter= ['all',...STATUSES].includes(v.filter)?v.filter:'all';state.sort=['manual','due','hardest','easiest'].includes(v.sort)?v.sort:'manual';state.page=0;}
      else if(action.startsWith('tasks.edit:')) {state.editing=action.slice(11);state.draft=null;state.deleting='';}
      else if(action==='tasks.cancel') {state.editing='';state.draft=null;state.deleting='';}
      else if(action==='tasks.save') { const fields=taskFields(v); state.draft={...fields};await mutate((s,l)=>{ const t=l.tasks.find(t=>t.id===state.editing); if(t) Object.assign(t,fields);else l.tasks.push({id:newId(),...fields,subtasks:[]});});state.editing='';state.draft=null; }
      else if(action.startsWith('tasks.toggle:')) await mutate((s,l)=>{const t=l.tasks.find(t=>t.id===action.slice(13));if(!t) throw new Error('Task no longer exists.');t.status=t.status==='done'?'todo':'done';});
      else if(action.startsWith('tasks.up:')) await mutate((s,l)=>{const i=l.tasks.findIndex(t=>t.id===action.slice(9));if(i>0)[l.tasks[i-1],l.tasks[i]]=[l.tasks[i],l.tasks[i-1]];});
      else if(action==='tasks.sub-add') await mutate((s,l)=>{const t=l.tasks.find(t=>t.id===state.editing);if(!t)throw new Error('Select a task first.');t.subtasks.push({id:newId(),title:text(v.subtask,160,true),done:false});});
      else if(action.startsWith('tasks.sub-toggle:')||action.startsWith('tasks.sub-remove:')) await mutate((s,l)=>{const t=l.tasks.find(t=>t.id===state.editing);if(!t)throw new Error('Select a task first.');const id=action.split(':')[1];const sub=t.subtasks.find(s=>s.id===id);if(!sub)throw new Error('Subtask no longer exists.');if(action.startsWith('tasks.sub-toggle:'))sub.done=!sub.done;else t.subtasks=t.subtasks.filter(s=>s.id!==id);});
      else if(action==='tasks.ask-delete-list') state.deleting='list';
      else if(action==='tasks.ask-delete-task') state.deleting='task';
      else if(action==='tasks.keep') state.deleting='';
      else if(action==='tasks.confirm-delete'&&state.deleting) {await mutate((s,l)=>{if(state.deleting==='list')s.lists=s.lists.filter(x=>x.id!==state.listId);else l.tasks=l.tasks.filter(t=>t.id!==state.editing);});if(!list())state.listId=state.store.lists[0]?.id??'';state.editing='';state.draft=null;state.deleting='';}
      else if(action==='tasks.next') state.page++;
      else if(action==='tasks.previous') state.page=Math.max(0,state.page-1);
      else throw new Error('Unknown task action.');
      render();return {ok:true,fieldValues:fieldValues()};
    } catch(error) {state.error=error instanceof Error?error.message:'Task action failed.';render();return {ok:false,message:state.error};}
  }
  const definition=defineOr3Plugin({manifest:TASKS_MANIFEST,async setup(ctx){context=ctx;ctx.features.require('or3-portable-client-v1');ctx.onRequest('runtime.ui-event',handle);try{await load();}catch(error){state.error=error.message;}render();}});
  return {definition,client,state};
}
const plugin=createTasksPlugin();
export default createPortablePlugin(plugin.definition,{client:plugin.client});
