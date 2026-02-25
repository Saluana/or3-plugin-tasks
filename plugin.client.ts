import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';
import { mountTasksRuntime } from './src/tasks/runtime/register';

const tasksPlugin: Or3WorkspacePlugin = {
  id: 'or3-tasks',
  register(api) {
    const dispose = mountTasksRuntime();
    api.onCleanup(dispose);
  }
};

export default tasksPlugin;
