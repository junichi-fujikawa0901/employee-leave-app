-- spec.md 7.2: annual_auto grants are unique per user and granted_date; special grants may repeat.
CREATE UNIQUE INDEX "leave_grants_annual_auto_user_id_granted_date_key"
ON "leave_grants"("user_id", "granted_date")
WHERE "grant_type" = 'annual_auto';

-- spec.md 4.3 / 6: active requests cannot duplicate the same day and unit.
-- Cancelled/rejected history remains repeatable for audit/history purposes.
CREATE UNIQUE INDEX "leave_requests_active_user_id_target_date_unit_key"
ON "leave_requests"("user_id", "target_date", "unit")
WHERE "status" IN ('pending', 'approved');
