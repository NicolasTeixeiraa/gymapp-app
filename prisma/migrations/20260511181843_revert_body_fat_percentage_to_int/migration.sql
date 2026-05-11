/*
  Warnings:

  - You are about to alter the column `bodyFatPercentage` on the `user` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "user" ALTER COLUMN "bodyFatPercentage" SET DATA TYPE INTEGER;
