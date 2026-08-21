"use client";

/**
 * Побудова маршруту і список його точок — разом, бо в них спільний стан.
 *
 * Порядок обʼїзду народжується в оптимізаторі, але спершу має лягти в
 * СПИСОК точок і лише звідти — на карту. Доти список жив своїм життям
 * (порядок з 1С), карта — своїм (порядок варіанта), і однакові номери
 * означали в них різних клієнтів. Тепер запропонований порядок тримається
 * тут і віддається обом.
 */

import { useCallback, useState } from "react";
import RouteOptimizer from "@/components/routes/RouteOptimizer";
import RouteStopsEditor from "@/components/routes/RouteStopsEditor";

type Stop = React.ComponentProps<typeof RouteStopsEditor>["stops"][number];
type Order = React.ComponentProps<typeof RouteStopsEditor>["availableOrders"][number];

export default function RoutePlanPanel({
  routeId,
  driverId,
  date,
  stops,
  editable,
  availableOrders,
  onChanged,
}: {
  routeId: string;
  driverId: string | null;
  date: string;
  stops: Stop[];
  /** false — водій уже в дорозі: точки лише для перегляду */
  editable: boolean;
  availableOrders: Order[];
  onChanged: () => void;
}) {
  /** Непідтверджений порядок: id точок так, як їх пропонує обраний варіант */
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);

  // Стабільна, бо оптимізатор емітить порядок з ефекту: новий колбек на
  // кожен рендер ганяв би цей ефект по колу.
  const handlePreviewOrder = useCallback((ids: string[] | null) => setPreviewOrder(ids), []);

  return (
    <>
      {/* Побудова маршруту: реальні кілометри з OSRM і вибір між
          найдешевшим та варіантом з пріоритетами. Раніше тут був виклик
          LLM, який ВИГАДУВАВ кілометраж, і саме та вигадана цифра лягала
          у вартість пального. */}
      {editable && stops.length >= 2 && (
        <RouteOptimizer
          routeId={routeId}
          driverId={driverId}
          date={date}
          onApplied={onChanged}
          onPreviewOrder={handlePreviewOrder}
        />
      )}
      <RouteStopsEditor
        routeId={routeId}
        stops={stops}
        editable={editable}
        availableOrders={availableOrders}
        onChanged={onChanged}
        previewOrder={previewOrder}
      />
    </>
  );
}
