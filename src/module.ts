import { addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

export default defineNuxtModule({
  meta: {
    name: 'or3-plugin-tasks',
    configKey: 'or3PluginTasks'
  },
  setup() {
    const { resolve } = createResolver(import.meta.url);
    addPlugin(resolve('./runtime/plugin.client.ts'), { append: true });
  }
});
