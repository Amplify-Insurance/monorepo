"use client"

import { Tooltip } from "recharts"

export const ChartContainer = ({ children, config, className }) => {
  return (
    <div
      className={className}
      style={Object.entries(config || {}).reduce((acc, [key, value]) => {
        acc[`--color-${key}`] = value.color
        return acc
      }, {})}
    >
      {children}
    </div>
  )
}

export const ChartTooltip = Tooltip

export const ChartTooltipContent = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="rounded-lg border bg-background p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-[0.70rem] uppercase text-muted-foreground">{label}</span>
          {payload.map((entry) => (
            <span key={entry.name} className="font-bold text-[0.70rem]">
              {entry.name}
            </span>
          ))}
        </div>
        <div className="flex flex-col">
          {payload.map((entry) => (
            <span key={entry.name} className="text-[0.70rem]" style={{ color: entry.color }}>
              {entry.value}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
