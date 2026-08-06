import dynamic from "next/dynamic";

const DynamicShiftMap = dynamic(() => import("./ShiftMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "420px",
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

export default DynamicShiftMap;
