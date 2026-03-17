import dynamic from "next/dynamic";

const DynamicDeliveryMap = dynamic(() => import("./DeliveryMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "500px",
        background: "#F3F4F6",
        borderRadius: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9CA3AF",
        fontSize: "14px",
      }}
    >
      Завантаження карти...
    </div>
  ),
});

export default DynamicDeliveryMap;
