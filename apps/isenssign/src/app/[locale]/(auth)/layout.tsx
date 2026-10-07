import { FileText } from "lucide-react"

interface AuthLayoutProps {
  children: React.ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <FileText className="size-5" />
        </div>
        <span className="text-2xl font-bold tracking-tight">MySign</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
