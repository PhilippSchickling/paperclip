import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-level authorization tests for the entity label endpoints. The policy
// engine itself is exercised in authorization tests; these tests pin the route
// wiring: restricted keys must hit the guard (and be rejected), and the agent
// label response must use the restricted view for callers who cannot read
// peer configuration.

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  setAgentLabels: vi.fn(async () => undefined),
  getChainOfCommand: vi.fn(async () => [] as unknown[]),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  setProjectLabels: vi.fn(async () => undefined),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(async () => null),
  listPrincipalGrants: vi.fn(async () => [] as unknown[]),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(
    async (_companyId: string, config: Record<string, unknown>) => config,
  ),
  resolveAdapterConfigForRuntime: vi.fn(
    async (_companyId: string, config: Record<string, unknown>) => ({ config }),
  ),
  collectMissingRuntimeBindings: vi.fn(async () => [] as Array<Record<string, unknown>>),
  resolveEnvBindings: vi.fn(async () => ({
    env: {} as Record<string, string>,
    secretKeys: new Set<string>(),
    manifest: [],
  })),
}));

const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
  releaseLease: vi.fn(),
  listBoundCompanyIds: vi.fn(async () => [] as string[]),
  findManagedSandboxEnvironment: vi.fn(async () => null as Record<string, unknown> | null),
}));

const mockEnvironmentRuntime = vi.hoisted(() => ({
  acquireRunLease: vi.fn(),
  realizeWorkspace: vi.fn(),
  getDriver: vi.fn(() => ({
    releaseRunLease: vi.fn(async () => undefined),
  })),
}));

const mockResolveEnvironmentExecutionTarget = vi.hoisted(() => vi.fn());

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null as string | null })),
  getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  getExperimental: vi.fn(async () => ({ enableManagedSandboxOnly: false })),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => ({}),
  accessService: () => mockAccessService,
  approvalService: () => ({}),
  builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
  companySkillService: () => ({
    listRuntimeSkillEntries: vi.fn(async () => []),
    resolveRequestedSkillKeys: vi.fn(async () => []),
  }),
  budgetService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(),
    cancelActiveForAgent: vi.fn(),
  }),
  ISSUE_LIST_DEFAULT_LIMIT: 50,
  issueApprovalService: () => ({}),
  issueRecoveryActionService: () => ({}),
  issueService: () => ({}),
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent: unknown, config: unknown) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../services/environments.js", () => ({
  environmentService: () => mockEnvironmentService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/environment-runtime.js", () => ({
  environmentRuntimeService: () => mockEnvironmentRuntime,
}));

vi.mock("../services/environment-execution-target.js", () => ({
  resolveEnvironmentExecutionTarget: mockResolveEnvironmentExecutionTarget,
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
}));

// Only the credential-resolution edges are stubbed (they need a database and
// network access); everything else in these modules stays real.
vi.mock("../services/ai-connection-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ai-connection-runtime.js")>()),
  prepareManagedAiRuntime: vi.fn(),
}));

vi.mock("../routes/ai-connections.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routes/ai-connections.js")>()),
  validateAiApiKey: vi.fn(async () => undefined),
}));

vi.mock("../services/ai-connections.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ai-connections.js")>()),
  aiConnectionService: () => ({ markAuthenticationFailed: vi.fn(async () => undefined) }),
}));

// Project routes pull in the workspace runtime and telemetry edges; stub the
// pieces that reach for infrastructure the labels route never touches.
vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
}));

vi.mock("../services/activity-log.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/activity-log.js")>()),
  persistActivity: vi.fn(async () => ({ activity: { id: "activity" }, publication: null })),
  publishActivity: vi.fn(),
}));

const LABEL_ID = "22222222-2222-4222-8222-222222222222";

function restrictedAgentActor(agentId: string) {
  // Mirrors the actor the auth middleware builds for task-bridge / skill-test
  // API keys (server/src/middleware/auth.ts): an agent key with a restricted
  // scope acting on behalf of a responsible user.
  return {
    type: "agent",
    agentId,
    companyId: "company-1",
    keyScope: { kind: "skill_test" },
    onBehalfOfUserId: "user-1",
    onBehalfOfMemberships: [
      { companyId: "company-1", status: "active", membershipRole: "member" },
    ],
    runId: null,
    source: "agent_key",
  };
}

function peerAgentActor(agentId: string) {
  return {
    type: "agent",
    agentId,
    companyId: "company-1",
    keyScope: null,
    onBehalfOfUserId: "user-1",
    onBehalfOfMemberships: [
      { companyId: "company-1", status: "active", membershipRole: "member" },
    ],
    runId: null,
    source: "agent_key",
  };
}

function boardActor() {
  return {
    type: "board",
    userId: "local-board",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: false,
  };
}

async function createApp(actor: Record<string, unknown>) {
  const [{ agentRoutes }, { projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use("/api", projectRoutes({ transaction: async (effect: (tx: unknown) => unknown) => effect({}) } as any));
  app.use(errorHandler);
  return app;
}

function denyAll() {
  mockAccessService.decide.mockImplementation(async () => ({
    allowed: false,
    reason: "deny_restricted_key",
    explanation: "Skill-test run token cannot use this API action",
  }));
}

describe("entity label route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    mockAgentService.getById.mockResolvedValue(null);
    mockProjectService.getById.mockResolvedValue(null);
  });

  it("rejects a restricted key writing agent labels", async () => {
    denyAll();
    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      role: "member",
      permissions: {},
    });
    const app = await createApp(restrictedAgentActor("11111111-1111-4111-8111-111111111111"));

    const res = await request(app)
      .put("/api/agents/11111111-1111-4111-8111-111111111111/labels")
      .send({ labelIds: [LABEL_ID] });

    expect(res.status).toBe(403);
    expect(mockAgentService.setAgentLabels).not.toHaveBeenCalled();
    // The route must actually consult the policy for the update action rather
    // than skipping the guard for restricted keys.
    expect(mockAccessService.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_config:update",
        resource: expect.objectContaining({ type: "agent", agentId: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
  });

  it("rejects a restricted key writing project labels", async () => {
    denyAll();
    mockProjectService.getById.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
    });
    const app = await createApp(restrictedAgentActor("11111111-1111-4111-8111-111111111111"));

    const res = await request(app)
      .put("/api/projects/33333333-3333-4333-8333-333333333333/labels")
      .send({ labelIds: [LABEL_ID] });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "Project is outside this actor's authorization boundary",
    });
    expect(mockProjectService.setProjectLabels).not.toHaveBeenCalled();
    expect(mockAccessService.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project:read",
        resource: expect.objectContaining({ type: "project", projectId: "33333333-3333-4333-8333-333333333333" }),
      }),
    );
  });

  it("returns the restricted agent detail from the labels route when the caller cannot read configurations", async () => {
    mockAccessService.decide.mockImplementation(async (input: { action: string }) => {
      if (input.action === "agent_config:update") {
        return { allowed: true, reason: "allow_grant", explanation: "Allowed by test grant." };
      }
      return {
        allowed: false,
        reason: "deny_config_read",
        explanation: "Agent cannot read peer configurations",
      };
    });
    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      role: "member",
      permissions: {},
      adapterConfig: { model: "claude-x", env: { ANTHROPIC_API_KEY: "sk-secret" } },
      runtimeConfig: { heartbeatCron: "0 * * * *" },
    });
    const app = await createApp(peerAgentActor("44444444-4444-4444-8444-444444444444"));

    const res = await request(app)
      .put("/api/agents/11111111-1111-4111-8111-111111111111/labels")
      .send({ labelIds: [LABEL_ID] });

    expect(res.status).toBe(200);
    expect(mockAgentService.setAgentLabels).toHaveBeenCalledWith("company-1", "11111111-1111-4111-8111-111111111111", [LABEL_ID]);
    // Configuration is blanked wholesale for callers without config-read
    // permission — the labels route must not become a configuration oracle.
    expect(res.body.adapterConfig).toEqual({});
    expect(res.body.runtimeConfig).toEqual({});
    expect(JSON.stringify(res.body)).not.toContain("sk-secret");
  });
});
