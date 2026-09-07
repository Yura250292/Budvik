/**
 * Вхід у кабінет: чи потрапляє КОЖНА роль у свою домівку.
 *
 * 07.09 складовщик щоранку відкривав кабінет торгового й читав «Доступ
 * заборонено. На головну». Причина була не в ролях і не в паролі: на
 * холодному старті (tabs)/_layout шле в /cabinet БЕЗ адреси — свідомо, щоб
 * її вибрав сервер за роллю, — а cabinet.tsx підставляв замість неї жорстке
 * "/sales". Тобто кожен, крім торгового й адміністратора, впирався в гейт
 * чужої секції.
 *
 * Помилка мовчазна з обох боків: у застосунку немає адресного рядка, а сайт
 * віддає нормальну сторінку з ввічливим відмовним текстом. Тому перевірка тут:
 *   npx tsx scripts/check-cabinet-entry.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const mobile = join(import.meta.dirname, "..", "src");
const site = join(import.meta.dirname, "..", "..", "src");
const read = (p: string) => readFileSync(p, "utf8");

let failed = 0;
function check(name: string, cond: boolean, hint?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`);
  }
}

const cabinet = read(join(mobile, "app", "cabinet.tsx"));
const account = read(join(mobile, "app", "(tabs)", "account.tsx"));
const tabsLayout = read(join(mobile, "app", "(tabs)", "_layout.tsx"));
const controller = read(join(mobile, "track", "controller.ts"));
const authStore = read(join(mobile, "lib", "auth-store.ts"));
const sessionRoute = read(join(site, "app", "api", "device", "session", "route.ts"));
const roleTarget = read(join(site, "lib", "app", "role-target.ts"));

console.log("\nКуди відкривається кабінет");

check(
  "cabinet.tsx не підставляє чужу домівку замість невідомої",
  !/const redirect =[^;]*"\/(sales|driver|warehouse|admin)"/s.test(cabinet),
  'Порожня адреса має лишатися порожньою — за роллю відповідає /api/device/session.'
);
check(
  "без адреси кабінет питає сервер",
  /uri: redirect\s*\?[\s\S]*:\s*`\$\{API_BASE\}\/api\/device\/session`/.test(cabinet),
  "Очікується гілка: є адреса — з ?redirect=, немає — без параметра."
);
check(
  "вхід не підставляє /sales, коли сервер домівки не назвав",
  !/target:\s*res\.target\s*\?\?/.test(account),
  "account.tsx має передавати params лише за наявності res.target."
);
check(
  "сервер знає домівку кожної робочої ролі",
  ["DRIVER", "SALES", "ADMIN", "MANAGER", "WAREHOUSE"].every((r) => roleTarget.includes(`"${r}"`)),
  "defaultTargetFor мусить називати адресу для всіх ролей із isStaffRole."
);
check(
  "/api/device/session бере адресу за роллю, коли її не передали",
  /defaultTargetFor\(user\.role\)/.test(sessionRoute)
);

console.log("\nВихід із акаунта");

check(
  "вихід гасить токен і в планшеті, не лише на сервері",
  /clearToken\(\)/.test(controller),
  "Без цього (tabs)/_layout бачить область «track» і вертає людину в кабінет по колу."
);
check(
  "токен на сервері гаситься ДО стирання локального",
  controller.indexOf("staffApi.logout()") < controller.indexOf("await clearToken()"),
  "Після clearToken запит іде без заголовка, і планшет лишається з правом лити трек."
);
check(
  "кожен крок виходу має межу очікування",
  /within\(stopEverything\(\)/.test(controller) &&
    /within\(flush\(true\)/.test(controller) &&
    /within\(staffApi\.logout\(\)/.test(controller),
  "Мережа у виході без межі — це застиглий екран на хвилини (див. rn-fetch-timeout-trap)."
);
check(
  "невідомий розмір буфера не веде до стирання дня",
  !/bufferedCount\(\)\.catch\(\(\) => 0\)/.test(controller) && /left > 0/.test(controller),
  "Запасним значенням має бути -1: «не дізналися» ≠ «порожньо»."
);
check(
  "розвилка вітрина/кабінет чує зміну області",
  /onScopeChange/.test(tabsLayout) && /export function onScopeChange/.test(authStore),
  "Інакше після виходу шар вкладок і далі вважає людину працівником."
);

console.log("\nМікрофон помічника");

const bridge = read(join(mobile, "lib", "bridge.ts"));
const nativeApp = read(join(site, "lib", "useIsNativeApp.ts"));
const voice = read(join(site, "components", "sales", "assistant", "useVoiceInput.ts"));

check(
  "застосунок каже сторінці, що система думає про мікрофон",
  /micPermission/.test(bridge) && /micPermission\?\(\)/.test(nativeApp),
  "Без цієї довідки «дозволу немає» і «пристрій зайнятий» на сторінці не відрізнити."
);
check(
  "кабінет читає дозвіл у системи, а не з пам'яті",
  /PermissionsAndroid\.check\(PermissionsAndroid\.PERMISSIONS\.RECORD_AUDIO\)/.test(cabinet),
  "Дозвіл міняють руками в налаштуваннях, і події про це нам ніхто не шле."
);
check(
  "заборона «назавжди» веде в налаштування, а не в глухий кут",
  /NEVER_ASK_AGAIN/.test(cabinet) && /openAppSettings/.test(bridge),
  "PermissionsAndroid.request у цьому стані повертає відмову МОВЧКИ, без діалога."
);
check(
  "потік мікрофона відпускається на будь-якому виході",
  /releaseMic/.test(voice) && (voice.match(/releaseMic\(\)/g)?.length ?? 0) >= 3,
  "Провал створення записувача лишав мікрофон захопленим назавжди."
);
check(
  "жоден ТЕКСТ для людини не звинувачує неіснуючий застосунок",
  // Саме рядки, які повертаються на екран, — пояснення в коментарях ловити
  // не треба, вони якраз і розказують, чому так робити не можна.
  !/return\s+"[^"]*зайнятий іншим застосунком/.test(voice),
  "07.09: людина читала звинувачення на адресу програми, якої не було."
);

console.log(failed ? `\n✗ Провалено перевірок: ${failed}\n` : "\n✓ Вхід, вихід і мікрофон зведені\n");
process.exit(failed ? 1 : 0);
