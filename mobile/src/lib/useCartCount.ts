/**
 * Скільки одиниць у кошику — для бейджа на вкладці.
 *
 * Слухає зміни, а не перечитує при кожному фокусі: товар кладуть із каталогу,
 * картки чи обраного, і лічильник має здригнутися одразу, бо саме він і є
 * підтвердженням, що дотик спрацював. Без нього людина тисне «У кошик» двічі.
 */

import { useEffect, useState } from "react";
import { getCart, cartCount, onCartChange } from "@/lib/cart";

export function useCartCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const read = () => {
      getCart().then((c) => {
        if (alive) setCount(cartCount(c));
      });
    };

    read();
    const off = onCartChange(read);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return count;
}
