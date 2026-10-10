# Invoice Detail navigation — 10 October 2026

Invoice Detail was registered at `/billing/invoice` but absent from the staff dashboard and sidebar, requiring users to enter the URL manually. Added **Billing → Invoice Detail** to `AppShell` using its existing shadcn navigation primitives and a matching **Invoice Detail** button under the dashboard's Available tools.

Both surfaces use `canViewStaffPage`. The new route permission matches current invoice read access for the six staff roles: FRONT_DESK, SERVICE_STAFF and BRANCH_MANAGER within their branch, and CHAIN_MANAGER, SYSTEM_ADMINISTRATOR and AUDITOR chain-wide. Each API request still enforces booking scope. Guest invoice access remains in the account flow. No additional permission, financial contract, page layout or database change was introduced.

Verification: `node --import tsx --test frontend/tests/staffNavigation.test.ts frontend/tests/m4InvoiceUi.test.ts` passed 6/6 existing checks; `npm run build --workspace frontend` passed, with the existing Vite bundle-size warning. SRS §4.7 and M4-S13 were rechecked. Manual sidebar/dashboard click-through is pending the user's next test step. No additional task checklist rows were changed.

Proposed commit: `fix(navigation): link invoice detail from sidebar and dashboard`

Proposed PR title: `Make Invoice Detail accessible from staff navigation`

Proposed PR description:

Staff had to enter the Invoice Detail URL manually because the registered page had no navigation entry. Add a Billing sidebar link and dashboard button to the existing page, filtered through the shared staff role rules to match current invoice-read authorization.

Verified with six existing navigation/invoice UI checks and the frontend production build. Billing behavior and API authorization are unchanged; manual click-through remains the next acceptance check.
