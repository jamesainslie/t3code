import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useProjectSync } from "../../hooks/useProjectSync";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";

export function SyncedConversation({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const { data, error, pending, run } = useProjectSync(environmentId);
  const navigate = useNavigate();
  const imported = data?.history.find((record) => record.visibleThreadIds.includes(threadId));
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      <p className="text-sm font-medium">
        From T3 Code{imported ? ` · Imported ${new Date(imported.createdAt).toLocaleString()}` : ""}
      </p>
      <p className="text-sm text-muted-foreground">
        This conversation is synced from your main install. Continue in fork to work independently
        with its history.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          void run({ operation: "continue", threadId })
            .then((response) => {
              if (response.threadId)
                return navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams({ environmentId, threadId: response.threadId }),
                });
            })
            .catch(() => undefined)
        }
      >
        {pending ? "Working…" : "Continue in fork"}
      </Button>
    </div>
  );
}
