"use client";

import { useCallback, useMemo, useState } from "react";
import { Users, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { PaymentRecord } from "@/types/data";

// ── Types ────────────────────────────────────────────────────────────────────

type RuleOperator = "equals" | "not_equals" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts_with";
type RuleField = "bank" | "environment" | "touchpoint" | "paymentAmount" | "account";

interface SegmentRule {
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

export interface Segment {
  id: string;
  name: string;
  color: string;
  rules: SegmentRule[];
  matchAll: boolean; // true = AND, false = OR
}

interface SegmentationToolsProps {
  payments: PaymentRecord[];
  segments: Segment[];
  onSegmentsChange: (segs: Segment[]) => void;
  activeSegmentId: string | null;
  onActiveSegmentChange: (id: string | null) => void;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "payanalytics_segments";

export function loadSegments(): Segment[] {
  if (typeof window === "undefined") return defaultSegments();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultSegments();
  } catch {
    return defaultSegments();
  }
}

export function saveSegments(segs: Segment[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(segs));
}

function defaultSegments(): Segment[] {
  return [
    {
      id: "high-value",
      name: "High-Value Accounts",
      color: "#22c55e",
      rules: [{ field: "paymentAmount", operator: "gte", value: "100000" }],
      matchAll: true,
    },
    {
      id: "low-value",
      name: "Low-Value Accounts",
      color: "#ef4444",
      rules: [{ field: "paymentAmount", operator: "lt", value: "1000" }],
      matchAll: true,
    },
  ];
}

// ── Evaluate ─────────────────────────────────────────────────────────────────

function evalRule(r: PaymentRecord, rule: SegmentRule): boolean {
  const recordVal = rule.field === "paymentAmount" ? r.paymentAmount : (r as unknown as Record<string, unknown>)[rule.field];
  const strVal = String(recordVal ?? "").toLowerCase();
  const ruleVal = rule.value.toLowerCase();

  switch (rule.operator) {
    case "equals": return strVal === ruleVal;
    case "not_equals": return strVal !== ruleVal;
    case "contains": return strVal.includes(ruleVal);
    case "starts_with": return strVal.startsWith(ruleVal);
    case "gt": return Number(recordVal) > Number(rule.value);
    case "gte": return Number(recordVal) >= Number(rule.value);
    case "lt": return Number(recordVal) < Number(rule.value);
    case "lte": return Number(recordVal) <= Number(rule.value);
    default: return false;
  }
}

export function applySegment(payments: PaymentRecord[], segment: Segment): PaymentRecord[] {
  return payments.filter((p) => {
    const results = segment.rules.map((rule) => evalRule(p, rule));
    return segment.matchAll ? results.every(Boolean) : results.some(Boolean);
  });
}

// ── Colors ───────────────────────────────────────────────────────────────────

const COLORS = ["#5B66E2", "#22c55e", "#ef4444", "#f59e0b", "#06b6d4", "#8b5cf6", "#ec4899", "#14b8a6"];

// ── Operators ────────────────────────────────────────────────────────────────

const OPERATORS: { key: RuleOperator; label: string }[] = [
  { key: "equals", label: "equals" },
  { key: "not_equals", label: "not equals" },
  { key: "gt", label: ">" },
  { key: "gte", label: ">=" },
  { key: "lt", label: "<" },
  { key: "lte", label: "<=" },
  { key: "contains", label: "contains" },
  { key: "starts_with", label: "starts with" },
];

const FIELDS: { key: RuleField; label: string }[] = [
  { key: "bank", label: "Bank" },
  { key: "environment", label: "Environment" },
  { key: "touchpoint", label: "Touchpoint" },
  { key: "paymentAmount", label: "Payment Amount" },
  { key: "account", label: "Account" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function SegmentationTools({ payments, segments, onSegmentsChange, activeSegmentId, onActiveSegmentChange }: SegmentationToolsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Segment | null>(null);

  const persist = useCallback((segs: Segment[]) => {
    onSegmentsChange(segs);
    saveSegments(segs);
  }, [onSegmentsChange]);

  // Segment match counts
  const matchCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const seg of segments) {
      map[seg.id] = applySegment(payments, seg).length;
    }
    return map;
  }, [payments, segments]);

  // Start editing
  function startEdit(seg: Segment) {
    setEditing(seg.id);
    setDraft({ ...seg, rules: seg.rules.map((r) => ({ ...r })) });
  }

  // Start adding new
  function startNew() {
    const id = `seg-${Date.now()}`;
    const newSeg: Segment = {
      id,
      name: "New Segment",
      color: COLORS[segments.length % COLORS.length],
      rules: [{ field: "paymentAmount", operator: "gte", value: "0" }],
      matchAll: true,
    };
    setEditing(id);
    setDraft(newSeg);
  }

  function saveDraft() {
    if (!draft) return;
    const idx = segments.findIndex((s) => s.id === draft.id);
    const next = idx >= 0 ? segments.map((s) => (s.id === draft.id ? draft : s)) : [...segments, draft];
    persist(next);
    setEditing(null);
    setDraft(null);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(null);
  }

  function deleteSegment(id: string) {
    persist(segments.filter((s) => s.id !== id));
    if (activeSegmentId === id) onActiveSegmentChange(null);
  }

  // Removed: no longer hide the entire component when data is empty

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden flex flex-col max-h-[260px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#5B66E2]" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Segments</h3>
          <span className="text-xs text-gray-400">{segments.length} defined</span>
        </div>
        <button onClick={startNew} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[#5B66E2] hover:bg-[#5B66E2]/10 transition-colors">
          <Plus className="w-3 h-3" /> New
        </button>
      </div>

      {/* Segment list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700 flex-1 overflow-y-auto min-h-0">
        {segments.map((seg) => {
          const isEditing = editing === seg.id && draft;
          const count = matchCounts[seg.id] ?? 0;
          const isActive = activeSegmentId === seg.id;

          if (isEditing && draft) {
            return (
              <div key={seg.id} className="p-3 bg-gray-50 dark:bg-gray-900 space-y-2">
                {/* Name */}
                <div className="flex items-center gap-2">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#5B66E2]"
                    placeholder="Segment name"
                  />
                  <select
                    value={draft.matchAll ? "all" : "any"}
                    onChange={(e) => setDraft({ ...draft, matchAll: e.target.value === "all" })}
                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="all">Match ALL</option>
                    <option value="any">Match ANY</option>
                  </select>
                </div>
                {/* Rules */}
                {draft.rules.map((rule, ri) => (
                  <div key={ri} className="flex items-center gap-1.5 flex-wrap">
                    <select value={rule.field} onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, field: e.target.value as RuleField }; setDraft({ ...draft, rules }); }}
                      className="px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                      {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <select value={rule.operator} onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, operator: e.target.value as RuleOperator }; setDraft({ ...draft, rules }); }}
                      className="px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                      {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <input
                      value={rule.value}
                      onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, value: e.target.value }; setDraft({ ...draft, rules }); }}
                      className="flex-1 min-w-[80px] px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#5B66E2]"
                    />
                    {draft.rules.length > 1 && (
                      <button onClick={() => { const rules = draft.rules.filter((_, i) => i !== ri); setDraft({ ...draft, rules }); }} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => setDraft({ ...draft, rules: [...draft.rules, { field: "bank", operator: "equals", value: "" }] })} className="text-xs text-[#5B66E2] hover:underline">+ Add rule</button>
                {/* Save / Cancel */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveDraft} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#5B66E2] text-white hover:bg-[#4a55d1]"><Check className="w-3 h-3" /> Save</button>
                  <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-700"><X className="w-3 h-3" /> Cancel</button>
                </div>
              </div>
            );
          }

          return (
            <div key={seg.id} className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors ${isActive ? "bg-[#5B66E2]/5" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}
              onClick={() => onActiveSegmentChange(isActive ? null : seg.id)}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{seg.name}</p>
                <p className="text-xs text-gray-400">{seg.rules.length} rule{seg.rules.length !== 1 ? "s" : ""} · {seg.matchAll ? "match all" : "match any"}</p>
              </div>
              <span className="text-xs font-medium text-gray-500">{count.toLocaleString()} records</span>
              <button onClick={(e) => { e.stopPropagation(); startEdit(seg); }} className="p-1 text-gray-400 hover:text-[#5B66E2]"><Pencil className="w-3 h-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); deleteSegment(seg.id); }} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          );
        })}

        {/* If adding new and draft doesn't exist in segments yet */}
        {editing && draft && !segments.find((s) => s.id === draft.id) && (
          <div className="p-3 bg-gray-50 dark:bg-gray-900 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#5B66E2]"
                placeholder="Segment name"
              />
              <select
                value={draft.matchAll ? "all" : "any"}
                onChange={(e) => setDraft({ ...draft, matchAll: e.target.value === "all" })}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="all">Match ALL</option>
                <option value="any">Match ANY</option>
              </select>
            </div>
            {draft.rules.map((rule, ri) => (
              <div key={ri} className="flex items-center gap-1.5 flex-wrap">
                <select value={rule.field} onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, field: e.target.value as RuleField }; setDraft({ ...draft, rules }); }}
                  className="px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                  {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select value={rule.operator} onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, operator: e.target.value as RuleOperator }; setDraft({ ...draft, rules }); }}
                  className="px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                  {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <input
                  value={rule.value}
                  onChange={(e) => { const rules = [...draft.rules]; rules[ri] = { ...rule, value: e.target.value }; setDraft({ ...draft, rules }); }}
                  className="flex-1 min-w-[80px] px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#5B66E2]"
                />
                {draft.rules.length > 1 && (
                  <button onClick={() => { const rules = draft.rules.filter((_, i) => i !== ri); setDraft({ ...draft, rules }); }} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                )}
              </div>
            ))}
            <button onClick={() => setDraft({ ...draft, rules: [...draft.rules, { field: "bank", operator: "equals", value: "" }] })} className="text-xs text-[#5B66E2] hover:underline">+ Add rule</button>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={saveDraft} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#5B66E2] text-white hover:bg-[#4a55d1]"><Check className="w-3 h-3" /> Save</button>
              <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-700"><X className="w-3 h-3" /> Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Active segment info */}
      {activeSegmentId && (
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-[#5B66E2]/5">
          <p className="text-xs text-[#5B66E2] font-medium">
            Filtering by: {segments.find((s) => s.id === activeSegmentId)?.name ?? "Unknown"} ({matchCounts[activeSegmentId]?.toLocaleString() ?? 0} records)
          </p>
        </div>
      )}
    </div>
  );
}
