"use client";

import { useMemo } from "react";
import { useVirtualScroll } from "@/lib/performance";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VirtualTableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  render?: (row: T, index: number) => React.ReactNode;
}

interface VirtualTableProps<T> {
  data: T[];
  columns: VirtualTableColumn<T>[];
  rowHeight?: number;
  maxHeight?: number;
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function VirtualTable<T extends Record<string, unknown>>({
  data,
  columns,
  rowHeight = 40,
  maxHeight = 600,
  getRowKey,
  onRowClick,
  emptyMessage = "No data",
  className = "",
}: VirtualTableProps<T>) {
  const { containerRef, virtualItems, containerStyle, innerStyle } =
    useVirtualScroll({
      itemCount: data.length,
      itemHeight: rowHeight,
      overscan: 8,
    });

  const colWidths = useMemo(
    () => columns.map((c) => c.width || `${100 / columns.length}%`),
    [columns],
  );

  if (data.length === 0) {
    return (
      <div className={`text-center text-sm text-gray-400 py-12 ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {columns.map((col, ci) => (
          <div
            key={col.key}
            className={`px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex-shrink-0 ${
              col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
            }`}
            style={{ width: colWidths[ci] }}
          >
            {col.header}
          </div>
        ))}
      </div>

      {/* Virtualised rows */}
      <div
        ref={containerRef}
        style={{ ...containerStyle, maxHeight }}
      >
        <div style={innerStyle}>
          {virtualItems.map(({ index, offsetTop }) => {
            const row = data[index];
            return (
              <div
                key={getRowKey(row, index)}
                className={`flex items-center border-b border-gray-100 dark:border-gray-800 ${
                  onRowClick ? "cursor-pointer hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10" : ""
                }`}
                style={{
                  position: "absolute",
                  top: offsetTop,
                  left: 0,
                  right: 0,
                  height: rowHeight,
                }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col, ci) => (
                  <div
                    key={col.key}
                    className={`px-3 text-sm truncate flex-shrink-0 ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    } text-gray-700 dark:text-gray-300`}
                    style={{ width: colWidths[ci], lineHeight: `${rowHeight}px` }}
                  >
                    {col.render ? col.render(row, index) : String(row[col.key] ?? "")}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        {data.length.toLocaleString()} rows
      </div>
    </div>
  );
}
