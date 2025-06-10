"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  // Add a new prop 'markers' to accept an array of numbers for positioning
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { markers?: number[] }
>(({ className, markers, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      // Add vertical padding to give the thumb space to scale on hover without being clipped
      "relative flex w-full touch-none select-none items-center py-2",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <SliderPrimitive.Range className="absolute h-full bg-blue-600 dark:bg-blue-500" />
      {/* Render vertical line markers on the track if they are provided */}
      {markers?.map((value) => {
        // Calculate the percentage position for each marker
        const min = props.min ?? 0;
        const max = props.max ?? 100;
        // Ensure we don't divide by zero if min and max are the same
        const range = max - min;
        if (range === 0) return null;
        const percent = ((value - min) / range) * 100;
        
        return (
          <div
            key={value}
            className="absolute top-0 h-full w-0.5 bg-white/70 dark:bg-black/40"
            style={{ left: `${percent}%` }}
          />
        );
      })}
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "block h-5 w-5 rounded-full border-2 border-blue-600 bg-white shadow-lg",
        "ring-offset-white transition-transform duration-200 ease-in-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2",
        "hover:scale-110", // Enlarge the thumb on hover for better UX
        "disabled:pointer-events-none disabled:opacity-50",
        "dark:border-blue-400 dark:bg-slate-900 dark:ring-offset-slate-950"
      )}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }