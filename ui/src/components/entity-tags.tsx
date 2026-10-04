import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueLabel } from "@paperclipai/shared";
import { Check, Plus, Tag } from "lucide-react";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Company-wide label list, shared with issue labels (same backing table). */
export function useCompanyLabels(companyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.issues.labels(companyId ?? "__none__"),
    queryFn: () => issuesApi.listLabels(companyId!),
    enabled: !!companyId,
  });
}

export function useCreateCompanyLabel(companyId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color: string }) => issuesApi.createLabel(companyId!, data),
    onSuccess: (created) => {
      queryClient.setQueryData<IssueLabel[] | undefined>(
        queryKeys.issues.labels(companyId ?? "__none__"),
        (current) => {
          if (!current) return [created];
          if (current.some((label) => label.id === created.id)) return current;
          return [...current, created];
        },
      );
    },
  });
}

const CHIP_COLORS = (label: IssueLabel) => ({
  backgroundColor: `${label.color}22`,
  color: label.color,
});

/** Read-only tag chips for list rows and detail headers. */
export function TagChips({
  labels,
  max = 3,
  className,
}: {
  labels: IssueLabel[] | undefined;
  max?: number;
  className?: string;
}) {
  const visible = (labels ?? []).slice(0, max);
  if (visible.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {visible.map((label) => (
        <span
          key={label.id}
          className="inline-flex max-w-28 items-center truncate rounded-sm px-1.5 py-0.5 text-(length:--text-micro) leading-none font-medium"
          style={CHIP_COLORS(label)}
          title={label.name}
        >
          {label.name}
        </span>
      ))}
      {(labels ?? []).length > max && (
        <Badge variant="outline" className="border-border text-muted-foreground">
          +{(labels ?? []).length - max}
        </Badge>
      )}
    </span>
  );
}

/** Small dot-only variant for dense rows. */
export function TagDots({ labels, max = 4 }: { labels: IssueLabel[] | undefined; max?: number }) {
  const visible = (labels ?? []).slice(0, max);
  if (visible.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" title={(labels ?? []).map((label) => label.name).join(", ")}>
      {visible.map((label) => (
        <span
          key={label.id}
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: label.color }}
        />
      ))}
      {(labels ?? []).length > max && (
        <span className="text-(length:--text-nano) text-muted-foreground">+{(labels ?? []).length - max}</span>
      )}
    </span>
  );
}

/** List-page filter: pick one company label (or none = all). */
export function TagFilterPopover({
  labels,
  value,
  onChange,
}: {
  labels: IssueLabel[] | undefined;
  value: string | null;
  onChange: (labelId: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const all = labels ?? [];
    if (!search.trim()) return all;
    return all.filter((label) => label.name.toLowerCase().includes(search.trim().toLowerCase()));
  }, [labels, search]);
  const selected = (labels ?? []).find((label) => label.id === value) ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="w-fit text-xs" title="Filter by tag">
          <Tag className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
          <span>{selected ? `Tag: ${selected.name}` : "Tag"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-0">
        <input
          className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border placeholder:text-muted-foreground/50"
          placeholder="Search tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-52 overflow-y-auto overscroll-contain p-1 space-y-0.5">
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm text-left",
              value === null ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => onChange(null)}
          >
            <span>All tags</span>
            {value === null && <Check className="h-3 w-3" aria-hidden="true" />}
          </button>
          {filtered.map((label) => (
            <button
              key={label.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left",
                value === label.id ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
              onClick={() => onChange(label.id)}
            >
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
              <span className="truncate flex-1">{label.name}</span>
              {value === label.id && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Editable tag picker for detail pages. Selection is local until "Save" so a
 * cancelled edit never writes to the entity.
 */
export function TagPickerPopover({
  companyId,
  labels,
  selectedIds,
  onSave,
  saving,
  trigger,
}: {
  companyId: string | null | undefined;
  labels: IssueLabel[] | undefined;
  selectedIds: string[];
  onSave: (labelIds: string[]) => void;
  saving?: boolean;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selectedIds);
  const [search, setSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");
  const createLabel = useCreateCompanyLabel(companyId);

  const sorted = useMemo(
    () => [...(labels ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    return sorted.filter((label) => label.name.toLowerCase().includes(search.trim().toLowerCase()));
  }, [sorted, search]);

  const toggle = (labelId: string) => {
    setDraft((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(selectedIds);
          setSearch("");
        }
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="text-xs">
            <Tag className="h-3.5 w-3.5 mr-1" />
            Tags
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <input
          className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
          placeholder="Search tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-44 overflow-y-auto overscroll-contain space-y-0.5">
          {filtered.map((label) => {
            const selected = draft.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-left",
                  selected && "bg-accent",
                )}
                onClick={() => toggle(label.id)}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                <span className="truncate flex-1">{label.name}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="mt-2 border-t border-border pt-2 space-y-1">
          <div className="flex items-center gap-1">
            <input
              className="h-7 w-7 p-0 rounded bg-transparent"
              type="color"
              value={newLabelColor}
              onChange={(e) => setNewLabelColor(e.target.value)}
            />
            <input
              className="flex-1 px-2 py-1.5 text-xs bg-transparent outline-none rounded placeholder:text-muted-foreground/50"
              placeholder="New tag"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-xs rounded border border-border hover:bg-accent/50 disabled:opacity-50"
            disabled={!newLabelName.trim() || createLabel.isPending}
            onClick={() =>
              createLabel.mutate(
                { name: newLabelName.trim(), color: newLabelColor },
                {
                  onSuccess: (created) => {
                    setDraft((current) => [...current, created.id]);
                    setNewLabelName("");
                  },
                },
              )
            }
          >
            <Plus className="h-3 w-3" />
            {createLabel.isPending ? "Creating…" : "Create tag"}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setDraft(selectedIds);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            // Disabled while a tag creation is in flight so Save cannot submit
            // a draft that predates the new label id.
            disabled={saving || createLabel.isPending}
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
