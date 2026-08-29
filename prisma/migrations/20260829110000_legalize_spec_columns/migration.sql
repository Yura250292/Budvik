-- Легалізація колонок характеристик, що з'явились повз історію міграцій.
--
-- powerWatts, rpm, discDiameterMm, chuckMm, toolType і weightKg стоять у
-- schema.prisma і є в бойовій базі, але жодна міграція їх не створює: колись
-- їх залили через `prisma db push`. На проді це непомітно, а от чиста база,
-- піднята через `migrate deploy`, лишалась без них — і перша ж міграція, що
-- на них спирається (сусідня _product_attribute_facets), падала.
--
-- IF NOT EXISTS робить файл порожньою дією там, де колонки вже є, і
-- повноцінним створенням там, де їх немає. Типи звірені з бойовою базою
-- через information_schema, щоб легалізація не переписала наявне.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "powerWatts" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "rpm" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "discDiameterMm" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "chuckMm" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "toolType" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "weightKg" DOUBLE PRECISION;
