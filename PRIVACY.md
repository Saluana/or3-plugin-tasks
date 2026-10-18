# OR3 Tasks privacy

This statement describes the portable `or3sal.tasks` 0.3.2 plugin.

## Data used

The plugin stores the lists, task titles, notes, labels, due dates, difficulty,
completion status and subtasks that you enter. It uses OR3 Chat's plugin-scoped
storage, managed by the host where you install it. The host operator controls
that storage, its backups and access to the OR3 Chat instance.

## Sharing and connections

The plugin requests `storage.read`, `storage.write`, and
`tools.register.client`. Its optional chat tools are disabled by default and
use the same task storage when enabled. If you ask an assistant to use a Tasks
tool, its task data or result can become part of that conversation and be sent
to the AI provider configured by your OR3 Chat host. The plugin does not read
unrelated conversations or documents and makes no direct network, AI,
analytics, advertising, or publisher requests. OR3 Chat itself and the
marketplace have their own data handling practices, separate from this plugin.

## Removing data

Use the plugin's task/list deletion controls to remove saved tasks. Uninstalling
a plugin is separate from deleting its stored data. Ask your OR3 Chat host
administrator about complete plugin-data removal and backup retention.

## Support

Report problems or ask questions at
<https://github.com/Saluana/or3-plugin-tasks/issues>. Issues are public; do not
include private task contents, account credentials or other sensitive data.
