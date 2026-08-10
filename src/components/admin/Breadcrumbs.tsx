"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildCrumbs } from "@/lib/admin-nav";

export default function Breadcrumbs() {
  const pathname = usePathname() ?? "/admin";
  const crumbs = buildCrumbs(pathname);
  const last = crumbs[crumbs.length - 1];

  return (
    <nav aria-label="Навігаційний ланцюжок" className="min-w-0 flex-1">
      {/* Мобільно показуємо лише поточну сторінку — ланцюжок не влазить. */}
      <span className="sm:hidden block truncate text-[15px] font-semibold text-bk">{last.title}</span>

      <ol className="hidden sm:flex items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${crumb.href}-${i}`} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && (
                <svg className="w-3.5 h-3.5 flex-shrink-0 text-g300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
              {isLast ? (
                <span className="truncate font-semibold text-bk" aria-current="page">
                  {crumb.title}
                </span>
              ) : (
                <Link href={crumb.href} className="truncate text-g400 transition-colors hover:text-bk">
                  {crumb.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
