import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { agentLabels } from "./schema/agent_labels.js";
import { projectLabels } from "./schema/project_labels.js";
import { routineLabels } from "./schema/routine_labels.js";

const cases = [
  {
    tableName: "agent_labels",
    table: agentLabels,
    entityColumn: "agent_id",
    referencedTables: { agent_id: "agents", label_id: "labels", company_id: "companies" },
  },
  {
    tableName: "project_labels",
    table: projectLabels,
    entityColumn: "project_id",
    referencedTables: { project_id: "projects", label_id: "labels", company_id: "companies" },
  },
  {
    tableName: "routine_labels",
    table: routineLabels,
    entityColumn: "routine_id",
    referencedTables: { routine_id: "routines", label_id: "labels", company_id: "companies" },
  },
] as const;

describe.each(cases)("$tableName join table", ({ tableName, table, entityColumn, referencedTables }) => {
  it("deduplicates entity-label links with a composite primary key", () => {
    const config = getTableConfig(table);
    expect(config.name).toBe(tableName);
    expect(config.primaryKeys[0]?.name).toBe(`${tableName}_pk`);
    expect(config.primaryKeys[0]?.columns.map((column) => (column as { name: string }).name).sort()).toEqual(
      [entityColumn, "label_id"].sort(),
    );
    expect(
      config.columns.map((column) => (column as { name: string }).name).sort(),
    ).toEqual([entityColumn, "company_id", "created_at", "label_id"].sort());
  });

  it("cascades deletes from entity, label, and company", () => {
    const config = getTableConfig(table) as unknown as {
      foreignKeys: { getName(): string; onDelete?: string; reference(): { foreignTable: { getTableSymbol?(name: symbol): unknown } } }[];
    };
    for (const [columnName, referencedTable] of Object.entries(referencedTables)) {
      const fkName = `${tableName}_${columnName}_${referencedTable}_id_fk`;
      const fk = config.foreignKeys.find((candidate) => candidate.getName() === fkName);
      expect(fk, `missing foreign key ${fkName}`).toBeDefined();
      expect(fk?.onDelete).toBe("cascade");
    }
  });

  it("indexes entity, label, and company lookups", () => {
    const config = getTableConfig(table);
    const indexNames = config.indexes.map((index) => index.config.name).sort();
    expect(indexNames).toEqual(
      [`${tableName}_${entityColumn.replace("_id", "")}_idx`, `${tableName}_company_idx`, `${tableName}_label_idx`].sort(),
    );
  });
});
