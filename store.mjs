/**
 * Persistence for OR3 Tasks over the sandbox's `storage.*` capability.
 *
 * Layout (schemaVersion 2, see `tasks.mjs`):
 * - `task-lists-v2`      the ordered index: one entry per list (id, title, color)
 * - `task-list-v2:<id>`  one document per list: its tasks and subtasks
 *
 * One document per list keeps a write proportional to the list the user touched
 * and keeps every stored value inside the host's per-value budget, instead of
 * one blob that fails as soon as a single list grows.
 *
 * The schemaVersion 1 blob (`task-lists-v1`, written by Tasks 0.2.0) is read
 * once, migrated and deliberately left in place, so rolling back to the
 * published release still finds the user's data.
 */
import {
    LEGACY_KEY,
    ROOT_KEY,
    createRoot,
    emptyListDocument,
    planLegacyMigration,
    validateListDocument,
    validateRoot,
} from './tasks.mjs';

const documentKey = (listId) => `task-list-v2:${listId}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const MAX_PENDING_CLEANUP = 200;

function pendingCleanupIds(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_PENDING_CLEANUP ||
        value.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) ||
        new Set(value).size !== value.length) {
        throw new Error('Stored task cleanup state is invalid. Nothing has been overwritten.');
    }
    return value;
}

/**
 * Wraps the storage capability with the validated task model. Nothing here is
 * reachable without `storage.read`/`storage.write`: the SDK refuses the call
 * before it leaves the sandbox.
 */
export function createTaskStore(storage) {
    /** The validated index, or null before the first successful load. */
    let root = null;
    /** listId -> validated list document. */
    let documents = new Map();

    async function read(key) {
        const result = await storage.get(key);
        if (!result || result.ok !== true) {
            throw new Error(result?.error?.message || 'Task storage is unavailable.');
        }
        return result.value ?? null;
    }

    async function write(key, value) {
        const result = await storage.set(key, value);
        if (!result || result.ok !== true) {
            throw new Error(
                result?.error?.message || 'Could not save tasks. Your changes have not been stored.'
            );
        }
    }

    async function remove(key) {
        const result = await storage.delete(key);
        if (!result || result.ok !== true) {
            throw new Error(result?.error?.message || 'Could not update tasks.');
        }
    }

    /** Index entries joined with their tasks: what the sidebar and pane render. */
    function lists() {
        if (!root) return [];
        return root.lists.map((entry) => ({
            ...entry,
            tasks: documents.get(entry.id)?.tasks ?? [],
        }));
    }

    function find(listId) {
        return lists().find((entry) => entry.id === listId) ?? null;
    }

    async function adoptRoot(nextRoot) {
        pendingCleanupIds(nextRoot.cleanupPending);
        const entries = [];
        for (const entry of nextRoot.lists) {
            const stored = await read(documentKey(entry.id));
            entries.push([entry.id, validateListDocument(stored, entry.id)]);
        }
        root = nextRoot;
        documents = new Map(entries);
    }

    // The index commit includes removed IDs, so cleanup can be retried after a
    // failed delete or a restart without deleting a restored list document.
    async function flushCleanup() {
        const pending = pendingCleanupIds(root?.cleanupPending);
        if (pending.length === 0) return;
        const kept = new Set(root.lists.map((entry) => entry.id));
        const remaining = [];
        for (const id of pending) {
            if (kept.has(id)) continue;
            try {
                if (await read(documentKey(id)) !== null) {
                    await remove(documentKey(id));
                }
            } catch {
                remaining.push(id);
            }
        }
        if (same(pending, remaining)) return;
        const cleanedRoot = { ...root, cleanupPending: remaining };
        try {
            await write(ROOT_KEY, cleanedRoot);
            root = cleanedRoot;
        } catch {
            // The original committed queue stays durable and retries later.
        }
    }

    /**
     * Load the saved tasks, migrating the 0.2.0 blob on first use. Throws (and
     * leaves storage untouched) when the stored data is unrecognisable, so a
     * corrupt or newer format is never silently replaced.
     */
    async function load() {
        const stored = await read(ROOT_KEY);
        if (stored !== null && stored !== undefined) {
            await adoptRoot(validateRoot(stored));
            await flushCleanup();
            return { migrated: false };
        }
        const legacy = await read(LEGACY_KEY);
        if (legacy !== null && legacy !== undefined) {
            const plan = planLegacyMigration(legacy);
            for (const document of plan.documents) {
                await write(documentKey(document.id), document);
            }
            await write(ROOT_KEY, plan.root);
            root = plan.root;
            documents = new Map(plan.documents.map((document) => [document.id, document]));
            return { migrated: true, lists: plan.documents.length };
        }
        const fresh = createRoot();
        const document = emptyListDocument(fresh.lists[0].id);
        await write(documentKey(document.id), document);
        await write(ROOT_KEY, fresh);
        root = fresh;
        documents = new Map([[document.id, document]]);
        return { migrated: false };
    }

    /**
     * Apply one change to a copy of the whole store, validate the result, then
     * persist changed documents before publishing the index. Storage has no
     * multi-key transaction; interrupted new lists remain unreferenced.
     */
    async function mutate(change) {
        if (!root) throw new Error('Load your saved tasks before editing.');
        const nextRoot = clone(root);
        const nextDocuments = new Map(
            [...documents].map(([id, document]) => [id, clone(document)])
        );
        const outcome = change({ root: nextRoot, documents: nextDocuments });

        validateRoot(nextRoot);
        for (const entry of nextRoot.lists) {
            const document = nextDocuments.get(entry.id);
            if (!document) throw new Error('Stored task list is invalid.');
            validateListDocument(document, entry.id);
        }

        const kept = new Set(nextRoot.lists.map((entry) => entry.id));
        const changedDocuments = nextRoot.lists.filter(
            (entry) => !documents.has(entry.id) || !same(documents.get(entry.id), nextDocuments.get(entry.id))
        );
        const removedDocuments = [...documents.keys()].filter((id) => !kept.has(id));
        const pending = pendingCleanupIds(nextRoot.cleanupPending);
        const cleanupPending = [...new Set([...pending, ...removedDocuments])]
            .filter((id) => !kept.has(id));
        if (cleanupPending.length > MAX_PENDING_CLEANUP) {
            throw new Error('Old task-list cleanup is unavailable. Retry after storage recovers.');
        }
        if (cleanupPending.length > 0 || nextRoot.cleanupPending !== undefined) {
            nextRoot.cleanupPending = cleanupPending;
        }
        const rootChanged = !same(root, nextRoot);

        // Documents first, then the index, then removals. A write that fails
        // part-way can leave an unreferenced document behind, never an index
        // entry that points at a list whose document is missing.
        for (const entry of changedDocuments) {
            await write(documentKey(entry.id), nextDocuments.get(entry.id));
        }
        if (rootChanged) await write(ROOT_KEY, nextRoot);
        root = nextRoot;
        documents = new Map(nextRoot.lists.map((entry) => [entry.id, nextDocuments.get(entry.id)]));
        await flushCleanup();
        return outcome;
    }

    return { load, lists, find, mutate, loaded: () => root !== null,
        pendingCleanupCount: () => pendingCleanupIds(root?.cleanupPending).length };
}
