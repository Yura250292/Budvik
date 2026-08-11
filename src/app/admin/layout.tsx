import AdminShell from "@/components/admin/AdminShell";
import AdminSwrProvider from "@/components/admin/AdminSwrProvider";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSwrProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSwrProvider>
  );
}
