/*
  Warnings:

  - You are about to drop the column `facebookId` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `googleId` on the `user` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `User_facebookId_key` ON `user`;

-- DropIndex
DROP INDEX `User_googleId_key` ON `user`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `facebookId`,
    DROP COLUMN `googleId`;
