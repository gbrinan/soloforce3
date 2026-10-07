"use client"

import { useTranslations } from "next-intl"
import { Search, PanelLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function Header() {
  const t = useTranslations("common")

  const toggleSidebar = () => {
    window.dispatchEvent(new CustomEvent("toggle-sidebar"))
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
      {/* Sidebar toggle button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="md:hidden"
      >
        <PanelLeft className="size-5" />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("search")}
            className="w-56 pl-8"
          />
        </div>

        {/* All UI elements removed - app inherits theme/locale from MyCrew host */}
      </div>
    </header>
  )
}
