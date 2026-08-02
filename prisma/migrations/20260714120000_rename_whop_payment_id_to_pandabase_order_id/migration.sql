-- Rename Whop payment reference to Pandabase order reference on steam account orders.

ALTER TABLE "steam_account_orders" RENAME COLUMN "whopPaymentId" TO "pandabaseOrderId";

ALTER INDEX "steam_account_orders_whopPaymentId_key" RENAME TO "steam_account_orders_pandabaseOrderId_key";
