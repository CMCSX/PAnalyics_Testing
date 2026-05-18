"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartType } from "@/types/data";

interface DynamicChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>[];
  type: ChartType;
  dataKey: string;
  xAxisKey: string;
  height?: number;
  title?: string;
  valueType?: string;
  
}

/** Brand palette — 12 slots for multi-series / pie charts */
const COLORS = [
  "#5B66E2", // indigo
  "#8B96F2", // light indigo
  "#4a55d1", // dark indigo
  "#A0A8F8", // soft indigo
  "#3840b0", // deep indigo
  "#7B86E8", // medium indigo
  "#C8CCFA", // pale indigo
  "#E0E3FD", // off-white indigo
  "#2E3590", // navy indigo
  "#B0B8F5", // soft light indigo
  "#9AA3F0", // periwinkle
  "#6B76E5", // medium-light indigo
];

const BRAND = "#5B66E2";

const tooltipStyle = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  color: "#ffffff",
  borderRadius: "8px",
  fontSize: "13px",
} as const;

const tooltipLabelStyle = { color: "#ffffff" } as const;
const tooltipItemStyle = { color: "#ffffff" } as const;

/** Truncate long labels for chart axes/legends */
function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/** Shorter truncation for bar chart x-axis labels */
function truncateAxis(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/** Format number with compact abbreviations (1K, 4M, 2B, etc.) */
function fmtNum(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (abs >= 1_000_000)
    return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (abs >= 1_000)
    return `${(value / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
  return value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DynamicChart({
  data,
  type,
  dataKey,
  xAxisKey,
  height = 350,
  title,
}: DynamicChartProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    setContainerWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((item, index) => ({
      ...item,
      _shortName: truncateAxis(String(item[xAxisKey] ?? ""), 10),
      _uniqueId: `${xAxisKey}-${item[xAxisKey]}-${index}`,
    }));
  }, [data, xAxisKey]);

  const formatTooltipValue = useCallback((value: unknown) => {
    const num = Number(value);
    const formatted = fmtNum(isNaN(num) ? 0 : num);
    if (dataKey === "percentage") return `${formatted}%`;
    if (dataKey === "count") return formatted;
    return `₱${formatted}`;
  }, [dataKey]);

  const formatAxisTick = useCallback((value: number) => {
    if (dataKey === "percentage") return `${fmtNum(value)}%`;
    return fmtNum(value);
  }, [dataKey]);

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const renderChart = () => {
    // Responsive: on narrow containers, skip some x-axis labels to prevent overlap
    const isCompact = containerWidth < 500;
    const barInterval = isCompact ? Math.max(1, Math.floor(processedData.length / 15)) : 0;

    switch (type) {
      case "bar":
        return (
          <BarChart data={processedData} margin={{ left: isCompact ? 10 : 30, right: isCompact ? 10 : 30, top: 15, bottom: 40 }}>
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4a55d1" stopOpacity={1} />
                <stop offset="100%" stopColor="#8B96F2" stopOpacity={0.8} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="_shortName"
              className="text-muted-foreground"
              tick={{ fontSize: isCompact ? 9 : 11 }}
              angle={-45}
              textAnchor="end"
              interval={barInterval}
              height={50}
            />
            <YAxis
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
              tickFormatter={formatAxisTick}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={formatTooltipValue}
              cursor={{ fill: "rgba(209, 213, 219, 0.08)" }}
            />
            <Bar
              dataKey={dataKey}
              fill="url(#barGradient)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        );
      case "barh":
        return (
          <BarChart
            data={processedData}
            layout="vertical"
            margin={{ left: 30, right: 30, top: 5, bottom: 5 }}
          >
            <defs>
              <linearGradient id="barhGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4a55d1" stopOpacity={1} />
                <stop offset="100%" stopColor="#8B96F2" stopOpacity={0.8} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
              tickFormatter={formatAxisTick}
            />
            <YAxis
              type="category"
              dataKey="_shortName"
              className="text-muted-foreground"
              tick={{ fontSize: 11 }}
              width={40}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={formatTooltipValue}
              cursor={{ fill: "rgba(209, 213, 219, 0.08)" }}
            />
            <Bar
              dataKey={dataKey}
              fill="url(#barhGradient)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={processedData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey={xAxisKey}
              className="text-muted-foreground"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              className="text-muted-foreground"
              tick={{ fontSize: 11 }}
              tickFormatter={formatAxisTick}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={tooltipStyle} 
              formatter={formatTooltipValue}
              cursor={{ stroke: "#5B66E2", strokeWidth: 1, strokeDasharray: "4 4" }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#5B66E2"
              strokeWidth={2.5}
              dot={{ fill: "#5B66E2", r: 5, strokeWidth: 2, stroke: "#fff" }}
              activeDot={{ r: 7, fill: "#5B66E2", stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={processedData} margin={{ left: 30, right: 30, top: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5B66E2" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#ffffff" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={xAxisKey}
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
            />
            <YAxis
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
              tickFormatter={formatAxisTick}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={formatTooltipValue}
              cursor={{ fill: "rgba(209, 213, 219, 0.08)" }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={BRAND}
              fill="url(#areaGradient)"
              strokeWidth={2}
              activeDot={{ r: 6, fill: BRAND }}
            />
          </AreaChart>
        );
      
      case "pie":
      case "donut": {
        const isNarrow = containerWidth < 380;
        const isDonut = type === "donut";
        const outerR = Math.min(height * 0.38, isNarrow ? 90 : 140);
        const innerR = isDonut ? outerR * 0.6 : 0; // Donut has inner radius
        const RADIAN = Math.PI / 180;

        // Calculate total for percentages
        const total = processedData.reduce((sum, item) => sum + Number((item as Record<string, unknown>)[dataKey] || 0), 0);

        // Custom label renderer that shows name outside the pie for ALL slices
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderOuterLabel = (props: any) => {
          const { cx = 0, cy = 0, midAngle = 0, outerRadius: oR = 0, name = "" } = props;
          
          // Position label outside the pie
          const radius = oR + 30;
          const x = cx + radius * Math.cos(-midAngle * RADIAN);
          const y = cy + radius * Math.sin(-midAngle * RADIAN);
          
          // Truncate long names
          const displayName = name.length > 15 ? name.substring(0, 15) + "..." : name;
          
          return (
            <text
              x={x}
              y={y}
              fill="currentColor"
              textAnchor={x > cx ? "start" : "end"}
              dominantBaseline="central"
              className="text-gray-700 dark:text-gray-300"
              fontSize={10}
              fontWeight={600}
            >
              {displayName}
            </text>
          );
        };

        // Custom tooltip that shows percentage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const CustomTooltip = ({ active, payload }: any) => {
          if (!active || !payload || !payload.length) return null;
          const data = payload[0];
          const value = Number(data.value || 0);
          const percentage = total > 0 ? ((value / total) * 100).toFixed(2) : "0.00";
          
          return (
            <div style={tooltipStyle} className="px-3 py-2">
              <p className="font-semibold mb-1" style={{ color: "#ffffff" }}>
                {data.name}
              </p>
              <p style={{ color: "#ffffff" }}>
                {formatTooltipValue(value)}
              </p>
              <p className="text-sm mt-1" style={{ color: "#a0aec0" }}>
                {percentage}% of total
              </p>
            </div>
          );
        };

        // Enhanced legend formatter that shows name + percentage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legendFormatter = (value: string, entry: any) => {
          const itemValue = Number(entry.payload[dataKey] || 0);
          const percentage = total > 0 ? ((itemValue / total) * 100).toFixed(1) : "0.0";
          const truncatedName = isNarrow ? truncate(value, 12) : truncate(value, 18);
          return `${truncatedName} (${percentage}%)`;
        };

        return (
          <PieChart margin={{ top: 30, bottom: 30, left: 20, right: 20 }}>
            <Pie
              data={processedData}
              cx={isNarrow ? "50%" : "38%"}
              cy={isNarrow ? "50%" : "50%"}
              outerRadius={outerR}
              innerRadius={innerR}
              dataKey={dataKey}
              nameKey={xAxisKey}
              label={renderOuterLabel}
              labelLine={{
                stroke: "#94a3b8",
                strokeWidth: 1,
              }}
            >
              {processedData.map((entry, index) => (
                <Cell
                  key={
                    (entry._uniqueId as string) || `cell-${index}`
                  }
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            {isNarrow ? (
              <Legend
                layout="horizontal"
                align="center"
                verticalAlign="bottom"
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={legendFormatter}
              />
            ) : (
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                wrapperStyle={{ fontSize: 12, maxHeight: height, overflow: "auto", paddingLeft: 8, lineHeight: "1.8" }}
                formatter={legendFormatter}
              />
            )}
          </PieChart>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div ref={containerRef} className="rounded-lg bg-card p-4">
      {title && (
        <h3 className="mb-4 text-lg font-semibold font-display text-foreground">
          {title}
        </h3>
      )}
      <div style={{ overflow: 'visible', position: 'relative' }}>
        <ResponsiveContainer width="100%" height={height} style={{ overflow: 'visible' }}>
          {renderChart() as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
