"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { Loader } from "@/components/motion/loader"
import { EASE_IN_OUT } from "@/lib/ease"

interface RccLoadingOverlayProps {
  /** Whether the RCC generation request is in flight. */
  open: boolean
  /** Visible and announced status label. */
  label?: string
}

// Full-viewport loading overlay for the slow RCC generation request only,
// never for the quick cascading select loads. The wrapper only animates
// opacity (no movement), so reduced-motion users besides the loader's own
// degraded state see a plain cross-fade.
export function RccLoadingOverlay({
  open,
  label = "Generando RCC…",
}: RccLoadingOverlayProps) {
  const reduce = useReducedMotion() ?? false

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="rcc-loading-overlay"
          className="fixed inset-0 z-50 grid place-items-center bg-background/55 backdrop-blur-[2px]"
          initial={reduce ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.15, ease: EASE_IN_OUT }}
        >
          <div className="flex flex-col items-center gap-3">
            <Loader variant="helix" size={44} label={label} />
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
