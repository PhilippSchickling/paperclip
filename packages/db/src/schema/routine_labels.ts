import { pgTable, uuid, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { routines } from "./routines.js";
import { labels } from "./labels.js";

export const routineLabels = pgTable(
  "routine_labels",
  {
    routineId: uuid("routine_id").notNull().references(() => routines.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.routineId, table.labelId], name: "routine_labels_pk" }),
    routineIdx: index("routine_labels_routine_idx").on(table.routineId),
    labelIdx: index("routine_labels_label_idx").on(table.labelId),
    companyIdx: index("routine_labels_company_idx").on(table.companyId),
  }),
);
