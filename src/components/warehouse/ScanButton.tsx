"use client";

import { ScanLine } from "lucide-react";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { Button } from "@/components/cabinet/ui";

/**
 * Кнопка сканера — через міст, коли поруч є застосунок.
 *
 * Чому не просто посилання на /warehouse/scan. Перехоплення адрес у WebView
 * працює лише для СПРАВЖНЬОЇ навігації (на Android це
 * `shouldOverrideUrlLoading`), а кабінет ходить м'якими переходами Next: дотик
 * по звичайному посиланню відкрив би веб-сторінку з полем файлу — тобто
 * галерею й системний вибір замість камери, три зайві дотики на КОЖНУ
 * накладну.
 *
 * У браузері лишається посилання. У застосунку без цього методу моста
 * (збірки до 07.09.2026) — жорсткий перехід: він теж відкриє веб-сторінку,
 * і це саме те, що там і має статися.
 */
export function ScanButton({ label = "Сканувати накладну" }: { label?: string }) {
  const isApp = useIsNativeApp();

  if (isApp) {
    return (
      <Button
        tone="brand"
        onClick={() => {
          const bridge = window.BudvikApp;
          if (bridge?.openScanner) bridge.openScanner();
          else window.location.href = "/warehouse/scan";
        }}
        className="w-full"
      >
        <ScanLine size={20} />
        {label}
      </Button>
    );
  }

  return (
    <Button tone="brand" href="/warehouse/scan" className="w-full">
      <ScanLine size={20} />
      {label}
    </Button>
  );
}
