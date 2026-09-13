/**
 * Заставка запуску робочої збірки: логотип, що оживає, і смуга ходу.
 *
 * Замість чого. Від нативного сплешу до кабінету застосунок проходив три
 * білі екрани: порожню розвилку, голий спінер під токен і білу заглушку
 * WebView на весь час, поки сервер ставить сесію й віддає кабінет. На
 * поганому зв'язку це кілька секунд білого — і людина вирішувала, що
 * застосунок завис.
 *
 * Один шар поверх усього застосунку, а не заглушка в кожному екрані: між
 * етапами (замок → розвилка → кабінет) анімація не перезапускається, і
 * логотип не смикається на стиках. Про хід шар дізнається з lib/boot.ts.
 *
 * Перший кадр — точна копія нативного сплешу: чорний фон і той самий файл
 * 180×180 по центру вікна (плагін expo-splash-screen кладе imageWidth: 180 у
 * полотно 288 dp по центру). Android прибирає сплеш затуханням 400 мс поверх
 * нашого кадру, тож будь-яка різниця в розмірі чи зсуві виглядала б як
 * подвоєний логотип. Звідси два правила: логотип починає рухатися лише ПІСЛЯ
 * того затухання, а смуга з підписом стоять абсолютно під ним, а не сусідом у
 * колонці, — інакше центр логотипа поїхав би вгору.
 *
 * Вбудована Animated, а не reanimated — з тієї ж причини, що в Skeleton.tsx:
 * React Compiler не дозволяє міняти значення, повернуте хуком. Усе на
 * нативному драйвері: JS у мить запуску зайнятий по вінця, і анімація на ньому
 * заїкалася б саме тоді, коли на неї дивляться.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { View, Text, Animated, Easing, StyleSheet, AccessibilityInfo } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { bootDone, bootSnapshot, onBoot, type BootState } from "@/lib/boot";
import { c, type } from "./tokens";

const splashIcon = require("../../assets/images/splash-icon.png");

/** Розмір логотипа — рівно `imageWidth` сплешу в app.config.ts. */
const LOGO = 180;
/** Масштаб, до якого логотип виростає після передачі, і межа «дихання». */
const LOGO_GROWN = 1.12;
const LOGO_BREATH = 1.16;
/**
 * Де закінчується напис «БУДВІК» — у dp від центру картинки 180×180.
 *
 * У файлі навколо знака багато чорного поля (це та сама картинка, що й
 * іконка), тож відступ від краю картинки поставив би смугу далеко від
 * напису. Число виміряне по пікселях splash-icon.png.
 */
const LOGO_INK_BOTTOM = 36;
const TRACK_W = 160;
const TRACK_H = 4;
const SWEEP_W = 48;
/** Верх смуги від центру: низ напису в найбільшому «вдиху» плюс повітря. */
const METER_TOP = Math.round(LOGO_INK_BOTTOM * LOGO_BREATH) + 32;

/** Скільки Android гасить сплеш поверх нашого кадру (SplashScreenManager.kt). */
const SPLASH_FADE_MS = 400;
/** Сплеш не має пережити заставку, навіть якщо картинка так і не показалася. */
const SPLASH_HIDE_FALLBACK_MS = 700;

/**
 * Екрани, перед якими заставка доречна: розвилка й кабінет.
 *
 * Решта — нативні екрани (зміна, день, сканер). Туди на холодному старті веде
 * натискання сповіщення, поки кабінет ще вантажиться під ними, і тримати
 * людину перед логотипом там нема чого — екран уже готовий.
 */
const BOOT_PATHS = new Set(["", "/", "/cabinet"]);

/**
 * Передача від нативного сплешу — рівно один раз за запуск JS.
 *
 * Прапорець на рівні модуля, а не в стані: викликів два (картинка
 * показалася і страхувальний таймер), і другий не має ховати сплеш удруге
 * чи вдруге запускати відлік до руху логотипа.
 */
let splashHandedOff = false;

function handOffSplash(onFaded: () => void) {
  if (splashHandedOff) return;
  splashHandedOff = true;
  try {
    SplashScreen.hide();
  } catch {
    // Модуля сплешу немає (стара оболонка) — ховати нічого.
  }
  setTimeout(onFaded, SPLASH_FADE_MS);
}

function captionFor(s: BootState): string {
  switch (s.stage) {
    case "start":
    case "unlock":
      return "Запуск";
    case "scope":
    case "token":
      return "Відкриваю кабінет";
    case "page":
      return s.progress < 0.9 ? "Завантажую кабінет" : "Майже готово";
    case "ready":
      return "Готово";
  }
}

export function BootScreen() {
  const boot = useSyncExternalStore(onBoot, bootSnapshot);
  const pathname = usePathname();

  /**
   * Знімок, на якому шар догас. Шар видно, поки запуск триває або поки
   * поточний знімок — ще не той, що догас: так затухання встигає пройти до
   * кінця, а повторний запуск (після входу) показує шар знову без жодного
   * setState в ефекті.
   */
  const [hiddenAt, setHiddenAt] = useState<BootState | null>(() =>
    bootSnapshot().active ? null : bootSnapshot()
  );
  const visible = boot.active || boot !== hiddenAt;

  const [handedOff, setHandedOff] = useState(splashHandedOff);
  const [reduceMotion, setReduceMotion] = useState(false);

  /*
    Лінивий ініціалізатор стану, а не useRef().current — як у Skeleton.tsx:
    значення створюється один раз, а читати .current у рендері не можна.
  */
  const [opacity] = useState(() => new Animated.Value(bootSnapshot().active ? 1 : 0));
  const [logo] = useState(() => new Animated.Value(1));
  const [meterIn] = useState(() => new Animated.Value(0));
  const [fill] = useState(() => new Animated.Value(0));
  const [fillX] = useState(() =>
    fill.interpolate({ inputRange: [0, 1], outputRange: [-TRACK_W, 0] })
  );
  const [sweep] = useState(() => new Animated.Value(0));
  const [sweepX] = useState(() =>
    sweep.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP_W, TRACK_W] })
  );

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduceMotion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* Страховка передачі: onDisplay на деяких пристроях може не прийти. */
  useEffect(() => {
    const t = setTimeout(() => handOffSplash(() => setHandedOff(true)), SPLASH_HIDE_FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  /*
    Нативний екран замість кабінету — заставка йде.

    Лише на ЗМІНУ адреси (і на першу), а не на зміну стану запуску: після
    входу кабінет вмикає заставку, коли адреса ще може бути старою
    «/account», і правило за станом зняло б її тієї ж миті.
  */
  useEffect(() => {
    if (bootSnapshot().active && !BOOT_PATHS.has(pathname)) bootDone();
  }, [pathname]);

  /*
    Смуга йде за ходом. Оголошено ПЕРЕД ефектом появи: при повторному запуску
    той має останнім поставити смугу на нуль, а не дивитися, як вона 300 мс
    повзе назад від 100 %.
  */
  useEffect(() => {
    const anim = Animated.timing(fill, {
      toValue: boot.progress,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [boot.progress, fill]);

  /* Поява й зникнення шару. */
  useEffect(() => {
    if (boot.active) {
      fill.setValue(bootSnapshot().progress);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      return;
    }
    const finished = bootSnapshot();
    // Затримка — щоб смуга встигла дотягнутися до кінця: зникнення з
    // недобраною смугою читається як обрив, а не як «готово».
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: 250,
      delay: 200,
      useNativeDriver: true,
    });
    /*
      Прибираємо шар за станом запуску, а не за прапорцем `finished`.

      Анімацію, яку перервали (застосунок пішов у фон посеред затухання,
      система зупинила нативні анімації), бібліотека закінчує з
      finished: false. Якби шар зважав на прапорець, над кабінетом назавжди
      лишилася б напівпрозора чорна плівка. Справжня причина не прибирати шар
      одна — запуск почався знову, і тоді стан уже активний.
    */
    fade.start(() => {
      if (!bootSnapshot().active) setHiddenAt(finished);
    });
    return () => fade.stop();
  }, [boot.active, fill, opacity]);

  /*
    Логотип оживає лише після того, як нативний сплеш догас: рух під час
    затухання дав би на екрані два логотипи різного розміру.
  */
  useEffect(() => {
    if (!visible || !handedOff) return;
    if (reduceMotion) {
      logo.setValue(1);
      meterIn.setValue(1);
      return;
    }
    logo.setValue(1);
    meterIn.setValue(0);
    const intro = Animated.parallel([
      Animated.sequence([
        Animated.timing(logo, {
          toValue: LOGO_GROWN,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(logo, {
              toValue: LOGO_BREATH,
              duration: 900,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(logo, {
              toValue: LOGO_GROWN,
              duration: 900,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        ),
      ]),
      Animated.timing(meterIn, { toValue: 1, duration: 300, delay: 250, useNativeDriver: true }),
    ]);
    intro.start();
    return () => intro.stop();
  }, [visible, handedOff, reduceMotion, logo, meterIn]);

  /*
    Відблиск, що біжить по смузі. На поганому зв'язку хід стоїть на місці
    по кілька секунд, і нерухома смуга виглядала б завислою — відблиск
    показує, що застосунок живий, навіть коли доповідати нема про що.

    Зупиняється разом із шаром: застосунок торгового живе у фоні цілий день,
    і петля, що крутиться для невидимого шару, будила б JS щопівтори секунди.
  */
  useEffect(() => {
    if (!visible || reduceMotion) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [visible, reduceMotion, sweep]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        s.root,
        // Під час затухання дотики вже йдуть у кабінет під шаром.
        { opacity, pointerEvents: boot.active ? "auto" : "none" },
      ]}
    >
      <Animated.View style={{ transform: [{ scale: logo }] }}>
        <Image
          source={splashIcon}
          style={s.logo}
          contentFit="contain"
          onDisplay={() => handOffSplash(() => setHandedOff(true))}
          accessibilityLabel="Будвік"
        />
      </Animated.View>

      <Animated.View style={[s.meter, { opacity: meterIn }]}>
        <View
          style={s.track}
          accessibilityRole="progressbar"
          accessibilityLabel="Завантаження кабінету"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(boot.progress * 100) }}
        >
          <Animated.View style={[s.fill, { transform: [{ translateX: fillX }] }]} />
          {!reduceMotion && (
            <Animated.View style={[s.sweep, { transform: [{ translateX: sweepX }] }]}>
              <LinearGradient
                colors={["#FFFFFF00", "#FFFFFF59", "#FFFFFF00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          )}
        </View>
        <Text style={s.caption} numberOfLines={1}>
          {captionFor(boot).toUpperCase()}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    backgroundColor: c.bk,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  logo: { width: LOGO, height: LOGO },
  /*
    Абсолютно від центру екрана, а не під логотипом у потоці: так центр
    логотипа збігається з центром сплешу, скільки б місця не займала смуга.
  */
  meter: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    marginTop: METER_TOP,
    alignItems: "center",
  },
  /* Доріжка обрізає і заливку, і відблиск — тому overflow: hidden. */
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    overflow: "hidden",
    backgroundColor: c.onDarkFill,
  },
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: c.brand },
  sweep: { position: "absolute", top: 0, bottom: 0, width: SWEEP_W },
  /* Висота фіксована: підпис міняється, а смуга над ним — ні на піксель. */
  caption: {
    ...type.eyebrow,
    color: c.onDarkMuted,
    marginTop: 14,
    height: 16,
    lineHeight: 16,
    textAlign: "center",
  },
});
