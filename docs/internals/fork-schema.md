# Fork schema and data

This fork adds thread fields, tables, and sync history that upstream does not know. Each lives
where an upstream merge cannot silently drop or mask it.

## Migrations

Fork schema changes run from their own ledger, `fork_sql_migrations`, after upstream's migrator
(`apps/server/src/persistence/fork/ForkMigrations.ts`). Never add a fork migration to
`persistence/Migrations.ts`: upstream skips every id at or below the highest recorded one, so a fork
row there masks upstream's migration at that id forever (see
[Divergent migration ids](legacy-orchestration-migration.md#divergent-migration-ids)).

Fork builds before this ledger recorded their migrations in upstream's table. On startup,
`reconcileForkLedger` moves only rows whose names are known fork migrations, replays the upstream
migrations those builds had shadowed, and records them under upstream's names. Any other unknown
row stays for upstream's divergence warning. Every fork migration checks before it alters, because a
database may already carry its schema from the old ledger.

## Thread fields

Highlights, dependency links, snooze notes, and continuation links are optional fields on
orchestration v2's thread (`packages/contracts/src/forkOrchestration.ts`, spread into
`orchestrationV2.ts`). They ride in the thread's `payload_json`, so they need no projection columns
and every thread event carries them. Mutations go through one fork command, `thread.fork.update`,
decided in `orchestration-v2/fork/ForkThreadMutations.ts`. Timers and reactions to other threads
live in `ForkThreadReactor.ts`, which only dispatches commands.

## The v2 cutover

Upstream's importer copies `state.sqlite` to `statev2.sqlite` and reads upstream's v1 columns only.
`ForkLegacyImport.aroundLegacyImport` wraps its shell import: it rewrites the fork's v1 thread
references to upstream's record shape first, because the importer decodes message context strictly,
then carries the fork's thread columns onto the v2 threads. Both are idempotent.

## Sync

Sync history lives in `fork_project_sync_records`, not in the event log. Imported conversations are
v2 threads with `historyOrigin: "v1_import"` and run-less history: the same shape upstream gives a
pre-v2 thread, so the orchestrator hands that history to the provider when a continued copy first
runs. The orchestrator refuses `message.dispatch` on `t3sync-` threads. A pending recovery restore
runs before the cutover, so a restored pre-v2 backup is migrated again rather than shadowed by an
existing `statev2.sqlite`.
