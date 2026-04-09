import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
