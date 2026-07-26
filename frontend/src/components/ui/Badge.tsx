import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors font-mono",
        {
          "bg-surface-container-high text-on-surface-variant border border-outline-variant/40": variant === "default",
          "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30": variant === "success",
          "bg-amber-500/15 text-amber-400 border border-amber-500/30": variant === "warning",
          "bg-red-500/15 text-red-400 border border-red-500/30": variant === "danger",
          "bg-blue-500/15 text-blue-400 border border-blue-500/30": variant === "info",
          "text-on-surface border border-outline-variant": variant === "outline",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
