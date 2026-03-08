"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

export default function Footer() {
  const [showCallback, setShowCallback] = useState(false);
  const [callbackPhone, setCallbackPhone] = useState("");
  const [callbackSent, setCallbackSent] = useState(false);

  return (
    <>
    <footer className="bg-gradient-to-b from-[#0A0A0A] to-[#050505] text-[#9E9E9E] mt-auto hidden md:block">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">

          {/* Про компанію */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Image src="/logo.png" alt="БУДВІК" width={28} height={28} className="logo-gold" />
              <span className="text-lg font-bold logo-text-animated">БУДВІК</span>
            </div>
            <p className="text-sm leading-relaxed mb-4">
              Багаторічний досвід у сфері консультацій, підбору та продажу інструментів.
              Завжди готові допомогти у виборі необхідного обладнання для будь-яких робіт.
            </p>
            <div className="flex items-center gap-3">
              <a href="https://www.instagram.com/budvik.ua/" target="_blank" rel="noopener noreferrer" className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center hover:bg-[#FFD600] hover:text-[#0A0A0A] transition group">
                <svg className="w-4 h-4 text-[#9E9E9E] group-hover:text-[#0A0A0A]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                </svg>
              </a>
              <a href="https://www.facebook.com/budvik.ua/" target="_blank" rel="noopener noreferrer" className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center hover:bg-[#FFD600] hover:text-[#0A0A0A] transition group">
                <svg className="w-4 h-4 text-[#9E9E9E] group-hover:text-[#0A0A0A]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Навігація */}
          <div>
            <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wide">Навігація</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/catalog" className="hover:text-[#FFD600] transition">Каталог товарів</Link></li>
              <li><Link href="/ai/wizard" className="hover:text-[#FFD600] transition">AI Підбір інструментів</Link></li>
              <li><Link href="/dashboard/orders" className="hover:text-[#FFD600] transition">Мої замовлення</Link></li>
              <li><Link href="/dashboard/loyalty" className="hover:text-[#FFD600] transition">Програма лояльності</Link></li>
              <li><Link href="/wishlist" className="hover:text-[#FFD600] transition">Обране</Link></li>
              <li><Link href="/compare" className="hover:text-[#FFD600] transition">Порівняння</Link></li>
            </ul>
          </div>

          {/* Інформація */}
          <div>
            <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wide">Інформація</h4>
            <ul className="space-y-2.5 text-sm">
              <li><span className="text-[#9E9E9E]">Оплата і доставка</span></li>
              <li><span className="text-[#9E9E9E]">Обмін та повернення</span></li>
              <li><span className="text-[#9E9E9E]">Гарантія</span></li>
              <li><span className="text-[#9E9E9E]">Договір оферти</span></li>
              <li><Link href="/register" className="hover:text-[#FFD600] transition">Реєстрація</Link></li>
              <li><Link href="/dashboard/wholesale" className="hover:text-[#FFD600] transition">Оптовим покупцям</Link></li>
            </ul>
          </div>

          {/* Контакти */}
          <div>
            <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wide">Контакти</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="tel:+380772700027" className="flex items-center gap-2 hover:text-[#FFD600] transition group">
                  <svg className="w-4 h-4 text-[#FFD600] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  077 270 00 27
                </a>
              </li>
              <li>
                <a href="tel:+380932700027" className="flex items-center gap-2 hover:text-[#FFD600] transition">
                  <svg className="w-4 h-4 text-[#FFD600] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  093 270 00 27
                </a>
              </li>
              <li>
                <a href="mailto:budvik27@gmail.com" className="flex items-center gap-2 hover:text-[#FFD600] transition">
                  <svg className="w-4 h-4 text-[#FFD600] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  budvik27@gmail.com
                </a>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-[#FFD600] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>м. Львів, вул. Липинського, 36</span>
              </li>
            </ul>

            <button
              onClick={() => setShowCallback(true)}
              className="mt-4 w-full flex items-center justify-center gap-2 border border-[#FFD600]/40 text-[#FFD600] px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#FFD600]/10 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Передзвонити мені
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/10 mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[#9E9E9E]">
            &copy; 2026 БУДВІК. Усі права захищені.
          </p>
          <p className="text-xs text-[#555]">
            Всі ціни на сайті вказано в гривнях (UAH) з урахуванням ПДВ.
          </p>
        </div>
      </div>
    </footer>

    {/* Callback Modal */}
    {showCallback && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setShowCallback(false); setCallbackSent(false); }}>
        <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
          {callbackSent ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-[#0A0A0A] mb-1">Заявку прийнято!</h3>
              <p className="text-sm text-[#9E9E9E]">Ми передзвонимо вам найближчим часом</p>
              <button onClick={() => { setShowCallback(false); setCallbackSent(false); }} className="mt-4 bg-[#FFD600] text-[#0A0A0A] px-6 py-2 rounded-lg font-semibold hover:bg-[#FFC400] transition">
                Добре
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-[#0A0A0A]">Передзвонити вам?</h3>
                <button onClick={() => setShowCallback(false)} className="text-[#9E9E9E] hover:text-[#0A0A0A] transition">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <p className="text-sm text-[#9E9E9E] mb-4">Залиште свій номер і ми зв&apos;яжемось з вами</p>
              <input
                type="tel"
                placeholder="+380 (__) ___-__-__"
                value={callbackPhone}
                onChange={e => setCallbackPhone(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[#0A0A0A] text-sm focus:outline-none focus:border-[#FFD600] focus:ring-1 focus:ring-[#FFD600] mb-3"
              />
              <button
                onClick={() => { setCallbackSent(true); setCallbackPhone(""); }}
                disabled={callbackPhone.length < 10}
                className="w-full bg-[#FFD600] text-[#0A0A0A] py-3 rounded-lg font-semibold hover:bg-[#FFC400] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Надіслати
              </button>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
