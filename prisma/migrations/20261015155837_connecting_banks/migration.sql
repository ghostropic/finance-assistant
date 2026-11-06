-- Milestone 3: connecting banks (docs/milestone-3.md).
-- Every bank connected before this migration came from Plaid Sandbox, so existing
-- rows get 'sandbox'. The default is then dropped: new rows must say which
-- environment they belong to.
ALTER TABLE "plaid_items" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'sandbox',
ADD COLUMN     "institution_id" TEXT,
ADD COLUMN     "last_error_code" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE "plaid_items" ALTER COLUMN "environment" DROP DEFAULT;
