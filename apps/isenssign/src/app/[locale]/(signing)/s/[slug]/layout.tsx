import { FileSignature, Globe } from "lucide-react"

export default function SigningLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b bg-white dark:bg-zinc-900">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">MySign</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <Globe className="h-4 w-4" />
            한국어
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
