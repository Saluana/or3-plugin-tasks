// Data-only chat tool catalog. Every operation runs through the same validated
// store as the pane and the sidebar, so chat edits and UI edits cannot diverge.
const string = {type:'string'};
const fields = {
  title:string,
  notes:string,
  due:string,
  status:{type:'string',enum:['todo','doing','done']},
  priority:{type:'string',enum:['none','low','medium','high']},
  label:{type:'string',enum:['none','work','home','health','study','errand']},
};
const tool = (name,description,properties,required=[]) => ({type:'function',function:{name:'or3sal_tasks_'+name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const TASK_TOOLS = [
  tool('search_lists','Find task lists and their tasks. Use this to obtain the current list and task IDs before editing.',{query:string}),
  tool('create_list','Create a task list.',{title:string},['title']),
  tool('update_list','Rename a task list.',{listId:string,title:string},['listId','title']),
  tool('delete_list','Delete a task list and its tasks only when the user explicitly asks for deletion.',{listId:string},['listId']),
  tool('add_item','Add a task to a list. Only send the fields you want to set.',{listId:string,...fields},['listId','title']),
  tool('update_item','Update task fields, including status todo/doing/done and priority none/low/medium/high. Fields left out are unchanged.',{listId:string,taskId:string,...fields},['listId','taskId']),
  tool('remove_item','Delete a task only when requested by the user.',{listId:string,taskId:string},['listId','taskId']),
  tool('reorganize','Reorder every task in a list. Include each task ID exactly once.',{listId:string,taskIds:{type:'array',items:string}},['listId','taskIds']),
  tool('create_subtask','Add a small step to a task.',{listId:string,taskId:string,title:string},['listId','taskId','title']),
  tool('complete_subtask','Complete or reopen a task step.',{listId:string,taskId:string,subtaskId:string,done:{type:'boolean'}},['listId','taskId','subtaskId','done']),
  tool('remove_subtask','Delete a task step when requested.',{listId:string,taskId:string,subtaskId:string},['listId','taskId','subtaskId']),
];
