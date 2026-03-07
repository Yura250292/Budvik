const { PrismaClient } = require("../src/generated/prisma") as any;
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.boltsTransaction.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  const adminPass = await bcrypt.hash("admin123", 10);
  const salesPass = await bcrypt.hash("sales123", 10);
  const clientPass = await bcrypt.hash("client123", 10);

  await prisma.user.createMany({
    data: [
      { email: "admin@budvik.ua", password: adminPass, name: "Адміністратор", role: "ADMIN", phone: "+380501234567" },
      { email: "sales@budvik.ua", password: salesPass, name: "Менеджер Олена", role: "SALES", phone: "+380502345678" },
      { email: "client@budvik.ua", password: clientPass, name: "Іван Петренко", role: "CLIENT", phone: "+380503456789", boltsBalance: 150 },
    ],
  });

  // Create categories
  const categories = await Promise.all([
    prisma.category.create({ data: { name: "Дрилі та перфоратори", slug: "dryli-ta-perforatory", image: "/images/categories/drills.svg" } }),
    prisma.category.create({ data: { name: "Шліфувальні машини", slug: "shlifuvalni-mashyny", image: "/images/categories/grinders.svg" } }),
    prisma.category.create({ data: { name: "Пилки та лобзики", slug: "pylky-ta-lobzyky", image: "/images/categories/saws.svg" } }),
    prisma.category.create({ data: { name: "Ручний інструмент", slug: "ruchnyi-instrument", image: "/images/categories/hand-tools.svg" } }),
    prisma.category.create({ data: { name: "Вимірювальний інструмент", slug: "vymiryuvalnyi-instrument", image: "/images/categories/measuring.svg" } }),
    prisma.category.create({ data: { name: "Акумуляторний інструмент", slug: "akumulyatornyi-instrument", image: "/images/categories/cordless.svg" } }),
  ]);

  const [drills, grinders, saws, handTools, measuring, cordless] = categories;

  // Create 50 products
  const products = [
    // Дрилі та перфоратори (8)
    { name: "Перфоратор Bosch GBH 2-26 DRE", slug: "bosch-gbh-2-26-dre", description: "Професійний перфоратор з потужністю 800 Вт, 3 режими роботи, SDS-plus. Ідеальний для свердління бетону, цегли та каменю.", price: 5490, stock: 15, categoryId: drills.id },
    { name: "Дриль-шуруповерт Makita DF333DWAE", slug: "makita-df333dwae", description: "Акумуляторний дриль-шуруповерт 12V, 2 акумулятори, 30 Нм крутного моменту. Легкий та компактний.", price: 3290, stock: 22, categoryId: drills.id },
    { name: "Ударний дриль Metabo SBE 650", slug: "metabo-sbe-650", description: "Ударний дриль 650 Вт з двошвидкісною коробкою передач. Металевий корпус редуктора.", price: 2890, stock: 18, categoryId: drills.id },
    { name: "Перфоратор DeWalt D25133K", slug: "dewalt-d25133k", description: "Перфоратор SDS-plus 800 Вт, 2.6 Дж енергія удару, 3 режими. Кейс в комплекті.", price: 6190, stock: 10, categoryId: drills.id },
    { name: "Дриль Bosch GSB 13 RE", slug: "bosch-gsb-13-re", description: "Ударний дриль 600 Вт, швидкозатискний патрон 13 мм. Компактний та надійний.", price: 2190, stock: 25, categoryId: drills.id },
    { name: "Перфоратор Makita HR2470", slug: "makita-hr2470", description: "Перфоратор SDS-plus 780 Вт, 2.4 Дж, 3 режими роботи. Антивібраційна система.", price: 5890, stock: 12, categoryId: drills.id },
    { name: "Міксер-дриль Einhell TC-MX 1400-2 E", slug: "einhell-tc-mx-1400", description: "Міксер будівельний 1400 Вт з двома швидкостями. Для змішування фарб, клеїв, штукатурок.", price: 1890, stock: 8, categoryId: drills.id },
    { name: "Магнітний дриль Metabo MAG 32", slug: "metabo-mag-32", description: "Свердлильний верстат на магнітній основі 1000 Вт. Для свердління металу до 32 мм.", price: 18900, stock: 3, categoryId: drills.id },

    // Шліфувальні машини (8)
    { name: "Болгарка Bosch GWS 750-125", slug: "bosch-gws-750-125", description: "Кутова шліфмашина 750 Вт, диск 125 мм. Захист від перевантаження, плавний пуск.", price: 2490, stock: 30, categoryId: grinders.id },
    { name: "Ексцентрикова шліфмашина Makita BO5031", slug: "makita-bo5031", description: "Ексцентрикова шліфмашина 300 Вт, діаметр диска 125 мм. Регулювання обертів.", price: 3190, stock: 14, categoryId: grinders.id },
    { name: "Стрічкова шліфмашина Bosch PBS 75 AE", slug: "bosch-pbs-75-ae", description: "Стрічкова шліфмашина 750 Вт, стрічка 75x533 мм. Електронне регулювання швидкості.", price: 3690, stock: 9, categoryId: grinders.id },
    { name: "Болгарка DeWalt DWE4257", slug: "dewalt-dwe4257", description: "Кутова шліфмашина 1500 Вт, диск 125 мм. Безщітковий двигун, плавний пуск.", price: 4290, stock: 16, categoryId: grinders.id },
    { name: "Вібраційна шліфмашина Makita BO3710", slug: "makita-bo3710", description: "Вібраційна шліфмашина 180 Вт, платформа 93x185 мм. Збір пилу, легка вага.", price: 1990, stock: 20, categoryId: grinders.id },
    { name: "Болгарка Metabo WEV 850-125", slug: "metabo-wev-850-125", description: "Кутова шліфмашина 850 Вт з регулюванням обертів. Захист від перезапуску.", price: 3490, stock: 11, categoryId: grinders.id },
    { name: "Полірувальна машина Bosch GPO 14 CE", slug: "bosch-gpo-14-ce", description: "Полірувальна машина 1400 Вт з регулюванням швидкості. Для автомобілів та каменю.", price: 5990, stock: 6, categoryId: grinders.id },
    { name: "Шліфмашина для стін Einhell TC-DW 225", slug: "einhell-tc-dw-225", description: "Шліфмашина для стін та стелі, диск 225 мм. Телескопічна ручка, підсвітка.", price: 2790, stock: 7, categoryId: grinders.id },

    // Пилки та лобзики (8)
    { name: "Циркулярна пила Bosch GKS 190", slug: "bosch-gks-190", description: "Дискова пила 1400 Вт, диск 190 мм. Глибина різу 70 мм. Паралельний упор.", price: 3890, stock: 13, categoryId: saws.id },
    { name: "Лобзик Makita 4329", slug: "makita-4329", description: "Електричний лобзик 450 Вт з маятниковим ходом. Швидкозмінна система полотен.", price: 2590, stock: 19, categoryId: saws.id },
    { name: "Торцювальна пила Metabo KGS 216 M", slug: "metabo-kgs-216-m", description: "Торцювальна пила з протяжкою 1500 Вт. Диск 216 мм, лазерний маркер.", price: 7490, stock: 5, categoryId: saws.id },
    { name: "Сабельна пила DeWalt DWE305PK", slug: "dewalt-dwe305pk", description: "Сабельна пила 1100 Вт зі змінною швидкістю. Для дерева, металу, пластику.", price: 4890, stock: 8, categoryId: saws.id },
    { name: "Лобзик Bosch GST 8000 E", slug: "bosch-gst-8000-e", description: "Лобзик 710 Вт з електронним регулюванням швидкості. SDS-система заміни пилок.", price: 3190, stock: 15, categoryId: saws.id },
    { name: "Циркулярна пила Makita HS7601", slug: "makita-hs7601", description: "Дискова пила 1200 Вт, диск 190 мм. Легка конструкція 4 кг.", price: 3490, stock: 11, categoryId: saws.id },
    { name: "Стрічкова пила Metabo BAS 261", slug: "metabo-bas-261", description: "Стрічкова пила для дерева та металу, 400 Вт. Стіл з нахилом до 45°.", price: 8990, stock: 4, categoryId: saws.id },
    { name: "Реноватор Bosch GOP 30-28", slug: "bosch-gop-30-28", description: "Багатофункціональний інструмент 300 Вт. Різання, шліфування, зачистка.", price: 4190, stock: 10, categoryId: saws.id },

    // Ручний інструмент (10)
    { name: "Набір викруток Stanley 10 шт", slug: "stanley-screwdrivers-10", description: "Професійний набір викруток: хрестові та плоскі. Хромованадієва сталь, ергономічна ручка.", price: 590, stock: 50, categoryId: handTools.id },
    { name: "Молоток слюсарний Stanley 500г", slug: "stanley-hammer-500", description: "Слюсарний молоток зі скловолоконною ручкою. Вага бойка 500 г. Антивібраційна система.", price: 390, stock: 40, categoryId: handTools.id },
    { name: "Набір ключів рожкових 6-32 мм", slug: "wrench-set-6-32", description: "Набір рожкових ключів 12 шт (6-32 мм). Хромованадієва сталь, матове покриття.", price: 890, stock: 25, categoryId: handTools.id },
    { name: "Пасатижі комбіновані Knipex 200 мм", slug: "knipex-pliers-200", description: "Комбіновані пасатижі 200 мм. Багатокомпонентні ручки, закалені кромки.", price: 1290, stock: 18, categoryId: handTools.id },
    { name: "Набір біт та головок 108 предметів", slug: "bit-set-108", description: "Універсальний набір інструментів: біти, головки, тріскачка, подовжувачі. Кейс.", price: 1690, stock: 15, categoryId: handTools.id },
    { name: "Ножиці по металу Stanley 250 мм", slug: "stanley-metal-scissors-250", description: "Ножиці по металу прямий різ, 250 мм. Для сталі до 1.2 мм.", price: 490, stock: 30, categoryId: handTools.id },
    { name: "Розвідний ключ Bahco 250 мм", slug: "bahco-adjustable-250", description: "Розвідний ключ 250 мм з тонкими губками. Хромованадієва сталь, шкала.", price: 790, stock: 22, categoryId: handTools.id },
    { name: "Набір шестигранників 1.5-10 мм", slug: "hex-key-set", description: "Набір шестигранних ключів 9 шт (1.5-10 мм). Загартована сталь, кулькові наконечники.", price: 290, stock: 45, categoryId: handTools.id },
    { name: "Струбцина швидкозатискна 300 мм", slug: "quick-clamp-300", description: "Швидкозатискна струбцина 300 мм, зусилля 150 кг. Одноручне керування.", price: 450, stock: 20, categoryId: handTools.id },
    { name: "Ножівка по дереву Stanley 500 мм", slug: "stanley-handsaw-500", description: "Ножівка по дереву 500 мм, 7 зубів на дюйм. Тефлонове покриття полотна.", price: 350, stock: 35, categoryId: handTools.id },

    // Вимірювальний інструмент (8)
    { name: "Лазерний рівень Bosch GLL 2-10", slug: "bosch-gll-2-10", description: "Лазерний рівень з 2 лініями, дальність 10 м. Самонівелювання, кріплення в комплекті.", price: 3490, stock: 12, categoryId: measuring.id },
    { name: "Рулетка Stanley FatMax 5м", slug: "stanley-fatmax-5m", description: "Рулетка 5 м з магнітним зачепом. Ширина стрічки 32 мм, нейлонове покриття.", price: 490, stock: 40, categoryId: measuring.id },
    { name: "Далекомір лазерний Bosch GLM 50 C", slug: "bosch-glm-50-c", description: "Лазерний далекомір 50 м з Bluetooth. Розрахунок площі та об'єму, пам'ять.", price: 4290, stock: 8, categoryId: measuring.id },
    { name: "Рівень будівельний 100 см", slug: "spirit-level-100", description: "Будівельний рівень 1000 мм з 3 капсулами. Алюмінієвий профіль, точність 0.5 мм/м.", price: 590, stock: 25, categoryId: measuring.id },
    { name: "Штангенциркуль цифровий 150 мм", slug: "digital-caliper-150", description: "Цифровий штангенциркуль 150 мм, точність 0.01 мм. Нержавіюча сталь, LCD-дисплей.", price: 690, stock: 20, categoryId: measuring.id },
    { name: "Кутомір цифровий 400 мм", slug: "digital-angle-400", description: "Цифровий кутомір 400 мм з фіксацією кута. Точність 0.1°, дисплей з підсвіткою.", price: 890, stock: 15, categoryId: measuring.id },
    { name: "Детектор прихованої проводки Bosch GMS 120", slug: "bosch-gms-120", description: "Детектор металу, дерева та проводки. Глибина виявлення до 120 мм.", price: 2990, stock: 10, categoryId: measuring.id },
    { name: "Лазерний нівелір Makita SK105DZ", slug: "makita-sk105dz", description: "Лазерний нівелір з перехресними лініями. Самовирівнювання, дальність 15 м.", price: 3890, stock: 7, categoryId: measuring.id },

    // Акумуляторний інструмент (8)
    { name: "Акумуляторний шуруповерт Bosch GSR 18V-50", slug: "bosch-gsr-18v-50", description: "Шуруповерт 18 В, 50 Нм, 2 акумулятори 2.0 Аг. Безщітковий двигун, LED-підсвітка.", price: 4990, stock: 14, categoryId: cordless.id },
    { name: "Акумуляторна болгарка Makita DGA504Z", slug: "makita-dga504z", description: "Кутова шліфмашина 18 В, диск 125 мм. Без акумулятора, безщітковий двигун.", price: 4490, stock: 10, categoryId: cordless.id },
    { name: "Акумуляторний перфоратор DeWalt DCH273N", slug: "dewalt-dch273n", description: "Перфоратор SDS-plus 18 В, 2.1 Дж. Безщітковий, 3 режими. Без АКБ.", price: 7290, stock: 6, categoryId: cordless.id },
    { name: "Акумуляторний лобзик Bosch GST 18V-LI", slug: "bosch-gst-18v-li", description: "Лобзик 18 В зі змінною швидкістю. SDS-система, маятниковий хід. Без АКБ.", price: 3990, stock: 9, categoryId: cordless.id },
    { name: "Акумуляторна дискова пила Makita DHS680Z", slug: "makita-dhs680z", description: "Дискова пила 18 В, диск 165 мм. Безщітковий, глибина різу 57 мм.", price: 5490, stock: 7, categoryId: cordless.id },
    { name: "Акумуляторний імпактний шуруповерт Metabo", slug: "metabo-impact-18v", description: "Ударний шуруповерт 18 В, 200 Нм. 2 акумулятори 4.0 Аг, зарядний пристрій.", price: 6290, stock: 8, categoryId: cordless.id },
    { name: "Акумуляторний пилосос Bosch GAS 18V-10 L", slug: "bosch-gas-18v-10l", description: "Будівельний пилосос 18 В, об'єм 10 л. Фільтр HEPA, без акумулятора.", price: 3790, stock: 5, categoryId: cordless.id },
    { name: "Акумуляторна сабельна пила DeWalt DCS380N", slug: "dewalt-dcs380n", description: "Сабельна пила 18 В, хід 28 мм. Регулювання швидкості, без АКБ.", price: 4190, stock: 11, categoryId: cordless.id },
  ];

  for (const product of products) {
    await prisma.product.create({ data: product });
  }

  // Create sample bolts transaction for client
  const client = await prisma.user.findUnique({ where: { email: "client@budvik.ua" } });
  if (client) {
    await prisma.boltsTransaction.create({
      data: {
        userId: client.id,
        amount: 150,
        type: "EARNED",
        description: "Вітальний бонус при реєстрації",
      },
    });
  }

  console.log("Seed completed: 3 users, 6 categories, 50 products");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
