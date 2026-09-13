import { redirect } from "next/navigation";

/**
 * Корінь розділу — одразу «Рух на карті»: це перше питання, з яким сюди
 * заходять («де зараз машини»), і окремої сторінки-змісту розділ не має —
 * зміст уже є в смужці вкладок і в сайдбарі.
 */
export default function LogisticsIndex() {
  redirect("/admin/logistics/live");
}
