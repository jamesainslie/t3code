import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import type { GitHubAccountRules, SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act, StrictMode, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ScopedSettingsPatch } from "./scopedSettings";

const state = vi.hoisted(() => ({
  rules: [] as GitHubAccountRules,
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
  writeTargets: [] as ReadonlyArray<string>,
  environments: [] as ReadonlyArray<{
    readonly environmentId: string;
    readonly label: string;
    readonly connection: { readonly phase: "connected" };
    readonly serverConfig: {
      readonly settings: { readonly gitHubAccountRules: GitHubAccountRules };
      readonly environment: { readonly capabilities: { readonly gitHubAccountRouting?: boolean } };
    };
  }>,
}));

const machine = (
  label: string,
  rules: GitHubAccountRules,
  supported = true,
): (typeof state.environments)[number] => ({
  environmentId: label,
  label,
  connection: { phase: "connected" },
  serverConfig: {
    settings: { gitHubAccountRules: rules },
    environment: { capabilities: supported ? { gitHubAccountRouting: true } : {} },
  },
});

vi.mock("./useScopedSettings", () => ({
  useUpdateScopedSettingsOn: (environments: ReadonlyArray<{ readonly label: string }>) => {
    state.writeTargets = environments.map((environment) => environment.label);
    return state.updateSettings;
  },
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "all", environmentIds: [] },
    environment: state.environments[0] ?? null,
    connectedEnvironments: state.environments,
    targets: [],
  }),
}));
vi.mock("./settingsSearch", () => ({ searchableSetting: (id: string) => ({ id, title: id }) }));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({
    children,
    headerAction,
  }: {
    children: ReactNode;
    headerAction?: ReactNode;
  }) => (
    <div>
      {headerAction}
      {children}
    </div>
  ),
  SettingsRow: ({
    title,
    description,
    control,
  }: {
    title: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
  }) => (
    <div>
      {title}
      {description}
      {control}
    </div>
  ),
}));
vi.mock("../ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => children,
  SelectItem: "span",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "span",
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../ui/input", () => ({ Input: "input" }));
vi.mock("../ui/button", () => ({ Button: "button" }));

import { GitHubAccountRulesSettings } from "./GitHubAccountRulesSettings";

let renderer: ReactTestRenderer | null;

function discovery(logins: ReadonlyArray<string>): SourceControlDiscoveryResult {
  return {
    versionControlSystems: [],
    sourceControlProviders: [
      {
        kind: "github",
        label: "GitHub",
        status: "available",
        version: Option.none(),
        installHint: "",
        detail: Option.none(),
        auth: {
          status: "authenticated",
          account: Option.some(logins[0] ?? "nobody"),
          host: Option.some("github.com"),
          detail: Option.none(),
          accounts: logins.map((login, index) => ({
            host: "github.com",
            login,
            active: index === 0,
            authenticated: true,
          })),
        },
      },
    ],
  };
}

function render(logins: ReadonlyArray<string>) {
  act(() => {
    renderer = create(
      <StrictMode>
        <GitHubAccountRulesSettings discovery={discovery(logins)} />
      </StrictMode>,
    );
  });
}

function buttonByLabel(label: string) {
  return renderer!.root
    .findAllByType("button")
    .find((item) => item.props["aria-label"] === label || item.children.includes(label))!;
}

describe("GitHubAccountRulesSettings", () => {
  beforeEach(() => {
    state.rules = [{ host: "github.com", owner: "acme", login: "personal" }];
    state.environments = [machine("Mac", state.rules)];
    state.writeTargets = [];
    state.updateSettings.mockReset();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it("adds a rule and writes the whole list", () => {
    render(["personal", "work"]);
    act(() => buttonByLabel("Add rule").props.onClick());
    const inputs = renderer!.root.findAllByType("input");
    expect(inputs).toHaveLength(2);
    act(() => inputs[1]!.props.onBlur({ target: { value: "bad owner" } }));
    expect(state.updateSettings).not.toHaveBeenCalled();
    act(() => inputs[1]!.props.onBlur({ target: { value: " geico-* " } }));
    expect(state.updateSettings).toHaveBeenCalledWith({
      gitHubAccountRules: [
        { host: "github.com", owner: "acme", login: "personal" },
        { host: "github.com", owner: "geico-*", login: "personal" },
      ],
    });
  });

  it("moves a rule down", () => {
    state.rules = [
      { host: "github.com", owner: "acme", login: "personal" },
      { host: "github.com", owner: "geico-*", login: "work" },
    ];
    state.environments = [machine("Mac", state.rules)];
    render(["personal", "work"]);
    expect(buttonByLabel("Move rule 2 down").props.disabled).toBe(true);
    act(() => buttonByLabel("Move rule 1 down").props.onClick());
    expect(state.updateSettings).toHaveBeenCalledWith({
      gitHubAccountRules: [
        { host: "github.com", owner: "geico-*", login: "work" },
        { host: "github.com", owner: "acme", login: "personal" },
      ],
    });
  });

  it("hides the editor with one account", () => {
    render(["personal"]);
    expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("second GitHub account");
  });

  it("edits every machine that supports rules at All environments and names the rest", () => {
    state.environments = [
      machine("Mac", state.rules),
      machine("hephaestus", state.rules),
      machine("incus", [], false),
    ];
    render(["personal", "work"]);
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Rules apply to every connected machine");
    expect(text).toContain("incus run a server without account rules");
    act(() => buttonByLabel("Remove rule 1").props.onClick());
    expect(state.writeTargets).toEqual(["Mac", "hephaestus"]);
    expect(state.updateSettings).toHaveBeenCalledWith({ gitHubAccountRules: [] });
  });

  it("offers to apply one machine's rules everywhere when they differ", () => {
    state.environments = [
      machine("Mac", state.rules),
      machine("hephaestus", [{ host: "github.com", owner: "geico-*", login: "work" }]),
    ];
    render(["personal", "work"]);
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    act(() => buttonByLabel("Use Mac's rules everywhere").props.onClick());
    expect(state.updateSettings).toHaveBeenCalledWith({ gitHubAccountRules: state.rules });
  });

  it("asks for a server update when no selected machine supports rules", () => {
    state.environments = [machine("incus", [], false)];
    render(["personal", "work"]);
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("newer server on incus");
  });
});
