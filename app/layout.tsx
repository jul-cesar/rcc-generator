import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { RccHeader } from "@/components/rcc-header"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Generador de RCC",
  description: "Genera datos RCC desde repositorios de Azure DevOps.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn("font-sans antialiased", inter.variable, fontMono.variable)}
    >
      <body>
        {/* RccHeader must sit INSIDE ThemeProvider: the toggle resolves the
            active mode via next-themes context (useTheme needs the provider,
            not just client-side rendering). */}
        <ThemeProvider defaultTheme="light">
          <RccHeader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
