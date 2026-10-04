import { pgTable, uuid, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { labels } from "./labels.js";

export const agentLabels = pgTable(
  "agent_labels",
  {
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.labelId], name: "agent_labels_pk" }),
    agentIdx: index("agent_labels_agent_idx").on(table.agentId),
    labelIdx: index("agent_labels_label_idx").on(table.labelId),
    companyIdx: index("agent_labels_company_idx").on(table.companyId),
  }),
);
