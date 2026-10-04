import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentLabels,
  agents,
  companies,
  createDb,
  labels,
  projectLabels,
  projects,
  routineLabels,
  routines,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.js";
import { projectService } from "../services/projects.js";
import { routineService } from "../services/routines.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres entity-label tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("project/routine/agent labels", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const companyId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const routineId = randomUUID();
  const agentId = randomUUID();
  const labelAId = randomUUID();
  const labelBId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-entity-labels-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Labels Co", issuePrefix: "LBL" });
    await db.insert(labels).values([
      { id: labelAId, companyId, name: "alpha", color: "#ff0000" },
      { id: labelBId, companyId, name: "beta", color: "#00ff00" },
    ]);
    await db.insert(projects).values([
      { id: projectId, companyId, name: "Tagged project" },
      { id: otherProjectId, companyId, name: "Untagged project" },
    ]);
    await db.insert(routines).values({ id: routineId, companyId, title: "Tagged routine" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Tagged agent",
      role: "engineer",
      adapterType: "process",
    });
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectLabels);
    await db.delete(routineLabels);
    await db.delete(agentLabels);
  });

  afterAll(async () => {
    await db.delete(routines).where(eq(routines.companyId, companyId));
    await db.delete(projects).where(eq(projects.companyId, companyId));
    await db.delete(agents).where(eq(agents.companyId, companyId));
    await db.delete(labels).where(eq(labels.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await tempDb?.cleanup();
  });

  it("sets, replaces, and clears project labels; list filters by labelId", async () => {
    const svc = projectService(db);

    await svc.setProjectLabels(companyId, projectId, [labelBId, labelAId, labelBId]);
    const tagged = await svc.getById(projectId);
    expect(tagged?.labelIds).toEqual([labelAId, labelBId]);

    const filtered = await svc.list(companyId, { labelId: labelAId });
    expect(filtered.map((project) => project.id)).toEqual([projectId]);

    const untagged = await svc.list(companyId, { labelId: randomUUID() });
    expect(untagged).toEqual([]);

    await svc.setProjectLabels(companyId, projectId, [labelBId]);
    const refiltered = await svc.list(companyId, { labelId: labelAId });
    expect(refiltered.map((project) => project.id)).toEqual([]);

    await svc.setProjectLabels(companyId, projectId, []);
    const cleared = await svc.getById(projectId);
    expect(cleared?.labelIds).toEqual([]);
  });

  it("rejects project labels from another company and unknown projects", async () => {
    const svc = projectService(db);
    await expect(svc.setProjectLabels(companyId, randomUUID(), [])).rejects.toMatchObject({
      status: 422,
    });
    await expect(svc.setProjectLabels(randomUUID(), projectId, [])).rejects.toMatchObject({
      status: 422,
    });
  });

  it("sets routine labels and filters the routines list by labelId", async () => {
    const svc = routineService(db);

    await svc.setRoutineLabels(companyId, routineId, [labelAId]);
    const list = await svc.list(companyId, { labelId: labelAId });
    expect(list.map((routine) => routine.id)).toEqual([routineId]);
    expect(list[0]?.labelIds).toEqual([labelAId]);

    const detail = await svc.getDetail(routineId);
    expect(detail?.labels.map((label) => label.id)).toEqual([labelAId]);

    await svc.setRoutineLabels(companyId, routineId, []);
    const emptied = await svc.list(companyId, { labelId: labelAId });
    expect(emptied).toEqual([]);
  });

  it("sets agent labels and filters the agents list by labelId", async () => {
    const svc = agentService(db);

    await svc.setAgentLabels(companyId, agentId, [labelBId]);
    const filtered = await svc.list(companyId, { labelId: labelBId });
    expect(filtered.map((agent) => agent.id)).toEqual([agentId]);
    expect(filtered[0]?.labelIds).toEqual([labelBId]);

    const byId = await svc.getById(agentId);
    expect(byId?.labelIds).toEqual([labelBId]);

    await svc.setAgentLabels(companyId, agentId, []);
    const cleared = await svc.list(companyId, { labelId: labelBId });
    expect(cleared).toEqual([]);
  });
});
