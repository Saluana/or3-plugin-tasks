import { applyPortableProfileToManifest, defineOr3PortableProfile } from '@or3/plugin-sdk/profile';
export function buildArtifacts() {
  const profile = defineOr3PortableProfile({
    profile: 'or3-portable-client-v1', destinations: [], connections: [],
    dataScopes: ['storage.read'], writes: ['storage.write'], features: ["or3-portable-workspace-v1"],
    settingsSchemaPath: 'settings.schema.json', fields: [],
    testAction: { operationId: 'storage.read', deadlineMs: 5000 },
    firstAction: { operationId: 'storage.read', label: 'Open your task lists', usesSampleContext: false },
  });
  const manifest = applyPortableProfileToManifest({
    manifestVersion: 2, kind: 'plugin', id: 'or3sal.tasks', name: 'OR3 Tasks', version: '0.3.1', license: 'GPL-3.0-only',
    description: 'Organize task lists with subtasks, notes, labels, due dates and progress.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0 || 2.0.1-dev.20260920.3' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: ['storage.read', 'storage.write', 'tools.register.client'],
    features: { required: [], optional: [] }, dependencies: { required: [], optional: [] },
    trust: 'isolated-client', settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
  }, profile);
  return { files: {
    'or3.manifest.json': JSON.stringify(manifest, null, 2)+'\n',
    'manifest.mjs': 'export const TASKS_MANIFEST = Object.freeze('+JSON.stringify(manifest,null,2)+');\n',
    ...profile.files,
  }};
}
