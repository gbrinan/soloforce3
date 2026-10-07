"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import {
  FileText,
  LayoutDashboard,
  PanelLeft,
  Send,
  Settings,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Link, usePathname } from "@/i18n/navigation"

interface NavItem {
  href: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  groupLabelKey: string
  items: NavItem[]
}

const topLevelItems: NavItem[] = [
  { href: "/", labelKey: "dashboard", icon: LayoutDashboard },
]

const navGroups: NavGroup[] = [
  {
    groupLabelKey: "contractManagement",
    items: [
      { href: "/templates", labelKey: "templates", icon: FileText },
      { href: "/submissions", labelKey: "signRequests", icon: Send },
    ],
  },
]

const bottomItems: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: Settings },
]

const COLLAPSE_KEY = "isenssign-sidebar-collapsed"

export function AppSidebar() {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Restore desktop collapse state
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1")
  }, [])

  // Listen for toggle events from header (mobile off-canvas)
  useEffect(() => {
    const handleToggle = () => setMobileOpen((prev) => !prev)
    window.addEventListener("toggle-sidebar", handleToggle)
    return () => window.removeEventListener("toggle-sidebar", handleToggle)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      return next
    })
  }

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const renderNavLink = (item: NavItem, isCollapsed: boolean) => {
    const Icon = item.icon
    const active = isActive(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        title={isCollapsed ? t(item.labelKey) : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isCollapsed && "justify-center px-0",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        {!isCollapsed && t(item.labelKey)}
      </Link>
    )
  }

  const renderSidebar = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col">
      {/* Collapse/expand toggle — top icon row */}
      <div
        className={cn(
          "flex h-14 items-center",
          isCollapsed ? "justify-center px-0" : "px-3"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="size-5" />
        </Button>
      </div>
      <Separator />

      {/* Navigation */}
      <nav className="flex-1 p-3">
        {/* Top-level items (Dashboard) */}
        <div className="space-y-1">
          {topLevelItems.map((item) => renderNavLink(item, isCollapsed))}
        </div>

        {/* Grouped items */}
        {navGroups.map((group) => (
          <div key={group.groupLabelKey}>
            {!isCollapsed && (
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 px-3 pt-4 pb-1">
                {t(group.groupLabelKey)}
              </p>
            )}
            <div className={cn("space-y-1", isCollapsed && "pt-4")}>
              {group.items.map((item) => renderNavLink(item, isCollapsed))}
            </div>
          </div>
        ))}

        {/* Bottom items (Settings) */}
        <div className="space-y-1 pt-4">
          {bottomItems.map((item) => renderNavLink(item, isCollapsed))}
        </div>
      </nav>
    </div>
  )

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar (always full width) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {renderSidebar(false)}
      </aside>

      {/* Desktop sidebar (collapsible) */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex md:flex-col",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {renderSidebar(collapsed)}
      </aside>
    </>
  )
}
