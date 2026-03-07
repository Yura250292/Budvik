import { OrderStatus } from "@prisma/client";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${ORDER_STATUS_COLORS[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
