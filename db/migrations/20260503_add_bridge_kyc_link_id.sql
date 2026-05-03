-- Track the Bridge KYC link id per employee so we can resolve the
-- `kyc_link.completed` webhook back to the right employee row.
-- The Bridge customer record is created server-side after KYC completion;
-- bridge_customer_id is filled in by the webhook handler at that point.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bridge_kyc_link_id text;

CREATE INDEX IF NOT EXISTS idx_employees_bridge_kyc_link_id
  ON employees (bridge_kyc_link_id)
  WHERE bridge_kyc_link_id IS NOT NULL;
