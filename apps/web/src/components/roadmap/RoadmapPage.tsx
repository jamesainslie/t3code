import { useAtomValue } from "@effect/atom-react";
import type { RoadmapItemId, RoadmapWorkItem } from "@lathe/contracts";
import { roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MapIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { isElectron } from "~/env";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import {
  roadmapEnvironment,
  useRoadmapHome,
  useRoadmapLive,
  useRoadmapSupported,
} from "~/state/roadmap";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { RoadmapItemEditor, type RoadmapItemEditorMode } from "./RoadmapItemEditor";
import { RoadmapOutline } from "./RoadmapOutline";
import {
  ROADMAP_AREA_LABELS,
  ROADMAP_AREAS,
  ROADMAP_STATE_LABELS,
  ROADMAP_STATES,
  ROADMAP_TYPE_LABELS,
  ROADMAP_TYPES,
  localIsoDate,
  roadmapEditorRequest,
  withoutEditorRequest,
  type RoadmapSearch,
} from "./roadmapPage.logic";

const ALL = "all";
const IGNORE_ESCAPE = () => {};
const SKELETON_ROWS = ["a", "b", "c", "d", "e"] as const;

export function RoadmapPage() {
  const search = useSearch({ from: "/roadmap" });
  const navigate = useNavigate({ from: "/roadmap" });
  const home = useRoadmapHome();
  const supported = useRoadmapSupported(home);
  const live = useRoadmapLive(supported ? home : null);
  const canEdit = useAtomValue(roadmapEnvironment.dispatchRoadmap.permissionAtom(home));
  const items = useMemo(() => live.data?.items ?? [], [live.data]);
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const today = localIsoDate(new Date());
  // A stable object keeps the Outline's filtered tree memoized across unrelated renders.
  const outlineFilter = useMemo(
    () => ({ area: search.area, type: search.type, state: search.itemState }),
    [search.area, search.itemState, search.type],
  );

  const [localEditor, setLocalEditor] = useState<{
    readonly key: number;
    readonly mode: RoadmapItemEditorMode;
  } | null>(null);
  // The URL can ask for the editor ("Create work item" in the command palette).
  // It waits for the snapshot so a parent in the URL can be checked first. Closing
  // it remembers the search it came from, so it stays shut until the URL catches up.
  const [dismissedSearch, setDismissedSearch] = useState<RoadmapSearch | null>(null);
  const urlRequest =
    live.data === null || search === dismissedSearch ? null : roadmapEditorRequest(search, byId);
  const editor =
    localEditor ??
    (urlRequest === null
      ? null
      : { key: -1, mode: { kind: "create", parentId: urlRequest.parentId } as const });
  useEscapeToGoBack(editor === null ? undefined : IGNORE_ESCAPE);

  const setSearch = useCallback(
    (next: (current: RoadmapSearch) => RoadmapSearch) =>
      void navigate({ search: next, replace: true }),
    [navigate],
  );

  const openEditor = useCallback(
    (mode: RoadmapItemEditorMode) =>
      setLocalEditor((current) => ({ key: (current?.key ?? 0) + 1, mode })),
    [],
  );
  const onAddChild = useCallback(
    (parent: RoadmapWorkItem) => openEditor({ kind: "create", parentId: parent.id }),
    [openEditor],
  );
  const onEdit = useCallback(
    (item: RoadmapWorkItem) => openEditor({ kind: "edit", item }),
    [openEditor],
  );
  const closeEditor = (createdId?: RoadmapItemId) => {
    setLocalEditor(null);
    if (search.new === undefined && createdId === undefined) return;
    setDismissedSearch(search);
    setSearch((current) => ({
      ...withoutEditorRequest(current),
      ...(createdId === undefined ? {} : { item: createdId }),
    }));
  };

  const header = (
    <div className="flex w-full min-w-0 items-center gap-2 py-2">
      <WorkspaceBreadcrumb ariaLabel="Roadmap breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem current>
          <h1>Roadmap</h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div className="ms-auto flex min-w-0 items-center gap-1">
        <FilterSelect
          label="Area"
          value={search.area ?? ALL}
          options={{ [ALL]: "All", ...ROADMAP_AREA_LABELS }}
          order={[ALL, ...ROADMAP_AREAS]}
          onChange={(value) =>
            setSearch(({ area: _area, ...rest }) => ({
              ...rest,
              ...(value === ALL ? {} : { area: value as NonNullable<RoadmapSearch["area"]> }),
            }))
          }
        />
        <FilterSelect
          label="Type"
          value={search.type ?? ALL}
          options={{ [ALL]: "All", ...ROADMAP_TYPE_LABELS }}
          order={[ALL, ...ROADMAP_TYPES]}
          onChange={(value) =>
            setSearch(({ type: _type, ...rest }) => ({
              ...rest,
              ...(value === ALL ? {} : { type: value as NonNullable<RoadmapSearch["type"]> }),
            }))
          }
        />
        <FilterSelect
          label="State"
          value={search.itemState ?? ALL}
          options={{ [ALL]: "All", open: "Open", ...ROADMAP_STATE_LABELS }}
          order={[ALL, "open", ...ROADMAP_STATES]}
          onChange={(value) =>
            setSearch(({ itemState: _itemState, ...rest }) => ({
              ...rest,
              ...(value === ALL
                ? {}
                : { itemState: value as NonNullable<RoadmapSearch["itemState"]> }),
            }))
          }
        />
        <Button
          size="xs"
          variant="outline"
          disabled={!canEdit || live.data === null}
          onClick={() => openEditor({ kind: "create", parentId: null })}
        >
          <PlusIcon />
          New
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{header}</WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded">
            {home === null || !supported ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                The roadmap home is not connected, or its server does not have the roadmap yet.
              </p>
            ) : live.error !== null && live.data === null ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Could not load the roadmap. It retries when the home reconnects.
              </p>
            ) : live.data === null ? (
              <div className="flex flex-col gap-2" aria-busy>
                {SKELETON_ROWS.map((row) => (
                  <Skeleton key={row} className="h-7 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MapIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nothing on the roadmap yet</EmptyTitle>
                  <EmptyDescription>
                    Build a tree of work, from objectives down to stories and bugs. Threads attach
                    to the items they work on, so you can see what each one is for.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={!canEdit}
                    onClick={() => openEditor({ kind: "create", parentId: null })}
                  >
                    <PlusIcon />
                    New objective
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <RoadmapOutline
                home={home}
                items={items}
                filter={outlineFilter}
                selectedId={search.item ?? null}
                canEdit={canEdit}
                today={today}
                onAddChild={onAddChild}
                onEdit={onEdit}
              />
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      {editor !== null && home !== null ? (
        <RoadmapItemEditor
          key={editor.key}
          home={home}
          items={items}
          mode={editor.mode}
          onClose={closeEditor}
        />
      ) : null}
    </SidebarInset>
  );
}

function FilterSelect({
  label,
  value,
  options,
  order,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: Readonly<Record<string, string>>;
  readonly order: ReadonlyArray<string>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="compact" variant="ghost" className="w-auto min-w-0">
        <SelectValue>{(current: string) => `${label}: ${options[current] ?? current}`}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {order.map((option) => (
          <SelectItem key={option} value={option}>
            {options[option]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
