-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('COMPANY', 'PERSONAL');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "ownership" "VehicleOwnership" NOT NULL DEFAULT 'COMPANY',
ALTER COLUMN "plate" DROP NOT NULL;

