"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Plus, X, GripVertical, BarChart3, Table, FileText,
  PieChart, TrendingUp, Type, Save, FolderOpen, Trash2,
  Eye, Printer, ChevronDown, ChevronUp, Copy, Layout,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DynamicChart } from "@/components/DynamicChart";
import { PaymentRecord, BankAnalytics, TouchpointAnalytics, ChartType } from "@/types/data";

// ── Types ────────────────────────────────────────────────────────────────────

export type SectionType = "kpi_cards" | "chart" | "table" | "text" | "divider";

export interface ReportSection {
  id: string;
  type: SectionType;
  title: string;
  config: SectionConfig;
}

export interface SectionConfig {
  // Chart config
  chartType?: ChartType;
  dataSource?: "bank" | "touchpoint" | "monthly" | "environment";
  dataKey?: string;
  xAxisKey?: string;
  limit?: number;
  // Table config
  tableColumns?: string[];
  tableRows?: number;
  // Text config
  content?: string;
  // KPI config
  kpis?: string[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  sections: ReportSection[];
  createdAt: string;
}

// ── Presets ───────────────────────────────────────────────────────────────────

const PRESET_TEMPLATES: Omit<ReportTemplate, "id" | "createdAt">[] = [
  {
    name: "Executive Summary",
    description: "High-level KPIs, top banks chart, and touchpoint distribution",
    sections: [
      { id: "s1", type: "text", title: "Report Header", config: { content: "Executive Payment Summary Report" } },
      { id: "s2", type: "kpi_cards", title: "Key Metrics", config: { kpis: ["totalPayments", "totalAmount", "totalAccounts", "totalBanks"] } },
      { id: "s3", type: "chart", title: "Top Banks by Revenue", config: { chartType: "bar", dataSource: "bank", dataKey: "totalAmount", xAxisKey: "bank", limit: 10 } },
      { id: "s4", type: "chart", title: "Touchpoint Distribution", config: { chartType: "pie", dataSource: "touchpoint", dataKey: "count", xAxisKey: "touchpoint" } },
      { id: "s5", type: "table", title: "Bank Breakdown", config: { tableColumns: ["Bank", "Payments", "Amount", "%"], tableRows: 15 } },
    ],
  },
  {
    name: "Monthly Trends",
    description: "Focus on month-over-month payment trends",
    sections: [
      { id: "s1", type: "kpi_cards", title: "Period Overview", config: { kpis: ["totalPayments", "totalAmount"] } },
      { id: "s2", type: "chart", title: "Monthly Revenue Trend", config: { chartType: "line", dataSource: "monthly", dataKey: "amount", xAxisKey: "month" } },
      { id: "s3", type: "chart", title: "Monthly Volume Trend", config: { chartType: "area", dataSource: "monthly", dataKey: "count", xAxisKey: "month" } },
    ],
  },
  {
    name: "Bank Deep Dive",
    description: "Detailed bank analysis with rankings and comparisons",
    sections: [
      { id: "s1", type: "chart", title: "Bank Revenue Ranking", config: { chartType: "barh", dataSource: "bank", dataKey: "totalAmount", xAxisKey: "bank", limit: 20 } },
      { id: "s2", type: "table", title: "Full Bank Table", config: { tableColumns: ["Bank", "Payments", "Amount", "Accounts", "%"], tableRows: 50 } },
      { id: "s3", type: "chart", title: "Top 5 Banks", config: { chartType: "pie", dataSource: "bank", dataKey: "totalAmount", xAxisKey: "bank", limit: 5 } },
    ],
  },
];

const SECTION_TYPES: { type: SectionType; label: string; icon: typeof BarChart3 }[] = [
  { type: "kpi_cards", label: "KPI Cards", icon: Layout },
  { type: "chart", label: "Chart", icon: BarChart3 },
  { type: "table", label: "Data Table", icon: Table },
  { type: "text", label: "Text Block", icon: Type },
  { type: "divider", label: "Divider", icon: FileText },
];

const STORAGE_KEY = "payanalytics_report_templates";

// ── Persistence ──────────────────────────────────────────────────────────────

function loadTemplates(): ReportTemplate[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function saveTemplates(templates: ReportTemplate[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

// ── Helper ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `₱${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `₱${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `₱${(n / 1_000).toFixed(2)}K`;
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Main Component ───────────────────────────────────────────────────────────

interface ReportBuilderProps {
  payments: PaymentRecord[];
  bankAnalytics: BankAnalytics[];
  touchpointAnalytics: TouchpointAnalytics[];
  totalAmount: number;
  totalAccounts: number;
  totalPayments: number;
}

export function ReportBuilder({
  payments,
  bankAnalytics,
  touchpointAnalytics,
  totalAmount,
  totalAccounts,
  totalPayments,
}: ReportBuilderProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reportName, setReportName] = useState("Untitled Report");
  const [isPreview, setIsPreview] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Listen for afterprint to restore chart heights
  useEffect(() => {
    const onAfterPrint = () => setIsPrinting(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const persist = useCallback((t: ReportTemplate[]) => {
    setTemplates(t);
    saveTemplates(t);
  }, []);

  // ── Monthly data ──
  const monthlyData = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const p of payments) {
      const month = p.paymentDate?.slice(0, 7) || "Unknown";
      if (!map.has(month)) map.set(month, { amount: 0, count: 0 });
      const entry = map.get(month)!;
      entry.amount += p.paymentAmount;
      entry.count++;
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({ month, ...d }));
  }, [payments]);

  // ── Section operations ──
  const addSection = (type: SectionType) => {
    // eslint-disable-next-line react-hooks/purity
    const id = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const defaultConfigs: Record<SectionType, SectionConfig> = {
      kpi_cards: { kpis: ["totalPayments", "totalAmount", "totalAccounts", "totalBanks"] },
      chart: { chartType: "bar", dataSource: "bank", dataKey: "totalAmount", xAxisKey: "bank", limit: 10 },
      table: { tableColumns: ["Bank", "Payments", "Amount", "%"], tableRows: 15 },
      text: { content: "Enter your text here..." },
      divider: {},
    };
    setSections([...sections, { id, type, title: SECTION_TYPES.find((s) => s.type === type)?.label || type, config: defaultConfigs[type] }]);
    setShowAddSection(false);
  };

  const removeSection = (id: string) => setSections(sections.filter((s) => s.id !== id));

  const updateSection = (id: string, updates: Partial<ReportSection>) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const moveSection = (fromIdx: number, toIdx: number) => {
    const next = [...sections];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setSections(next);
  };

  // ── Template operations ──
  const saveAsTemplate = () => {
    if (sections.length === 0) return;
    const tmpl: ReportTemplate = {
      id: `tmpl-${Date.now()}`,
      name: reportName,
      description: `${sections.length} sections`,
      sections: [...sections],
      createdAt: new Date().toISOString(),
    };
    persist([...templates, tmpl]);
  };

  const loadTemplate = (tmpl: ReportTemplate) => {
    setReportName(tmpl.name);
    setSections([...tmpl.sections]);
    setShowTemplates(false);
  };

  const loadPreset = (preset: (typeof PRESET_TEMPLATES)[number]) => {
    setReportName(preset.name);
    setSections([...preset.sections]);
    setShowTemplates(false);
  };

  const deleteTemplate = (id: string) => {
    persist(templates.filter((t) => t.id !== id));
  };

  // ── Print ──
  const handlePrint = () => {
    window.print();
  };

  // ── Chart data resolver ──
  const getChartData = (config: SectionConfig) => {
    switch (config.dataSource) {
      case "bank": {
        const limited = config.limit ? bankAnalytics.slice(0, config.limit) : bankAnalytics;
        return limited.map((b) => ({ bank: b.bank, totalAmount: b.totalAmount, paymentCount: b.paymentCount, accountCount: b.accountCount, percentage: b.percentage }));
      }
      case "touchpoint":
        return touchpointAnalytics.map((t) => ({ touchpoint: t.touchpoint, count: t.count, totalAmount: t.totalAmount, percentage: t.percentage }));
      case "monthly":
        return monthlyData;
      default:
        return [];
    }
  };

  // ── KPI values ──
  const kpiMap: Record<string, { label: string; value: string }> = {
    totalPayments: { label: "Total Payments", value: fmt(totalPayments) },
    totalAmount: { label: "Total Amount", value: fmtCurrency(totalAmount) },
    totalAccounts: { label: "Total Accounts", value: fmt(totalAccounts) },
    totalBanks: { label: "Total Banks", value: fmt(bankAnalytics.length) },
  };

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder="Enter report name…"
            className="text-lg font-semibold bg-transparent border border-dashed border-gray-300 dark:border-gray-600 hover:border-[#5B66E2] focus:border-[#5B66E2] focus:border-solid outline-none text-gray-900 dark:text-white px-2 py-1 rounded-md transition-colors"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setShowTemplates(!showTemplates)} className="h-8 text-xs gap-1">
            <FolderOpen className="w-3 h-3" /> Templates
          </Button>
          <Button variant="outline" onClick={saveAsTemplate} disabled={sections.length === 0} className="h-8 text-xs gap-1">
            <Save className="w-3 h-3" /> Save Template
          </Button>
          <Button variant={isPreview ? "default" : "outline"} onClick={() => setIsPreview(!isPreview)} className={`h-8 text-xs gap-1 ${isPreview ? "bg-[#5B66E2]" : ""}`}>
            <Eye className="w-3 h-3" /> {isPreview ? "Edit" : "Preview"}
          </Button>
          <Button variant="outline" onClick={handlePrint} className="h-8 text-xs gap-1">
            <Printer className="w-3 h-3" /> Print
          </Button>
        </div>
      </div>

      {/* Templates Panel */}
      {showTemplates && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-fade-in-up print:hidden">
          <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Report Templates</h3>
          <p className="text-xs text-gray-500 mb-2">Preset Templates</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESET_TEMPLATES.map((p, i) => (
              <button key={i} onClick={() => loadPreset(p)} className="px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-[#5B66E2]/10 hover:border-[#5B66E2] transition-colors text-left">
                <p className="font-medium text-gray-900 dark:text-white">{p.name}</p>
                <p className="text-gray-500 text-[10px]">{p.description}</p>
              </button>
            ))}
          </div>
          {templates.length > 0 && (
            <>
              <p className="text-xs text-gray-500 mb-2">Your Templates</p>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
                    <button onClick={() => loadTemplate(t)} className="hover:text-[#5B66E2]">
                      <p className="font-medium text-gray-900 dark:text-white">{t.name}</p>
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="ml-2 text-gray-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Report Canvas */}
      <div id="report-canvas" className="space-y-4 print:space-y-6">
        {/* Print-only header: bold title + date */}
        <div className="report-print-header hidden print:block mb-4">
          <h1>{reportName}</h1>
          <p className="report-print-date">
            {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        {sections.map((section, idx) => (
          <div
            key={section.id}
            className={`rounded-lg border bg-white dark:bg-gray-800 overflow-hidden transition-all ${
              editingSectionId === section.id
                ? "border-[#5B66E2] ring-1 ring-[#5B66E2]/20"
                : "border-gray-200 dark:border-gray-700"
            }`}
            draggable={!isPreview}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx !== null && dragIdx !== idx) moveSection(dragIdx, idx); setDragIdx(null); }}
          >
            {/* Section Header (hidden in preview) */}
            {!isPreview && (
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 print:hidden">
                <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) => updateSection(section.id, { title: e.target.value })}
                  className="flex-1 text-sm font-medium bg-transparent border-none outline-none text-gray-900 dark:text-white"
                />
                <span className="text-[10px] text-gray-400 uppercase">{section.type.replace("_", " ")}</span>
                <button onClick={() => setEditingSectionId(editingSectionId === section.id ? null : section.id)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                  {editingSectionId === section.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button onClick={() => removeSection(section.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                  <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                </button>
              </div>
            )}

            {/* Section Config (when editing) */}
            {!isPreview && editingSectionId === section.id && section.type === "chart" && (
              <div className="px-4 py-2 bg-muted border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-3 print:hidden">
                <div>
                  <label className="text-[10px] text-gray-500 block">Chart Type</label>
                  <select
                    value={section.config.chartType || "bar"}
                    onChange={(e) => updateSection(section.id, { config: { ...section.config, chartType: e.target.value as ChartType } })}
                    className="h-7 px-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  >
                    <option value="bar">Bar</option>
                    <option value="line">Line</option>
                    <option value="pie">Pie</option>
                    <option value="area">Area</option>
                    <option value="barh">Horizontal Bar</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Data Source</label>
                  <select
                    value={section.config.dataSource || "bank"}
                    onChange={(e) => {
                      const ds = e.target.value as SectionConfig["dataSource"];
                      const defaults: Record<string, { dataKey: string; xAxisKey: string }> = {
                        bank: { dataKey: "totalAmount", xAxisKey: "bank" },
                        touchpoint: { dataKey: "count", xAxisKey: "touchpoint" },
                        monthly: { dataKey: "amount", xAxisKey: "month" },
                      };
                      updateSection(section.id, { config: { ...section.config, dataSource: ds, ...defaults[ds || "bank"] } });
                    }}
                    className="h-7 px-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  >
                    <option value="bank">Bank Data</option>
                    <option value="touchpoint">Touchpoint Data</option>
                    <option value="monthly">Monthly Trend</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Limit</label>
                  <input
                    type="number"
                    value={section.config.limit || ""}
                    onChange={(e) => updateSection(section.id, { config: { ...section.config, limit: Number(e.target.value) || undefined } })}
                    placeholder="All"
                    className="h-7 w-16 px-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  />
                </div>
              </div>
            )}

            {/* Text editor is now inline in the content area below */}

            {/* Section Content */}
            <div className="p-4">
              {/* Screen preview title */}
              {isPreview && section.title && section.type !== "divider" && (
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3 print:hidden">{section.title}</h3>
              )}

              {section.type === "kpi_cards" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(section.config.kpis || []).map((kpi) => {
                    const data = kpiMap[kpi];
                    if (!data) return null;
                    return (
                      <div key={kpi} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-center">
                        <p className="text-xs text-gray-500 mb-1">{data.label}</p>
                        <p className="text-xl font-bold text-[#5B66E2]">{data.value}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {section.type === "chart" && (
                <DynamicChart
                  data={getChartData(section.config)}
                  type={section.config.chartType || "bar"}
                  dataKey={section.config.dataKey || "totalAmount"}
                  xAxisKey={section.config.xAxisKey || "bank"}
                  height={400}
                />
              )}

              {section.type === "table" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        {(section.config.tableColumns || ["Bank", "Payments", "Amount", "%"]).map((col) => (
                          <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {bankAnalytics.slice(0, section.config.tableRows || 15).map((b) => (
                        <tr key={b.bank} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-3 py-2 text-gray-900 dark:text-white">{b.bank}</td>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(b.paymentCount)}</td>
                          <td className="px-3 py-2 text-green-600 dark:text-green-400 font-medium">{fmtCurrency(b.totalAmount)}</td>
                          {(section.config.tableColumns || []).includes("Accounts") && (
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(b.accountCount)}</td>
                          )}
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{b.percentage.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {section.type === "text" && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {isPreview ? (
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{section.config.content}</p>
                  ) : (
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateSection(section.id, { config: { ...section.config, content: e.currentTarget.textContent || "" } })}
                      className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap min-h-[2rem] outline-none cursor-text border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-[#5B66E2] transition-colors print:border-none"
                      data-placeholder="Enter your text here..."
                    >
                      {section.config.content || "Enter your text here..."}
                    </div>
                  )}
                </div>
              )}

              {section.type === "divider" && (
                <hr className="border-gray-200 dark:border-gray-700" />
              )}
            </div>
          </div>
        ))}

        {/* Add Section Button */}
        {!isPreview && (
          <div className="print:hidden">
            {showAddSection ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4 animate-fade-in-up">
                <p className="text-xs font-medium text-gray-500 mb-2">Add Section</p>
                <div className="flex flex-wrap gap-2">
                  {SECTION_TYPES.map((st) => {
                    const Icon = st.icon;
                    return (
                      <button
                        key={st.type}
                        onClick={() => addSection(st.type)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-[#5B66E2]/10 hover:border-[#5B66E2] transition-colors text-sm text-gray-700 dark:text-gray-200"
                      >
                        <Icon className="w-4 h-4" />
                        {st.label}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setShowAddSection(false)} className="mt-2 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddSection(true)}
                className="w-full py-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-[#5B66E2] hover:border-[#5B66E2] transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Report Section
              </button>
            )}
          </div>
        )}

        {sections.length === 0 && !showAddSection && (
          <div className="text-center py-12 text-gray-400 print:hidden">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Start building your report by adding sections or loading a template.</p>
          </div>
        )}
      </div>
    </div>
  );
}
