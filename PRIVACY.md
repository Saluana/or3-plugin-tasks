# OR3 Tasks privacy

This statement describes the portable `or3sal.tasks` 0.2.0 plugin.

## Data used

The plugin stores the lists, task titles, notes, labels, due dates, difficulty,
completion status and subtasks that you enter. It uses OR3 Chat's plugin-scoped
storage, managed by the host where you install it. The host operator controls
that storage, its backups and access to the OR3 Chat instance.

## Sharing and connections

This plugin has no network, AI, analytics, advertising or external account
integration. Its only requested permissions are `storage.read` and
`storage.write`. It does not read your conversations or documents and does not
send task data to the publisher or an outside service. OR3 Chat itself and the
marketplace have their own data handling practices, separate from this plugin.

## Removing data

Use the plugin's task/list deletion controls to remove saved tasks. Uninstalling
a plugin is separate from deleting its stored data. Ask your OR3 Chat host
administrator about complete plugin-data removal and backup retention.

## Support

Report problems or ask questions at
<https://github.com/Saluana/or3-plugin-tasks/issues>. Issues are public; do not
include private task contents, account credentials or other sensitive data.
