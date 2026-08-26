/**
 * Своя заглушка карти: спільна по секції показала б список карток там,
 * де зараз розгорнеться карта на весь екран, і перехід читався б як
 * «відкрилось не те».
 *
 * Розміри один в один зі сторінкою: той самий fixed-шар до нижнього
 * меню, той самий сірий, що й у заглушки самого компонента карти
 * (dynamic → loading), тож між цією заглушкою й наступною немає стрибка.
 */
export default function SalesMapLoading() {
  return (
    <div
      className="fixed inset-x-0"
      style={{ top: 0, bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))", background: "#EEE" }}
    >
      {/* Смужка пошуку поверх карти — вона на місці ще до даних */}
      <div
        className="absolute inset-x-0 top-0 px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          background: "linear-gradient(#F7F7F7EE, #F7F7F700)",
        }}
      >
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 shrink-0 rounded-full bg-white shadow" />
          <div className="h-9 min-w-0 flex-1 rounded-full bg-white shadow" />
        </div>
      </div>
    </div>
  );
}
