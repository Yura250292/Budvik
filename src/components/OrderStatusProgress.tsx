import { ORDER_STATUS_LABELS } from "@/lib/utils";
import type { OrderStatus } from "@prisma/client";

/** CANCELLED поза шкалою — це вихід зі шляху, а не його крок. */
const STEPS: OrderStatus[] = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED"];

/**
 * Шкала руху замовлення. Серверний компонент без стану — той самий вигляд
 * і в кабінеті покупця, і на гостьовій сторінці відстеження.
 */
export default function OrderStatusProgress({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") return null;
  const current = STEPS.indexOf(status);

  return (
    <div className="bg-white border border-g200 rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  i <= current ? "bg-primary text-bk" : "bg-g200 text-g400"
                }`}
              >
                {i <= current ? "✓" : i + 1}
              </div>
              <span className="text-xs mt-1 text-g400 text-center hidden sm:block">
                {ORDER_STATUS_LABELS[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-1 mx-2 ${i < current ? "bg-primary" : "bg-g200"}`} />
            )}
          </div>
        ))}
      </div>
      {/* На вузькому екрані підписи кроків приховані — лишаємо поточний. */}
      <p className="text-sm text-g600 text-center mt-3 sm:hidden">
        {ORDER_STATUS_LABELS[status]}
      </p>
    </div>
  );
}
