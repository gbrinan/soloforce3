import { AppSidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { Toaster } from "@/components/ui/sonner"
import SignFab from "@/components/SignFab"

interface DashboardLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  await params

  // 호스트(:3457)가 이미 Google SSO로 진입을 게이팅한다. 직접 iframe(크로스오리진)으로
  // 임베드되면 mycrew_sid 쿠키가 전달되지 않아 외부 redirect 시 iframe 안에서 404로 보였다.
  // 호스트 레벨에서 접근이 보호되므로 여기서는 그대로 렌더한다.

  return (
    <div className="flex h-full min-h-screen">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
