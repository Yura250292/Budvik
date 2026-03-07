const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  await prisma.boltsTransaction.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

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

  const categories = await Promise.all([
    prisma.category.create({ data: { name: "Дрилі та перфоратори", slug: "dryli-ta-perforatory" } }),
    prisma.category.create({ data: { name: "Шліфувальні машини", slug: "shlifuvalni-mashyny" } }),
    prisma.category.create({ data: { name: "Пилки та лобзики", slug: "pylky-ta-lobzyky" } }),
    prisma.category.create({ data: { name: "Ручний інструмент", slug: "ruchnyi-instrument" } }),
    prisma.category.create({ data: { name: "Вимірювальний інструмент", slug: "vymiryuvalnyi-instrument" } }),
    prisma.category.create({ data: { name: "Акумуляторний інструмент", slug: "akumulyatornyi-instrument" } }),
  ]);

  const [drills, grinders, saws, handTools, measuring, cordless] = categories;

  const products = [
    { name: "Перфоратор Bosch GBH 2-26 DRE", slug: "bosch-gbh-2-26-dre", description: "Професійний перфоратор з потужністю 800 Вт, 3 режими роботи, SDS-plus.", price: 5490, stock: 15, categoryId: drills.id },
    { name: "Дриль-шуруповерт Makita DF333DWAE", slug: "makita-df333dwae", description: "Акумуляторний дриль-шуруповерт 12V, 2 акумулятори, 30 Нм.", price: 3290, stock: 22, categoryId: drills.id },
    { name: "Ударний дриль Metabo SBE 650", slug: "metabo-sbe-650", description: "Ударний дриль 650 Вт з двошвидкісною коробкою передач.", price: 2890, stock: 18, categoryId: drills.id },
    { name: "Перфоратор DeWalt D25133K", slug: "dewalt-d25133k", description: "Перфоратор SDS-plus 800 Вт, 2.6 Дж енергія удару, 3 режими.", price: 6190, stock: 10, categoryId: drills.id },
    { name: "Дриль Bosch GSB 13 RE", slug: "bosch-gsb-13-re", description: "Ударний дриль 600 Вт, швидкозатискний патрон 13 мм.", price: 2190, stock: 25, categoryId: drills.id },
    { name: "Перфоратор Makita HR2470", slug: "makita-hr2470", description: "Перфоратор SDS-plus 780 Вт, 2.4 Дж, антивібраційна система.", price: 5890, stock: 12, categoryId: drills.id },
    { name: "Міксер-дриль Einhell TC-MX 1400-2 E", slug: "einhell-tc-mx-1400", description: "Міксер будівельний 1400 Вт з двома швидкостями.", price: 1890, stock: 8, categoryId: drills.id },
    { name: "Магнітний дриль Metabo MAG 32", slug: "metabo-mag-32", description: "Свердлильний верстат на магнітній основі 1000 Вт.", price: 18900, stock: 3, categoryId: drills.id },
    { name: "Болгарка Bosch GWS 750-125", slug: "bosch-gws-750-125", description: "Кутова шліфмашина 750 Вт, диск 125 мм, плавний пуск.", price: 2490, stock: 30, categoryId: grinders.id },
    { name: "Ексцентрикова шліфмашина Makita BO5031", slug: "makita-bo5031", description: "Ексцентрикова шліфмашина 300 Вт, діаметр диска 125 мм.", price: 3190, stock: 14, categoryId: grinders.id },
    { name: "Стрічкова шліфмашина Bosch PBS 75 AE", slug: "bosch-pbs-75-ae", description: "Стрічкова шліфмашина 750 Вт, стрічка 75x533 мм.", price: 3690, stock: 9, categoryId: grinders.id },
    { name: "Болгарка DeWalt DWE4257", slug: "dewalt-dwe4257", description: "Кутова шліфмашина 1500 Вт, безщітковий двигун.", price: 4290, stock: 16, categoryId: grinders.id },
    { name: "Вібраційна шліфмашина Makita BO3710", slug: "makita-bo3710", description: "Вібраційна шліфмашина 180 Вт, платформа 93x185 мм.", price: 1990, stock: 20, categoryId: grinders.id },
    { name: "Болгарка Metabo WEV 850-125", slug: "metabo-wev-850-125", description: "Кутова шліфмашина 850 Вт з регулюванням обертів.", price: 3490, stock: 11, categoryId: grinders.id },
    { name: "Полірувальна машина Bosch GPO 14 CE", slug: "bosch-gpo-14-ce", description: "Полірувальна машина 1400 Вт з регулюванням швидкості.", price: 5990, stock: 6, categoryId: grinders.id },
    { name: "Шліфмашина для стін Einhell TC-DW 225", slug: "einhell-tc-dw-225", description: "Шліфмашина для стін та стелі, диск 225 мм.", price: 2790, stock: 7, categoryId: grinders.id },
    { name: "Циркулярна пила Bosch GKS 190", slug: "bosch-gks-190", description: "Дискова пила 1400 Вт, диск 190 мм, глибина різу 70 мм.", price: 3890, stock: 13, categoryId: saws.id },
    { name: "Лобзик Makita 4329", slug: "makita-4329", description: "Електричний лобзик 450 Вт з маятниковим ходом.", price: 2590, stock: 19, categoryId: saws.id },
    { name: "Торцювальна пила Metabo KGS 216 M", slug: "metabo-kgs-216-m", description: "Торцювальна пила з протяжкою 1500 Вт, лазерний маркер.", price: 7490, stock: 5, categoryId: saws.id },
    { name: "Сабельна пила DeWalt DWE305PK", slug: "dewalt-dwe305pk", description: "Сабельна пила 1100 Вт для дерева, металу, пластику.", price: 4890, stock: 8, categoryId: saws.id },
    { name: "Лобзик Bosch GST 8000 E", slug: "bosch-gst-8000-e", description: "Лобзик 710 Вт з SDS-системою заміни пилок.", price: 3190, stock: 15, categoryId: saws.id },
    { name: "Циркулярна пила Makita HS7601", slug: "makita-hs7601", description: "Дискова пила 1200 Вт, диск 190 мм, вага 4 кг.", price: 3490, stock: 11, categoryId: saws.id },
    { name: "Стрічкова пила Metabo BAS 261", slug: "metabo-bas-261", description: "Стрічкова пила для дерева та металу, 400 Вт.", price: 8990, stock: 4, categoryId: saws.id },
    { name: "Реноватор Bosch GOP 30-28", slug: "bosch-gop-30-28", description: "Багатофункціональний інструмент 300 Вт.", price: 4190, stock: 10, categoryId: saws.id },
    { name: "Набір викруток Stanley 10 шт", slug: "stanley-screwdrivers-10", description: "Професійний набір: хрестові та плоскі, хромованадієва сталь.", price: 590, stock: 50, categoryId: handTools.id },
    { name: "Молоток слюсарний Stanley 500г", slug: "stanley-hammer-500", description: "Слюсарний молоток зі скловолоконною ручкою, 500 г.", price: 390, stock: 40, categoryId: handTools.id },
    { name: "Набір ключів рожкових 6-32 мм", slug: "wrench-set-6-32", description: "Набір рожкових ключів 12 шт, хромованадієва сталь.", price: 890, stock: 25, categoryId: handTools.id },
    { name: "Пасатижі комбіновані Knipex 200 мм", slug: "knipex-pliers-200", description: "Комбіновані пасатижі 200 мм, закалені кромки.", price: 1290, stock: 18, categoryId: handTools.id },
    { name: "Набір біт та головок 108 предметів", slug: "bit-set-108", description: "Універсальний набір: біти, головки, тріскачка, кейс.", price: 1690, stock: 15, categoryId: handTools.id },
    { name: "Ножиці по металу Stanley 250 мм", slug: "stanley-metal-scissors-250", description: "Ножиці по металу прямий різ, для сталі до 1.2 мм.", price: 490, stock: 30, categoryId: handTools.id },
    { name: "Розвідний ключ Bahco 250 мм", slug: "bahco-adjustable-250", description: "Розвідний ключ 250 мм з тонкими губками.", price: 790, stock: 22, categoryId: handTools.id },
    { name: "Набір шестигранників 1.5-10 мм", slug: "hex-key-set", description: "Набір шестигранних ключів 9 шт, кулькові наконечники.", price: 290, stock: 45, categoryId: handTools.id },
    { name: "Струбцина швидкозатискна 300 мм", slug: "quick-clamp-300", description: "Швидкозатискна струбцина 300 мм, зусилля 150 кг.", price: 450, stock: 20, categoryId: handTools.id },
    { name: "Ножівка по дереву Stanley 500 мм", slug: "stanley-handsaw-500", description: "Ножівка 500 мм, 7 зубів/дюйм, тефлонове покриття.", price: 350, stock: 35, categoryId: handTools.id },
    { name: "Лазерний рівень Bosch GLL 2-10", slug: "bosch-gll-2-10", description: "Лазерний рівень з 2 лініями, дальність 10 м.", price: 3490, stock: 12, categoryId: measuring.id },
    { name: "Рулетка Stanley FatMax 5м", slug: "stanley-fatmax-5m", description: "Рулетка 5 м з магнітним зачепом, ширина 32 мм.", price: 490, stock: 40, categoryId: measuring.id },
    { name: "Далекомір лазерний Bosch GLM 50 C", slug: "bosch-glm-50-c", description: "Лазерний далекомір 50 м з Bluetooth.", price: 4290, stock: 8, categoryId: measuring.id },
    { name: "Рівень будівельний 100 см", slug: "spirit-level-100", description: "Будівельний рівень 1000 мм з 3 капсулами.", price: 590, stock: 25, categoryId: measuring.id },
    { name: "Штангенциркуль цифровий 150 мм", slug: "digital-caliper-150", description: "Цифровий штангенциркуль, точність 0.01 мм.", price: 690, stock: 20, categoryId: measuring.id },
    { name: "Кутомір цифровий 400 мм", slug: "digital-angle-400", description: "Цифровий кутомір 400 мм, точність 0.1°.", price: 890, stock: 15, categoryId: measuring.id },
    { name: "Детектор прихованої проводки Bosch GMS 120", slug: "bosch-gms-120", description: "Детектор металу, дерева та проводки, до 120 мм.", price: 2990, stock: 10, categoryId: measuring.id },
    { name: "Лазерний нівелір Makita SK105DZ", slug: "makita-sk105dz", description: "Лазерний нівелір з перехресними лініями, 15 м.", price: 3890, stock: 7, categoryId: measuring.id },
    { name: "Акумуляторний шуруповерт Bosch GSR 18V-50", slug: "bosch-gsr-18v-50", description: "Шуруповерт 18 В, 50 Нм, безщітковий двигун.", price: 4990, stock: 14, categoryId: cordless.id },
    { name: "Акумуляторна болгарка Makita DGA504Z", slug: "makita-dga504z", description: "Кутова шліфмашина 18 В, диск 125 мм.", price: 4490, stock: 10, categoryId: cordless.id },
    { name: "Акумуляторний перфоратор DeWalt DCH273N", slug: "dewalt-dch273n", description: "Перфоратор SDS-plus 18 В, 2.1 Дж, безщітковий.", price: 7290, stock: 6, categoryId: cordless.id },
    { name: "Акумуляторний лобзик Bosch GST 18V-LI", slug: "bosch-gst-18v-li", description: "Лобзик 18 В, SDS-система, маятниковий хід.", price: 3990, stock: 9, categoryId: cordless.id },
    { name: "Акумуляторна дискова пила Makita DHS680Z", slug: "makita-dhs680z", description: "Дискова пила 18 В, диск 165 мм, глибина 57 мм.", price: 5490, stock: 7, categoryId: cordless.id },
    { name: "Акумуляторний імпактний шуруповерт Metabo", slug: "metabo-impact-18v", description: "Ударний шуруповерт 18 В, 200 Нм, 2 АКБ 4.0 Аг.", price: 6290, stock: 8, categoryId: cordless.id },
    { name: "Акумуляторний пилосос Bosch GAS 18V-10 L", slug: "bosch-gas-18v-10l", description: "Будівельний пилосос 18 В, об'єм 10 л, HEPA.", price: 3790, stock: 5, categoryId: cordless.id },
    { name: "Акумуляторна сабельна пила DeWalt DCS380N", slug: "dewalt-dcs380n", description: "Сабельна пила 18 В, хід 28 мм.", price: 4190, stock: 11, categoryId: cordless.id },
  ];

  for (const product of products) {
    await prisma.product.create({ data: product });
  }

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
