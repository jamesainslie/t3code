import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { useEnvironments } from "../../state/environments";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "../ui/combobox";
import { selectTriggerVariants } from "../ui/select";
import { cn } from "../../lib/utils";
import { ProjectSettingsPanel, useSettingsProjectGroups } from "./ProjectSettingsPanel";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ProjectSyncSettings } from "./ProjectSyncSettings";

function ScopePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: "project" | "machine";
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string; icon?: ReactNode }>;
  onChange: (value: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const allIcon =
    label === "project" ? <FolderIcon aria-hidden className="size-3.5 shrink-0" /> : null;
  const items = [{ value: "all", label: `All ${label}s`, icon: allIcon }, ...options];
  return (
    <Combobox
      items={items}
      value={items.find((item) => item.value === (value ?? "all")) ?? null}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={() => setQuery("")}
      onValueChange={(next) => {
        if (next) onChange(next.value === "all" ? null : next.value);
      }}
    >
      <ComboboxTrigger
        aria-label={`${label === "project" ? "Project" : "Machine"} scope`}
        className={cn(selectTriggerVariants({ size: "compact" }), "w-auto min-w-0 max-w-52")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {value === null ? allIcon : selected?.icon}
          <span className="truncate">
            {value === null ? `All ${label}s` : (selected?.label ?? `Unavailable ${label}`)}
          </span>
        </span>
        <ChevronDownIcon aria-hidden className="-me-1 size-3 opacity-50" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-64">
        <ComboboxSearchInput aria-label={`Search ${label}s`} placeholder={`Search ${label}s...`} />
        <ComboboxEmpty>No matching {label}s.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof items)[number]) => (
            <ComboboxItem
              key={item.value}
              value={item}
              contentClassName="flex min-w-0 items-center gap-2"
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export function ProjectsSettings({
  projectKey,
  machineId,
  onScopeChange,
}: {
  projectKey: string | null;
  machineId: string | null;
  onScopeChange: (project: string | null, machine: string | null) => void;
}) {
  const groups = useSettingsProjectGroups();
  const { environments } = useEnvironments();
  const machine = environments.find((environment) => environment.environmentId === machineId);
  const syncEnvironmentId =
    machine?.environmentId ??
    (machineId === null && environments.length === 1 ? environments[0]?.environmentId : null);
  const machineOptions = environments.map((environment) => ({
    value: environment.environmentId,
    label: environment.label,
    icon: (
      <EnvironmentMachineIcon
        aria-hidden
        kind={resolveEnvironmentMachineKind(environment.serverConfig)}
        className="size-3.5 shrink-0"
      />
    ),
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-gutter-both shrink-0 overflow-y-auto">
        <WorkspacePageContainer className="pb-0">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Settings scope"
          >
            {environments.length > 3 ? (
              <ScopePicker
                label="machine"
                value={machineId}
                options={machineOptions}
                onChange={(value) => onScopeChange(projectKey, value)}
              />
            ) : (
              <ToggleGroup
                aria-label="Machine scope"
                variant="segmented"
                className="max-w-full flex-wrap"
                value={[machineId ?? "all"]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value) onScopeChange(projectKey, value === "all" ? null : value);
                }}
              >
                <Toggle value="all">All machines</Toggle>
                {machineOptions.map((option) => (
                  <Toggle key={option.value} value={option.value} title={option.label}>
                    {option.icon}
                    <span className="max-w-36 truncate">{option.label}</span>
                  </Toggle>
                ))}
              </ToggleGroup>
            )}
            <div className="ms-auto">
              <ScopePicker
                label="project"
                value={projectKey}
                options={groups.map((group) => ({
                  value: group.projectKey,
                  label: group.displayName,
                  icon: <ProjectFavicon project={group} className="size-3.5" />,
                }))}
                onChange={(value) => onScopeChange(value, machineId)}
              />
            </div>
          </div>
          {projectKey === null && (
            <div className="mt-4 pb-4">
              {syncEnvironmentId ? (
                <ProjectSyncSettings key={syncEnvironmentId} environmentId={syncEnvironmentId} />
              ) : (
                <section
                  aria-label="Sync from another T3 install"
                  className="space-y-3 rounded-lg border border-border/60 p-4"
                >
                  <div>
                    <h3 className="text-sm font-medium">Sync from another T3 install</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose the machine running your fork. Projects and conversation history are
                      imported from another T3 install on that machine.
                    </p>
                  </div>
                  <label className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
                    Destination machine
                    <select
                      value=""
                      disabled={environments.length === 0}
                      className="max-w-full rounded-md border border-input bg-background p-2 text-sm text-foreground"
                      onChange={(event) => {
                        if (event.target.value) onScopeChange(null, event.target.value);
                      }}
                    >
                      <option value="" disabled>
                        {environments.length === 0
                          ? "Connect a machine to set up sync"
                          : "Choose a machine"}
                      </option>
                      {machineOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              )}
            </div>
          )}
        </WorkspacePageContainer>
      </div>
      {machineId !== null && !machine ? (
        <p className="p-8 text-sm text-muted-foreground">This machine is no longer available.</p>
      ) : projectKey === null ? (
        <ProjectDefaultsSettings environmentId={machine?.environmentId ?? null} />
      ) : (
        <ProjectSettingsPanel
          projectKey={projectKey}
          environmentId={machine?.environmentId ?? null}
        />
      )}
    </div>
  );
}
