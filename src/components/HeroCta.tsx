"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export default function HeroCta() {
  const { data: session } = useSession();

  return (
    <div className="flex gap-3 sm:gap-4 justify-center flex-wrap">
      <Link
        href="/catalog"
        className="bg-[#FFD600] hover:bg-[#FFC400] active:bg-[#FFB800] text-[#0A0A0A] px-5 sm:px-7 py-2.5 sm:py-3 rounded-[10px] text-sm sm:text-base font-bold transition duration-200"
      >
        До каталогу
      </Link>
      {!session && (
        <Link
          href="/register"
          className="border border-[#FFD600]/40 text-[#FFD600] hover:bg-[#FFD600] hover:text-[#0A0A0A] px-5 sm:px-7 py-2.5 sm:py-3 rounded-[10px] text-sm sm:text-base font-semibold transition duration-200"
        >
          Реєстрація
        </Link>
      )}
    </div>
  );
}
