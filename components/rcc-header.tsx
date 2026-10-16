"use client"

import { GitBranch } from "lucide-react"

import { ThemeToggle } from "@/components/motion/theme-toggle"

// Sticky app header. The content row reuses the workbench container widths and
// paddings (mx-auto max-w-7xl xl:max-w-[1440px] 2xl:max-w-[1680px] px-4
// sm:px-6 lg:px-8) so both line up on the same axis.
// Hover/focus styling mirrors the ghost variant in components/ui/button.tsx.
export function RccHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 xl:max-w-[1440px] 2xl:max-w-[1680px] lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <GitBranch className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Generador de RCC
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Azure DevOps · Entregas
          </span>
        </div>
        <ThemeToggle
          variant="circle-blur"
          start="top-right"
          className="size-9 shrink-0 rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-muted/50"
          iconClassName="size-4"
        />
      </div>
    </header>
  )
}
