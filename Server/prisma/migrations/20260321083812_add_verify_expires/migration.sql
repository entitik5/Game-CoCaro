/*
  Warnings:

  - You are about to alter the column `verifyToken` on the `user` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(10)`.
  - You are about to alter the column `resetToken` on the `user` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(10)`.

*/
-- AlterTable
ALTER TABLE `user` ADD COLUMN `verifyExpires` DATETIME(3) NULL,
    MODIFY `verifyToken` VARCHAR(10) NULL,
    MODIFY `resetToken` VARCHAR(10) NULL;
