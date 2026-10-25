import { useAtomValue } from "@effect/atom-react";
import type { RoadmapItemId, RoadmapSprint, RoadmapWorkItem } from "@lathe/contracts";
import { roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlertIcon, CircleDotIcon, MapIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { useEnvironmentPresentation } from "~/state/presentation";
import {
  roadmapEnvironment,
  useRoadmapHome,
  useRoadmapLive,
  useRoadmapSupported,
} from "~/state/roadmap";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { RoadmapBoard } from "./RoadmapBoard";
import { RoadmapImportIssueDialog } from "./RoadmapImportIssueDialog";
import { RoadmapItemDrawer } from "./RoadmapItemDrawer";
import { RoadmapItemEditor, type RoadmapItemEditorMode } from "./RoadmapItemEditor";
import { RoadmapOutline } from "./RoadmapOutline";
import { RoadmapSprintsButton } from "./RoadmapSprints";
import { RoadmapTimeline } from "./RoadmapTimeline";
import { RoadmapToday } from "./RoadmapToday";
import {
  ROADMAP_AREA_LABELS,
  ROADMAP_AREAS,
  ROADMAP_STATE_LABELS,
  ROADMAP_STATES,
  ROADMAP_TYPE_LABELS,
  ROADMAP_TYPES,
  localIsoDate,
} from "./roadmap.logic";
import {
  boardUnderOptions,
  DEFAULT_ROADMAP_VIEW,
  knownSprintFilter,
  ROADMAP_VIEWS,
  roadmapEditorRequest,
  roadmapLiveNotice,
  roadmapViewOf,
  withoutEditorRequest,
  type RoadmapOutlineLayout,
  type RoadmapLiveNotice,
  type RoadmapSearch,
  type RoadmapSprintFilter,
  type RoadmapView,
} from "./roadmapPage.logic";

const ALL = "all";
const VIEW_LABELS: Readonly<Record<RoadmapView, string>> = {
  today: "Today",
  outline: "Outline",
  timeline: "Timeline",
  board: "Board",
};
const IGNORE_ESCAPE = () => {};
const SKELETON_ROWS = ["a", "b", "c", "d", "e"] as const;

export function RoadmapPage() {
  const search = useSearch({ from: "/roadmap" });
  const navigate = useNavigate({ from: "/roadmap" });
  const home = useRoadmapHome();
  const supported = useRoadmapSupported(home);
  const live = useRoadmapLive(supported ? home : null);
  const { presentation: homePresentation } = useEnvironmentPresentation(home);
  const notice = roadmapLiveNotice({
    connection: homePresentation?.connection ?? null,
    homeLabel: homePresentation?.entry.target.label ?? "the roadmap home",
    source: live.data?.source ?? null,
    loadError: live.error,
  });
  // A cached or disconnected roadmap is read only: a write could not reach the home.
  const isLive = notice.kind === "live";
  const canEdit = useAtomValue(roadmapEnvironment.dispatchRoadmap.permissionAtom(home)) && isLive;
  const items = live.data?.items ?? [];
  const sprints = live.data?.sprints ?? [];
  const byId = roadmapItemsById(items);
  const today = localIsoDate(new Date());
  const view = roadmapViewOf(search);
  const underOptions = boardUnderOptions(items);
  // An item that was deleted or never existed falls back to the whole board.
  const underId =
    search.under !== undefined && underOptions.some((option) => option.id === search.under)
      ? search.under
      : null;
  const underLabels = Object.fromEntries([
    [ALL, "Everything"],
    ...underOptions.map((option) => [option.id, option.title]),
  ]);
  const sprintFilter = knownSprintFilter(search, sprints);
  // A stable object keeps the Outline's filtered tree memoized across unrelated renders.
  const outlineFilter = {
    area: search.area,
    type: search.type,
    state: search.itemState,
    sprint: sprintFilter,
  };

  const [localEditor, setLocalEditor] = useState<{
    readonly key: number;
    readonly mode: RoadmapItemEditorMode;
  } | null>(null);
  // The URL can ask for the editor ("Create work item" in the command palette).
  // It waits for the live roadmap so a parent in the URL can be checked first. Closing
  // it remembers the search it came from, so it stays shut until the URL catches up.
  const [dismissedSearch, setDismissedSearch] = useState<RoadmapSearch | null>(null);
  const urlRequest =
    !isLive || search === dismissedSearch ? null : roadmapEditorRequest(search, byId);
  const editor =
    localEditor ??
    (urlRequest === null
      ? null
      : { key: -1, mode: { kind: "create", parentId: urlRequest.parentId } as const });
  // Fork: roadmap. The import dialog opens from the header or, like the editor,
  // from the URL ("Import GitHub issue" in the command palette).
  const canImport =
    useAtomValue(roadmapEnvironment.importRoadmapIssue.permissionAtom(home)) && isLive;
  const [importRequested, setImportRequested] = useState(false);
  const importOpen =
    isLive && (importRequested || (search.import === 1 && search !== dismissedSearch));
  const closeImport = (itemId?: RoadmapItemId) => {
    setImportRequested(false);
    if (search.import === undefined && itemId === undefined) return;
    setDismissedSearch(search);
    setSearch((current) => ({
      ...withoutEditorRequest(current),
      ...(itemId === undefined ? {} : { item: itemId }),
    }));
  };

  const setSearch = (next: (current: RoadmapSearch) => RoadmapSearch) =>
    void navigate({ search: next, replace: true });

  // The selected item, which the drawer shows; one deleted or never there shows nothing.
  const selectedItem = search.item === undefined ? undefined : byId.get(search.item);
  const closeDrawer = () => setSearch(({ item: _item, ...rest }) => rest);
  // Escape closes the innermost thing first: a dialog, then the drawer, then the page.
  useEscapeToGoBack(
    editor !== null || importOpen
      ? IGNORE_ESCAPE
      : selectedItem !== undefined
        ? closeDrawer
        : undefined,
  );

  const outlineLayout = { level: search.level, focus: search.focus === 1 };
  const onOutlineLayoutChange = ({ level, focus }: RoadmapOutlineLayout) =>
    setSearch(({ level: _level, focus: _focus, ...rest }) => ({
      ...rest,
      ...(level === undefined ? {} : { level }),
      ...(focus ? { focus: 1 as const } : {}),
    }));

  const openEditor = (mode: RoadmapItemEditorMode) =>
    setLocalEditor((current) => ({ key: (current?.key ?? 0) + 1, mode }));
  const onAddChild = (parent: RoadmapWorkItem) =>
    openEditor({ kind: "create", parentId: parent.id });
  const onEdit = (item: RoadmapWorkItem) => openEditor({ kind: "edit", item });
  const onSelect = (itemId: RoadmapItemId) =>
    setSearch((current) => ({ ...current, item: itemId }));
  const onOpen = (item: RoadmapWorkItem) => onSelect(item.id);
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
        {view === "board" ? (
          <FilterSelect
            label="Under"
            value={underId ?? ALL}
            options={underLabels}
            order={[ALL, ...underOptions.map((option) => option.id)]}
            onChange={(value) =>
              setSearch(({ under: _under, ...rest }) => ({
                ...rest,
                ...(value === ALL ? {} : { under: value as RoadmapItemId }),
              }))
            }
          />
        ) : view === "outline" ? (
          <OutlineFilters
            search={search}
            sprints={sprints}
            sprintFilter={sprintFilter}
            setSearch={setSearch}
          />
        ) : view === "timeline" ? (
          <AreaFilter search={search} setSearch={setSearch} />
        ) : null}
        <ToggleGroup
          aria-label="Roadmap view"
          variant="segmented"
          value={[view]}
          onValueChange={(next) => {
            const value = ROADMAP_VIEWS.find((candidate) => candidate === next[0]);
            if (value === undefined) return;
            setSearch(({ view: _view, ...rest }) => ({
              ...rest,
              ...(value === DEFAULT_ROADMAP_VIEW ? {} : { view: value }),
            }));
          }}
        >
          {ROADMAP_VIEWS.map((value) => (
            <Toggle key={value} value={value}>
              {VIEW_LABELS[value]}
            </Toggle>
          ))}
        </ToggleGroup>
        {home !== null && live.data !== null ? (
          <RoadmapSprintsButton
            home={home}
            items={items}
            sprints={sprints}
            canEdit={canEdit}
            today={today}
          />
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={!canImport}
          onClick={() => setImportRequested(true)}
        >
          <CircleDotIcon />
          Import issue
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!canEdit}
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
        <div className="relative flex min-h-0 flex-1">
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <WorkspacePageContainer width="full">
              {home !== null && supported ? (
                <RoadmapNoticeBar notice={notice} showingSaved={live.data !== null} />
              ) : null}
              {home === null || !supported ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  The roadmap home is not connected, or its server does not have the roadmap yet.{" "}
                  <Link to="/settings/roadmap" className="underline underline-offset-4">
                    Choose a roadmap home
                  </Link>
                </p>
              ) : live.data === null ? (
                // A failed load has only its error to show; a skeleton would claim progress.
                notice.kind === "failed" ? null : (
                  <div className="flex flex-col gap-2" aria-busy>
                    {SKELETON_ROWS.map((row) => (
                      <Skeleton key={row} className="h-7 w-full" />
                    ))}
                  </div>
                )
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
              ) : view === "today" ? (
                <RoadmapToday
                  home={home}
                  items={items}
                  sprints={sprints}
                  canEdit={canEdit}
                  today={today}
                  selectedId={search.item ?? null}
                  onOpen={onOpen}
                />
              ) : view === "timeline" ? (
                <RoadmapTimeline
                  home={home}
                  items={items}
                  sprints={sprints}
                  area={search.area ?? null}
                  today={today}
                  selectedId={search.item ?? null}
                  onSelect={onSelect}
                />
              ) : view === "board" ? (
                <RoadmapBoard
                  home={home}
                  items={items}
                  sprints={sprints}
                  underId={underId}
                  canEdit={canEdit}
                  today={today}
                  selectedId={search.item ?? null}
                  onOpen={onOpen}
                />
              ) : (
                <RoadmapOutline
                  home={home}
                  items={items}
                  sprints={sprints}
                  filter={outlineFilter}
                  layout={outlineLayout}
                  onLayoutChange={onOutlineLayoutChange}
                  selectedId={search.item ?? null}
                  canEdit={canEdit}
                  today={today}
                  onAddChild={onAddChild}
                  onEdit={onEdit}
                  onSelect={onSelect}
                />
              )}
            </WorkspacePageContainer>
          </ScrollArea>
          {selectedItem !== undefined && home !== null ? (
            <RoadmapItemDrawer
              home={home}
              item={selectedItem}
              items={items}
              sprints={sprints}
              canEdit={canEdit}
              onSelect={onSelect}
              onEdit={onEdit}
              onClose={closeDrawer}
            />
          ) : null}
        </div>
      </div>
      {editor !== null && home !== null ? (
        <RoadmapItemEditor
          key={editor.key}
          home={home}
          items={items}
          sprints={sprints}
          mode={editor.mode}
          onClose={closeEditor}
        />
      ) : null}
      {importOpen && home !== null ? (
        <RoadmapImportIssueDialog home={home} items={items} onClose={closeImport} />
      ) : null}
    </SidebarInset>
  );
}

function RoadmapNoticeBar({
  notice,
  showingSaved,
}: {
  readonly notice: RoadmapLiveNotice;
  readonly showingSaved: boolean;
}) {
  if (notice.kind === "live") return null;
  const saved = showingSaved ? "Showing the roadmap as it last loaded, read only." : null;
  if (notice.kind === "syncing") {
    return (
      <p role="status" className="flex items-center gap-1.5 pb-3 text-xs text-muted-foreground">
        <RefreshCwIcon className="size-3.5 shrink-0" />
        {saved === null ? notice.message : `${notice.message} ${saved}`}
      </p>
    );
  }
  return (
    <div className="pb-4">
      <Alert variant="error" role="alert">
        <CircleAlertIcon />
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>
          {notice.reason === null ? null : <p>{notice.reason}</p>}
          <p>
            {saved === null ? null : `${saved} `}
            {notice.retrying ? (
              "Retrying automatically."
            ) : (
              <Link to="/settings/connections" className="underline underline-offset-4">
                Check the connection in Settings
              </Link>
            )}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function OutlineFilters({
  search,
  sprints,
  sprintFilter,
  setSearch,
}: {
  readonly search: RoadmapSearch;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly sprintFilter: RoadmapSprintFilter | undefined;
  readonly setSearch: (next: (current: RoadmapSearch) => RoadmapSearch) => void;
}) {
  const sprintLabels = Object.fromEntries([
    [ALL, "Any"],
    ["none", "None"],
    ...sprints.map((sprint) => [sprint.id, sprint.name]),
  ]);
  return (
    <>
      <AreaFilter search={search} setSearch={setSearch} />
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
              : {
                  itemState: value as NonNullable<RoadmapSearch["itemState"]>,
                }),
          }))
        }
      />
      {sprints.length > 0 ? (
        <FilterSelect
          label="Sprint"
          value={sprintFilter ?? ALL}
          options={sprintLabels}
          order={[ALL, "none", ...sprints.map((sprint) => sprint.id)]}
          onChange={(value) =>
            setSearch(({ sprint: _sprint, ...rest }) => ({
              ...rest,
              ...(value === ALL ? {} : { sprint: value as RoadmapSprintFilter }),
            }))
          }
        />
      ) : null}
    </>
  );
}

function AreaFilter({
  search,
  setSearch,
}: {
  readonly search: RoadmapSearch;
  readonly setSearch: (next: (current: RoadmapSearch) => RoadmapSearch) => void;
}) {
  return (
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
