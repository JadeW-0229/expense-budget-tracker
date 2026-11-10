# Cloud release

The user has authorized an independent GitHub repository and Supabase project.
Target repository: JadeW-0229/expense-budget-tracker.
Target Supabase URL: https://dixtljbocpdjrgczbqjr.supabase.co.
Never modify the existing reimbursement guide project.
Keep the local MVP outside this directory unchanged.
Never commit private-import, source spreadsheets, browser ledgers, credentials,
or Supabase service_role keys. Cloud release must not fall back to local data.
Use authenticated database writes with transaction locking and budget checks.
Run npm test and npm run build before publication. Report remote actions honestly.
