import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import AdminSwrProvider from "@/components/admin/AdminSwrProvider";
import AdminSessionProvider from "@/components/admin/AdminSessionProvider";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Сесія читається тут, а не в кореневому layout: адмінка й так динамічна,
  // а useSession() у дереві нижче одразу отримує дані без запиту
  // /api/auth/session, який раніше блокував перший фетч кожної сторінки.
  const session = await getServerSession(authOptions);

  return (
    <AdminSessionProvider session={session}>
      <AdminSwrProvider>
        <AdminShell>{children}</AdminShell>
      </AdminSwrProvider>
    </AdminSessionProvider>
  );
}
