-- CreateEnum
CREATE TYPE "WholesaleApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('PRODUCTION', 'SHOP', 'SUBDISTRIBUTOR', 'MARKET_POINT', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'WHOLESALE';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isPromo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promoLabel" TEXT,
ADD COLUMN     "promoPrice" DOUBLE PRECISION,
ADD COLUMN     "wholesalePrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "WholesaleCompany" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleBrandDiscount" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleBrandDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "legalName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "status" "WholesaleApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleBrandDiscount_brand_key" ON "WholesaleBrandDiscount"("brand");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "WholesaleCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleApplication" ADD CONSTRAINT "WholesaleApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleApplication" ADD CONSTRAINT "WholesaleApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "WholesaleCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
