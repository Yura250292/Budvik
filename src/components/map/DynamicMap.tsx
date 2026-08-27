import dynamic from "next/dynamic";

const DynamicDeliveryMap = dynamic(() => import("./DeliveryMap"), {
  ssr: false,
  // Висота та сама, що й у самої карти: інакше в мить підвантаження
  // сторінка сіпалася б на пару сотень пікселів.
  loading: () => (
    <div
      className="flex items-center justify-center rounded-[var(--radius-card)] bg-g100 text-sm text-g400"
      style={{ height: "clamp(300px, 45vh, 420px)" }}
    >
      Завантаження карти...
    </div>
  ),
});

export default DynamicDeliveryMap;
