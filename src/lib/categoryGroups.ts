/**
 * Category groups for commission rates.
 * Each group contains subcategory slugs from the database.
 * Commission rates are set per group per sales rep.
 */

export interface CategoryGroup {
  key: string;       // unique identifier for CommissionRate
  name: string;      // display name
  icon: string;
  slugs: string[];   // category slugs belonging to this group
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    key: "elektro-instrument",
    name: "Ручний електроінструмент",
    icon: "⚡",
    slugs: [
      "ruchnyy-elektroinstrument",
      "shurupoverty", "merezhevi", "akumulyatorni",
      "perforatory", "pryami-perforatory", "bochkovi-perforatory",
      "elektrolobzyky",
      "dryli", "udarni-dryli",
      "tsyrkulyarni-pyly",
      "vidbiyni-molotky",
      "kutovi-shlifmashyny-bolharky",
      "shlifuval-ni-mashyny",
      "elektrorubanky",
      "kleyevi-pistolety",
      "budivel-ni-pylososy",
      "elektyrychni-farbopul-ty",
      "budivel-ni-feny",
      "pylososy",
    ],
  },
  {
    key: "elektro-sad",
    name: "Електро садова техніка",
    icon: "🌿",
    slugs: [
      "elektro-sadova-tekhnika",
      "elektropyly",
      "elektrychni-trymery",
    ],
  },
  {
    key: "akumul-instrument",
    name: "Акумуляторний інструмент",
    icon: "🔋",
    slugs: [
      "akumulyatornyy-instrument",
      "akumulyatorni-povitroduvky",
      "akumulyatorni-shurupoverty",
      "akumulyatorni-vykrutky",
      "akumulyatorni-perforatory",
      "akumulyatorni-bolharky-kshm",
      "akumulyatorni-haykoverty",
      "akumulyatorni-tsyrkulyarni-pyly",
      "akumulyatorni-shlifuval-ni-mashynky",
      "akumulyatorni-farbopul-ty",
      "akumulyatorni-lobzyky",
      "akumulyatorni-renovatory",
      "akumulyatorni-shabel-ni-pyly",
      "akumulyatorni-kushchorizy",
      "akumulyatorni-trymery",
      "akumulyatorni-lantsyuhovi-pylky",
      "akumulyatorni-sekatory",
      "akumulyatorni-batareyi-ta-zaryadni-prystroyi",
      "akumulyatornyy-instrument-einhell",
    ],
  },
  {
    key: "ruchnyy-instrument",
    name: "Ручний інструмент",
    icon: "🔧",
    slugs: [
      "ruchnyy-instrument",
      // Викрутки та біти
      "vykrutky-ta-bity", "nabory-vykrutok", "nabory-vykrutok-dlya-tochnykh-robit",
      "bity", "khrestovi-vykrutky", "vykrutka-z-hnuchkym-valom",
      "vykrutky-z-nasadkamy", "vykrutky-z-pryamym-shlitsom",
      "reversyvni-vykrutky", "shestyhranni-vykrutky",
      // Шарнірно-губцевий
      "sharnirno-hubtsevyy-instrument",
      "bokorizy", "dovhohubtsi-ta-tonkohubtsi", "klishchi",
      "kruhlohubtsi", "ploskohubtsi-ta-pasatyzhi", "znimach-stopornykh-kilets",
      // Ключі
      "klyuchi-ta-nabory-klyuchiv", "ruchni-klyuchi-triskachky", "klyuchi-rozvidni",
      // Молотки, сокири
      "udarni-instrumenty-molotky-sokyry-kyyanky",
      "molotky-slyusarni-z-derevyanoyu-ruchkoyu",
      "molotky-slyusarni-z-fiberhlas-ruchkoyu",
      "sokyry-koluny",
      // Ножиці, пили
      "nozhytsi", "nozhnytsi-po-metalu",
      "pyly", "nozhivky-po-derevu", "nozhivky-po-pinobetonu", "nozhivky-po-metalu",
      "ploskohubtsi-bokorizy-ta-shchyptsi",
    ],
  },
  {
    key: "vymiryuvalnyy",
    name: "Вимірювальний інструмент",
    icon: "📏",
    slugs: [
      "vymiryuval-nyy-instrument",
      "ruletky", "rivni-budivel-ni", "riven-lazernyy",
      "shtanhentsyrkuli", "mul-tymetry-i-fazometry",
      "kutnyky-kosyntsi-ta-liniyky", "pravyla", "kosyntsi-i-liniyky",
    ],
  },
  {
    key: "slyusarno-stolyarnyy",
    name: "Слюсарно-столярний інструмент",
    icon: "🪚",
    slugs: [
      "slyusarno-stolyarnyy-instrument",
      "mul-tyinstrument", "nozhivky", "nozhytsi-po-metalu-i-plastyku",
      "obzhymnyy-instrument", "rubanky", "santekhnichni-klyuchi",
      "stamesky", "stuslo", "strubtsyny-ta-leshchata", "shestyhranni-klyuchi",
    ],
  },
  {
    key: "pnevmo",
    name: "Пневмоінструмент",
    icon: "💨",
    slugs: [
      "pnevmoinstrument-ta-obladnannya",
      "povitryani-kompresory",
      // Пневмопістолети
      "pnevmopistolety-ta-aksesuary", "pnevmopistolety-produvni",
      "pnevmatychni-pistolety-dlya-rozpylennya-i-nahnitannya",
      "pnevmatychni-pistolety-dlya-nakachuvannya-shyn",
      "pnevmopistolety-piskostrumenevi",
      "nabory-pnevmatychnoho-instrumentu",
      // Фітинги, манометри
      "fitynhy-dlya-pnevmoinstrumentu", "manometry",
      "ustatkuvannya-dlya-pidhotovky-podachi-povitrya",
      "shlanhy-vysokoho-tysku",
      // Фарбопульти
      "pnevmatychni-farbopul-ty", "aerohrafy",
      "farborozpylyuvachi-hp-i-mp", "farborozpylyuvachi-hvlp", "farborozpylyuvachi-lvmp",
      // Пневмо інструмент
      "pnevmoshlifmashyny", "pnevmohaykoverty", "pnevmodryli",
      "pnevmonozhytsi", "pnevmosteplery", "pnevmoinstrument-einhell",
    ],
  },
  {
    key: "vytratni",
    name: "Витратні матеріали",
    icon: "🔩",
    slugs: [
      "vytratni-materialy",
      // Ріжучо-свердлильний
      "rizhucho-sverdlyl-nyy-instrument",
      // Коронки
      "koronky", "koronky-almazni-po-skli-i-keramitsi",
      "koronky-z-vol-framovym-napylennyam", "koronky-po-betonu",
      "koronky-po-derevu", "koronky-po-metalu",
      "zubyla",
      // Диски
      "dysky-dlya-bolharky-vidrizni-kruhy",
      "plashky-ta-mitchyky", "bury-po-betonu",
      // Щітки
      "shchitky-dlya-metalu", "shchitky-dlya-metalu-neylon",
      "shchitky-dlya-metalu-i-nabory-shchitok",
      "shchitky-dlya-metalu-na-bolharku", "shchitky-dlya-metalu-na-drel",
      "shchitky-po-metalu-konusni-hofrovanyy-drit-latun-dnipro-m",
      "shchitky-po-metalu-dnipro-m",
      // Свердла
      "sverdla", "sverdla-po-betonu", "sverdla-po-metalu",
      "sverla-po-derevu", "sverla-perovi", "sverla-dlya-skla-i-plytky",
      "sverla-trubchasti-z-almaznym-napylennyam",
      "sverdla-po-metalu-skhidchasti", "sverla-po-derevu-spiral-ni",
      "sverla-perovi-po-derevu", "sverdla-po-derevu-dnipro-m",
      "sverdla-po-metalu-sigma", "sverdla-po-metalu-ultra",
      "sverdla-dnipro-m", "nabory-sverdel-po-metalu", "nabory-sverl-po-derevu",
      // Круги
      "kruhy", "klt-kruhy-shlifuval-ni", "kruhy-almazni",
      "kruhy-vidrizni-abrazyvni", "kruhy-vidrizni-almazni",
      "kruhy-vidrizni-i-dlya-zatochuvannya", "kruhy-vidrizni-po-metalu",
      "kruhy-zachysni", "kruhy-zachysni-z-netkanoho-abrazyvu-koral",
      "kruhy-po-metalu", "kruhy-fibrovi-na-lypuchku",
      // Дрібниці
      "stryzhni-kleyovi", "tsvyakhy-plankovi", "skoby-dlya-steplera",
      "zaklepky", "khomuty", "remkomplekty", "zamky",
      "polotno-dlya-lobzyka", "aksesuary-dlya-pylososiv",
    ],
  },
  {
    key: "udarniy-vazhilnyy",
    name: "Ударно-важільний інструмент",
    icon: "🔨",
    slugs: [
      "udarno-vazhil-nyy-instrument",
      "zubyla-i-prosichky", "lomy-ta-tsvyakhodery",
      "molotky-ta-kuvaldy", "sokyry-ta-koluny",
    ],
  },
  {
    key: "yashchyky",
    name: "Ящики та сумки для інструментів",
    icon: "🧰",
    slugs: [
      "yashchyky-y-sumky-dlya-instrumentiv",
      "orhanayzery", "poyasy-kysheni-poyasni-sumky",
      "ryukzak-dlya-instrumentu", "sumky-dlya-instrumentiv",
      "tumby", "yashchyky-dlya-instrumentiv",
    ],
  },
  {
    key: "budivnytstvo",
    name: "Будівельне обладнання",
    icon: "🏗️",
    slugs: [
      "budivel-ne-obladnannya",
      // Кріпильний
      "kripyl-nyy-instrument", "zaklepochnyky",
      "pistolety-dlya-montazhnoyi-piny", "pistolety-dlya-hermetykiv",
      // Будівельна хімія
      "budivel-na-khimiya", "pina-montazhna",
      "pina-profesiyna-pid-pistolet", "pina-ruchna-na-trubochku",
      "pina-kley", "promyvka-dlya-piny",
      // Інше
      "stepler-budivel-nyy", "kleyovi-pistolety-termopistolety",
      "payal-nyky-ta-pal-nyky",
      // Абразивні
      "abrazyvni-instrumenty", "abrazyvna-sitka",
      "dysk-dlya-nazhdachnoho-paperu", "kruhy-zachystni-netkani",
      "pelyustkovi-kruhy", "nazhdachnyy-papir",
      "shchitky-zachysni-dlya-dryliv", "shchitky-po-metalu-ruchni",
      "shlifuval-nyy-blok", "shlifuval-ni-hubky",
      "shlifuval-ni-kameni", "shlifuval-nyy-kruh-na-lypuchtsi",
      // Обладнання
      "promyslovi-obihrivachi", "betonozmishuvachi", "tachky", "drabyny",
    ],
  },
  {
    key: "spetsodyah",
    name: "Спецодяг та засоби захисту",
    icon: "🦺",
    slugs: [
      "spetsodyah-ta-zasoby-zakhystu",
      "rukavychky-zakhysni", "rukavytsi-medychni-lateks",
      "rukavytsi-prohumovani-zalyti", "rukavytsi-kh-b-v-krapku",
      "rukavytsi-dlya-skla", "rukavytsi-zakhysni-dnipro-m", "rukavytsi-zymovi",
      "zasoby-zakhystu-holovy-ta-oblychchya-okulyary-shchytky",
      "masky-zakhysni", "shchytky-i-kasketky", "okulyary-zakhysni",
      "respiratory-ta-fil-try", "spetsodyah",
      "likhtari-nalobni", "navushnyky-protyshumni",
    ],
  },
  {
    key: "malyarskiy",
    name: "Малярський інструмент",
    icon: "🖌️",
    slugs: [
      "malyars-kyy-i-obrobnyy-instrument",
      // Валики
      "valyky-malyars-ki", "valyky-malyarni-velyur", "valyky-malyarni-hirpaint",
      "valyky-malyarni-elitakolor", "valyky-malyarni-mul-tykolor",
      "valyky-malyarni-premium", "valyky-malyarni-synteks",
      "valyky-porolonovi", "valyky-prytyskni-rezynovi",
      "strukturni-valyky", "pryzhymni-hol-chasti-valyky",
      "ruchky-do-valykiv", "vannochky-do-valykiv",
      // Шпателі
      "shpateli", "shpatel-zubchastyy-dlya-plytky",
      "shpatel-nerzh-chorna-ruchka", "shpateli-nerzhaviyuchi-fasadni-profi",
      "shpatel-fasadnyy-profi",
      // Стрічки
      "kleyka-strichka", "streych-plivka", "skotch",
      // Терки
      "terky", "terky-voylochni", "terky-dlya-dekoru",
      "terky-z-hubkoyu-porolonom-prohumovani",
      "terky-nerzhaviyuchi", "terky-pinoplastovi", "terky-plastykovi",
      // Інше
      "nozhi-budivel-no-montazhni", "aerozol-ni-farby",
      "vidra-budivel-ni", "klyny-ta-khrestyky",
      "malyars-ki-penzli", "miksery-budivel-ni",
      "nozhi-budivel-ni", "plytkorizy", "rozmichal-nyy-instrument",
      "budivel-na-strichka-skotch-i-stretch-plivka",
      "sklodomkraty", "budivel-ni-tazy", "sklorizy",
      "tsykly-i-polotna-rashpil-nye-rubanky", "tol-fery",
    ],
  },
  {
    key: "zvaryuvannya",
    name: "Зварювальне обладнання",
    icon: "🔥",
    slugs: [
      "zvaryuval-ne-obladnannya-ta-aksesuary",
      "zvaryuval-ni-aparaty", "invertorni-zvaryuval-ni-aparaty",
      "elektrody-ta-zvaryuval-nyy-drit", "drit-do-p-avt-omidnenyy",
      "maska-zvaryuval-nyka", "masky-khameleony",
    ],
  },
  {
    key: "benzo",
    name: "Бензоінструмент",
    icon: "⛽",
    slugs: [
      "benzoinstrument", "heneratory",
    ],
  },
  {
    key: "sadova-tekhnika",
    name: "Садова техніка",
    icon: "🌳",
    slugs: [
      "sadova-tekhnika",
      "hazonokosylky", "motokosy", "benzopyly", "benzotrymery",
    ],
  },
  {
    key: "sadoviy-instrument",
    name: "Садовий інструмент",
    icon: "🌱",
    slugs: [
      "sadovyy-instrument-ta-rozkhidnyky",
      // Обприскувачі
      "obpryskuvachi", "opryskuvachi-pnevmatychni",
      "opryskuvachi-akumulyatorni", "motoopryskuvachi",
      "zapchastyny-do-obpryskuvachiv",
      // Інструменти
      "sadovi-instrumenty", "hrabli", "vyla",
      "lopaty", "lopaty-bez-ruchky", "lopaty-z-ruchkoyu",
      "derzhaky-dlya-lopat", "saperni-lopaty",
      "sekatory-hilkoruby-nozhytsi-sadovi",
      "nozhytsi-sadovi-zi-shnurkom", "nozhovky-sadovi-vykruzhni",
      // Комплектуючі
      "komplektuyuchi-dlya-sadovoyi-tekhniky",
      "shyny-dlya-latsnyuhovykh-pyl", "lantsyuhy-dlya-pyly",
      "svichky-do-benzopyl",
      // Полив
      "polyv-ta-zroshennya", "pistolety-ta-nasadky-dlya-polyvu",
      "shlanhy-dlya-polyvu",
      // Інше
      "zernodrobarky", "liska-dlya-trymera",
      "nozhi-dysky-kotushky-dlya-trymera", "sadovyy-inventar",
      "systemy-polyvu",
    ],
  },
  {
    key: "avto",
    name: "Автомобільні товари",
    icon: "🚗",
    slugs: [
      "avtomobil-ni-tovary",
      "obladnannya-ta-instrument-dlya-avtoservisu",
      "avtomobil-ni-kompresory", "avtokhimiya",
      // Домкрати
      "hidravlichni-domkraty", "domkraty-hidravlichni-pidkatni",
      "domkraty-hidravlichni-plyashkovi", "domkraty-rombopodibni",
      // Ключі
      "haykovi-klyuchi", "klyuchi-triskachky",
      "lebidky-i-tali", "myyky-vysokoho-tysku", "montuvalky",
      // Набори
      "nabory-instrumentiv", "nabory-haykovykh-klyuchiv",
      "obladnannya-dlya-sto",
      "perekhidnyky-kardany-podovzhuvachi-vorotky",
      "mastyl-ne-obladnannya", "tortsevi-holovky",
      // Догляд
      "dohlyad-za-salonom-ta-kuzovom", "zymovi-shchitky-ta-skrebky",
      // Мастила
      "mastyla-ta-tekhnichni-ridyny", "omyvachi", "olyvy", "mastyla",
      // Аксесуари
      "avtoaksesuary", "rozhaluzhuvachi-prykuryuvachi",
      "puskovi-droty", "buksyruval-ni-trosy",
      "avtomobil-ni-zaryadni-ta-pusko-zaryadni-prystroyi",
    ],
  },
  {
    key: "turyzm",
    name: "Туризм та кемпінг",
    icon: "⛺",
    slugs: [
      "turyzm-ta-kempinh",
      "tovary-dlya-piknika", "kazany", "reshitky", "manhaly",
      "koptyl-ni", "skovorody-turystychni",
      "turystychne-pryladdya", "hazovi-plyty", "hazovi-balony",
      "mul-tytuly",
      "pal-nyky", "pal-nyky-propanovi", "hazovi-pal-nyky",
      "hazovi-plyty-i-komplekty-kempinhovi",
      "likhtari",
      "turystychni-mebli", "turystychni-krisla", "turystychni-stoly",
      "namety", "termosy-ta-termokruzhky", "termosumky",
    ],
  },
  {
    key: "dim",
    name: "Для дому",
    icon: "🏠",
    slugs: [
      "dlya-domu",
      "obihrivachi", "zaryadni-stantsiyi",
      "elektrochaynyky", "ventylyatory", "stabilizatory-napruhy",
    ],
  },
  {
    key: "santekhnika",
    name: "Сантехніка",
    icon: "🚿",
    slugs: [
      "santekhnika",
      "komplektuyuchi-dlya-zmishuvachiv", "liyky-dlya-dushu",
      "shlanhy-dlya-vody", "shlanhy-dlya-dushu", "shlanhy-pidvodky",
      "ruchky-dlya-zmishuvachiv", "vylyv-dlya-zmishuvacha", "kartrydzhi",
      "syfony", "syfony-dlya-dushovoho-piddonu", "syfony-dlya-vanny",
      "syfony-dlya-rakovyny", "syfony-dlya-kukhonnoyi-myyky",
      "donni-klapany", "komplektuyuchi-dlya-syfoniv", "hofry-dlya-syfoniv",
      "zmishuvachi-dlya-vanny", "zmishuvachi-dlya-bide",
      "zmishuvachi-dlya-dusha", "zmishuvachi-dlya-kukhni",
      "zmishuvachi-dlya-umyval-nyka",
      "protochni-vodonahrivachi",
      "dushovi-stiyky-ta-systemy", "aksesuary-dlya-vannoyi-kimnaty",
    ],
  },
  {
    key: "nasosy",
    name: "Насоси та обладнання",
    icon: "💧",
    slugs: [
      "nasosy-ta-nasosne-obladnannya",
      "poverkhnevi-nasosy", "nasosni-stantsiyi", "nasosy-dlya-baseynu",
      "motopompy", "nasosy-napivzahlybni", "drenazhni-nasosy",
      "nasosy-dlya-sverdlovyny", "tsyrkulyatsiyni-nasosy-dlya-opalennya",
      "rozshyryuval-ni-bachky-i-hidroakumulyatory",
      "hidroakumulyatory", "rozshyryuval-ni-bachky",
      "rele-ta-kontrolery", "kanalizatsiyni-nasosni-stantsiyi",
      "fekal-ni-nasosy", "peretvoryuvach-chastoty-dlya-nasosa",
      "promyslovi-nasosy",
    ],
  },
  {
    key: "einhell",
    name: "Інструмент Einhell",
    icon: "🔴",
    slugs: ["instrument-einhell"],
  },
  {
    key: "grosser",
    name: "Інструмент Grösser",
    icon: "🔵",
    slugs: ["instrument-grosser"],
  },
];

/** Quick lookup: slug → group key */
export const SLUG_TO_GROUP = new Map<string, string>();
for (const g of CATEGORY_GROUPS) {
  for (const slug of g.slugs) {
    SLUG_TO_GROUP.set(slug, g.key);
  }
}

/** Get group by key */
export function getCategoryGroup(key: string): CategoryGroup | undefined {
  return CATEGORY_GROUPS.find((g) => g.key === key);
}
