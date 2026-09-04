/**
 * Обмежувач одночасних задач на десяток рядків.
 *
 * Замість залежності: єдине, що тут потрібно, — не запускати більше трьох
 * важких запитів одночасно, бо пул Prisma спільний з усім сайтом.
 */

export default function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    queue.shift()?.();
  };

  return function run<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        job().then(resolve, reject).finally(next);
      };
      if (active < max) start();
      else queue.push(start);
    });
  };
}
