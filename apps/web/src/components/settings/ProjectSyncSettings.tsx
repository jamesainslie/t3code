import { useState } from "react";
import {
  type EnvironmentId,
  type ProjectId,
  type ProjectSyncPreview,
  type ProjectSyncRequest,
} from "@t3tools/contracts";
import { newProjectId } from "../../lib/utils";
import { useProjectSync } from "../../hooks/useProjectSync";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function ProjectSyncSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const { data, error, pending, run } = useProjectSync(environmentId);
  const [source, setSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectSyncPreview | null>(null);
  const [matchedProjects, setMatchedProjects] = useState<Record<string, ProjectId>>({});
  const [nightly, setNightly] = useState(true);
  const [confirm, setConfirm] = useState<ProjectSyncRequest | null>(null);
  const submit = async (request: ProjectSyncRequest) => {
    try {
      const response = await run(request);
      setPreview(response.preview ?? null);
      setMatchedProjects(
        Object.fromEntries(
          (response.preview?.projects ?? []).flatMap((project) =>
            project.existing && project.projectId
              ? [[project.sourceProjectId, project.projectId]]
              : [],
          ),
        ),
      );
      setConfirm(null);
    } catch {
      /* The request error stays visible above the controls. */
    }
  };
  const sourceHome = source ?? data?.configuration.sourceHome ?? data?.defaultSourceHome ?? "";
  return (
    <section
      className="space-y-3 rounded-lg border border-border/60 p-4"
      aria-label="Sync from another T3 install"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Sync from another T3 install</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bring projects and conversation history into this fork. Your main install stays
            unchanged.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void submit({ operation: "status" })}
        >
          Refresh
        </Button>
      </div>
      {(error ?? data?.configuration.lastError) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? data?.configuration.lastError}
        </p>
      )}
      {data?.restorePending ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            Recovery is prepared and nightly sync is paused. Quit and restart this environment to
            restore the backup. Work since the backup will be rewound; a copy of the current state
            will be retained.
          </p>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void submit({ operation: "cancelRestore" })}
          >
            Cancel restore
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1 text-xs text-muted-foreground">
              Source T3 home on this environment’s machine
              <Input
                className="mt-1"
                value={sourceHome}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Path to the main T3 home"
                disabled={pending}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !sourceHome}
              onClick={() => void submit({ operation: "preview", sourceHome })}
            >
              {pending ? "Working…" : "Preview import"}
            </Button>
          </div>
          {preview && (
            <div className="space-y-3 rounded-md bg-muted/40 p-3">
              <p className="text-sm font-medium">Review projects</p>
              {preview.projects.map((project, index) => (
                <div
                  key={project.sourceProjectId}
                  className="space-y-1 border-b border-border/40 pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm">{project.title}</p>
                      <p className="break-all text-xs text-muted-foreground">
                        {project.workspaceRoot} · {project.threadCount} conversations
                      </p>
                    </div>
                    <select
                      aria-label={`Destination for ${project.title}`}
                      className="rounded-md border border-input bg-background p-2 text-xs"
                      disabled={
                        pending ||
                        project.warnings.some((warning) => warning.includes("remote host"))
                      }
                      value={
                        project.projectId === null ? "skip" : project.existing ? "existing" : "new"
                      }
                      onChange={(event) =>
                        setPreview({
                          ...preview,
                          projects: preview.projects.map((entry, i) =>
                            i !== index
                              ? entry
                              : {
                                  ...entry,
                                  projectId:
                                    event.target.value === "skip"
                                      ? null
                                      : event.target.value === "existing"
                                        ? (matchedProjects[project.sourceProjectId] ?? null)
                                        : newProjectId(),
                                  existing: event.target.value === "existing",
                                },
                          ),
                        })
                      }
                    >
                      {matchedProjects[project.sourceProjectId] && (
                        <option value="existing">Use existing project</option>
                      )}
                      <option value="new">Import as a new project</option>
                      <option value="skip">Skip</option>
                    </select>
                  </div>
                  {project.warnings.map((warning) => (
                    <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
                      {warning}
                    </p>
                  ))}
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={nightly}
                  onChange={(event) => setNightly(event.target.checked)}
                />
                Enable nightly sync at {data?.configuration.hour ?? 3}:00 (
                {data?.configuration.timezone})
              </label>
              <p className="text-xs text-muted-foreground">
                Imported conversations stay read-only. Continue in fork creates an independent
                conversation. A recovery backup is created before changes are applied.
              </p>
              <Button
                disabled={
                  pending || preview.projects.every((project) => project.projectId === null)
                }
                onClick={() =>
                  void submit({
                    operation: "import",
                    sourceHome: preview.sourceHome,
                    contentHash: preview.contentHash,
                    mappings: preview.projects.map(({ sourceProjectId, projectId }) => ({
                      sourceProjectId,
                      projectId,
                    })),
                    nightly,
                  })
                }
              >
                {nightly ? "Import and enable nightly sync" : "Import now"}
              </Button>
            </div>
          )}
          {data?.configuration.sourceHome && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {data.configuration.enabled
                  ? `Nightly at ${data.configuration.hour}:00 (${data.configuration.timezone}). Missed runs catch up when this environment next runs.`
                  : "Nightly sync is paused."}
                {data.configuration.lastSuccessAt &&
                  ` Last successful sync: ${new Date(data.configuration.lastSuccessAt).toLocaleString()}.`}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void submit({ operation: "syncNow" })}
                >
                  Sync now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void submit({
                      operation: "configure",
                      enabled: !data.configuration.enabled,
                      hour: data.configuration.hour,
                    })
                  }
                >
                  {data.configuration.enabled ? "Pause sync" : "Resume nightly sync"}
                </Button>
                <label className="flex items-center gap-2 text-xs">
                  Hour
                  <input
                    aria-label="Nightly sync hour"
                    type="number"
                    min={0}
                    max={23}
                    className="w-14 rounded border border-input bg-background p-1"
                    value={data.configuration.hour}
                    disabled={pending}
                    onChange={(event) => {
                      const hour = Number(event.target.value);
                      if (Number.isInteger(hour) && hour >= 0 && hour <= 23)
                        void submit({
                          operation: "configure",
                          enabled: data.configuration.enabled,
                          hour,
                        });
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          {data && data.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">Sync history</summary>
              <div className="mt-2 space-y-2">
                {data.history.map((record) => (
                  <div key={record.id} className="rounded-md border border-border/50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {new Date(record.createdAt).toLocaleString()} ·{" "}
                        {record.undoBatchId
                          ? "Sync undone"
                          : `${record.visibleThreadIds.length} conversation versions imported`}
                      </span>
                      {record.id === data.activeBatchId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setConfirm({ operation: "undo", batchId: record.id })}
                        >
                          Undo this sync
                        </Button>
                      )}
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground">
                        Review changes
                      </summary>
                      <p className="mt-1">
                        {record.hiddenThreadIds.length} previous conversation versions replaced.
                      </p>
                      {record.projectChanges.map((change) => (
                        <p key={change.after.id}>
                          {change.before ? "Updated" : "Added"} project: {change.after.title}
                        </p>
                      ))}
                    </details>
                  </div>
                ))}
              </div>
            </details>
          )}
          {data && data.backups.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">Recovery backups</summary>
              <p className="my-2 text-xs text-muted-foreground">
                Restore rewinds this environment’s database, attachments, and settings. For routine
                changes, use Undo this sync instead.
              </p>
              {data.backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between gap-2 py-1 text-xs"
                >
                  <span>{new Date(backup.createdAt).toLocaleString()}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setConfirm({ operation: "prepareRestore", backupId: backup.id })}
                  >
                    Restore backup
                  </Button>
                </div>
              ))}
            </details>
          )}
          {confirm && (
            <div
              role="alertdialog"
              aria-label={confirm.operation === "undo" ? "Undo sync" : "Restore backup"}
              className="space-y-3 rounded-md border border-amber-500/40 p-3"
            >
              <p className="text-sm">
                {confirm.operation === "undo"
                  ? "Restore imported content to its previous version? Your fork conversations and local changes will remain. Nightly sync will be paused."
                  : "Restore this environment on its next launch? Work since this backup will be rewound. The current state will be retained as a recovery copy."}
              </p>
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => void submit(confirm)}>
                  {confirm.operation === "undo" ? "Undo sync and pause" : "Prepare restore"}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
