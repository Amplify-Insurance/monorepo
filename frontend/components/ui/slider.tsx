"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  markers?: number[]
}

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, markers = [], ...props }, ref) => (
    <div className="relative">
      <SliderPrimitive.Root
        ref={ref}
        className={cn("relative flex w-full touch-none select-none items-center", className)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500" />
        </SliderPrimitive.Track>

        {/* Render markers */}
        {markers.map((marker) => (
          <div
            key={marker}
            className="absolute w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 top-1/2"
            style={{ left: `${(marker / (props.max || 100)) * 100}%` }}
          />
        ))}

        <SliderPrimitive.Thumb className="block h-6 w-6 rounded-full border-2 border-blue-500 dark:border-blue-400 bg-white dark:bg-gray-800 shadow-lg ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-gray-950 dark:focus-visible:ring-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700" />
      </SliderPrimitive.Root>
    </div>
  ),
)
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
