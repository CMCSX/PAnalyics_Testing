"use client";

import { useState, useEffect, useRef } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { type DateRange as DayPickerRange } from "react-day-picker";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRange = "today" | "week" | "month" | "year" | "all" | "custom";

export interface CustomDateRange {
  from: Date;
  to: Date;
}

const options: { value: DateRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

interface DateFilterProps {
  value: DateRange;
  onChange: (range: DateRange, custom?: CustomDateRange) => void;
  customRange?: CustomDateRange;
  dataStartDate?: Date;
}

export function DateFilter({ value, onChange, customRange, dataStartDate }: DateFilterProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<DayPickerRange | undefined>(
    customRange ? { from: customRange.from, to: customRange.to } : undefined
  );
  const defaultMonth = customRange?.from ?? new Date();
  const [calendarMonth, setCalendarMonth] = useState<Date>(defaultMonth);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (calendarOpen) {
      setSelected(customRange ? { from: customRange.from, to: customRange.to } : undefined);
      setCalendarMonth(customRange?.from ?? new Date());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarOpen]);

  const handleOptionClick = (val: DateRange) => {
    setDropdownOpen(false);
    if (val === "custom") {
      setCalendarOpen(true);
    } else {
      setSelected(undefined);
      onChange(val);
    }
  };

  const handleApply = () => {
    if (selected?.from && selected?.to) {
      onChange("custom", { from: selected.from, to: selected.to });
      setCalendarOpen(false);
    }
  };

  const handleClear = () => {
    setSelected(undefined);
    onChange("all");
    setCalendarOpen(false);
  };

  const displayLabel =
    value === "custom" && customRange
      ? `${customRange.from.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${customRange.to.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`
      : options.find((o) => o.value === value)?.label ?? "All Time";

  const pickingEnd = selected?.from && !selected?.to;

  return (
    <div className="flex items-center gap-2">
      {/* Custom dropdown — always fires on click regardless of current value */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-muted/50 dark:hover:bg-muted transition-colors"
        >
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleOptionClick(opt.value)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  value === opt.value
                    ? "bg-[#5B66E2] text-white hover:bg-[#4a55d1] dark:hover:bg-[#4a55d1]"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                {opt.label}
                {/* Show edit hint when custom is already selected */}
                {opt.value === "custom" && value === "custom" && (
                  <span className="text-xs opacity-70 ml-1">edit</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Calendar popover */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {!selected?.from
                ? "Select start date"
                : pickingEnd
                ? "Now select end date"
                : `${selected.from.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} → ${selected.to?.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`}
            </p>
            {dataStartDate && !selected?.from && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Data range starts {dataStartDate.toLocaleDateString("en-PH", { month: "short", year: "numeric" })}
              </p>
            )}
          </div>
          <ShadcnCalendar
            mode="range"
            selected={selected}
            onSelect={setSelected}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            numberOfMonths={1}
            captionLayout="dropdown"
            className="[--rdp-accent-color:#5B66E2] [--rdp-accent-background-color:#EEF0FD] dark:[--rdp-accent-background-color:rgba(91,102,226,0.25)]"
          />
          <div className="flex items-center justify-between gap-2 p-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleClear}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleApply}
              disabled={!selected?.from || !selected?.to}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#5B66E2] text-white hover:bg-[#4a55d1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Filter an array of records by a date field string (YYYY-MM-DD) */
export function filterByDateRange<T>(
  items: T[],
  range: DateRange,
  getDate: (item: T) => string,
  custom?: CustomDateRange
): T[] {
  if (range === "all") return items;

  const parseLocal = (s: string): Date | null => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  if (range === "custom" && custom) {
    const start = new Date(custom.from.getFullYear(), custom.from.getMonth(), custom.from.getDate());
    const end = new Date(custom.to.getFullYear(), custom.to.getMonth(), custom.to.getDate());
    return items.filter((item) => {
      const d = parseLocal(getDate(item));
      return d !== null && d >= start && d <= end;
    });
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let start: Date;
  let end: Date | null = null;
  
  switch (range) {
    case "today":
      start = today;
      end = today;
      break;
    case "week": {
      const day = today.getDay();
      start = new Date(today);
      start.setDate(today.getDate() - day);
      end = today;
      break;
    }
    case "month":
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = today;
      break;
    case "year":
      start = new Date(today.getFullYear(), 0, 1);
      end = today;
      break;
    default:
      return items;
  }

  return items.filter((item) => {
    const d = parseLocal(getDate(item));
    if (d === null) return false;
    if (end) {
      return d >= start && d <= end;
    }
    return d >= start;
  });
}

/** Convert a DateRange + optional CustomDateRange to API-compatible date_from / date_to strings (YYYY-MM-DD) */
export function dateRangeToBounds(
  range: DateRange,
  custom?: CustomDateRange
): { date_from?: string; date_to?: string } {
  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (range === "all") return {};

  if (range === "custom" && custom) {
    return { date_from: fmt(custom.from), date_to: fmt(custom.to) };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case "today":
      return { date_from: fmt(today), date_to: fmt(today) };
    case "week": {
      const day = today.getDay();
      const start = new Date(today);
      start.setDate(today.getDate() - day);
      return { date_from: fmt(start), date_to: fmt(today) };
    }
    case "month":
      return { date_from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: fmt(today) };
    case "year":
      return { date_from: fmt(new Date(today.getFullYear(), 0, 1)), date_to: fmt(today) };
    default:
      return {};
  }
}
