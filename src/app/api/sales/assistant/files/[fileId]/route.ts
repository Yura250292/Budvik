/**
 * Завантаження файла, який сформував помічник керівника (export_file).
 *
 * Ключ у сховищі збирається з id ПОТОЧНОГО користувача, тож чужий файл за
 * своїм id не знайдеться — окремої перевірки власника не треба (див.
 * lib/assistant/exports/store.ts). Публічної адреси R2 не віддаємо ніде.
 *
 * Байти йдуть через роут, а не редиректом на підписану адресу: файли малі
 * (сотні кілобайт), назва файла з кирилицею доходить заголовком, а в
 * WebView застосунку не треба переходити на чужий домен.
 */

import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { loadExport } from "@/lib/assistant/exports/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const guard = await requireRoles(req, OFFICE_ROLES);
  if (!guard.ok) return guard.response;

  const { fileId } = await params;
  const file = await loadExport(guard.me.userId, fileId);
  if (!file) {
    return Response.json(
      { error: "Файл не знайдено: його сформовано з іншого акаунта або вже видалено (файли живуть 30 днів)" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // ASCII-назва — для старих клієнтів, filename* — справжня, з кирилицею.
  const ascii = file.name.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
