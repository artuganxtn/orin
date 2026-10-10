# ORIN Admin 1.4.0 — review source, 2026-10-04

This extends the existing Control Center; it does not replace the customer application or activate production services. Version name is `1.4.0-preview`, intended Android versionCode `7`. No APK was produced for this checkpoint.

## Added

- Support desk at `/admin/tickets`: customer-linked internal tickets, category, four priorities, optional explicit follow-up date, five lifecycle states, and revision-checked updates.
- Support agents can claim unassigned tickets, release their own assignment, and update their own or unassigned tickets. Operations and Super Admin can route tickets to another active eligible staff member. A support agent cannot take another agent's ticket. Auditors are read-only. Finance and customer identities cannot access tickets.
- Internal notes are append-only documents with author and timestamp, paginated in the drawer. Idempotent command retries cannot add duplicate notes or audit events. There is no edit/delete note endpoint or customer messaging integration. Notes contain no attachments; do not use them as a KYC document store.
- Dashboard work queues count open support tickets, the current agent's tickets, overdue tickets, KYC requests, financial approvals and pending withdrawals, filtered by the viewer's permissions. Missing counts display unavailable rather than zero. Queue links open the corresponding section; the overdue card is a count, not an overdue-only list filter. Tickets carry an overdue indicator in the table.
- Server-side audit filters by inclusive local-calendar date range, exact actor, action and target. Newest-first pagination uses timestamp plus document ID to handle ties. Cursors are bound to the active query. Exports use the same filters and export only one permitted page; each export is audited and requires recent authentication.
- Ticket lists support server-side status, priority and assignment filters. Previous-page navigation supplements next/start navigation. Text search outside Users remains limited to the displayed page and is labeled accordingly.
- The same React administration component powers the offline HTML preview. Creating/updating tickets and adding notes changes isolated in-memory review fixtures only. Reloading resets them. Role switching demonstrates permissions and the preview has a CSP that denies network connections. It is not a staging backend or production application.

## Permissions and persistence

There are now 22 modules, eight roles and 31 permissions. The new `tickets.read`, `tickets.manage`, and `tickets.assign` permissions are in `lib/control-center.ts`. Review the updated `firebase-control/permissions.json` and supplied permissions HTML.

Ticket records: `orinControlTickets/{ticketId}`. Notes: `orinControlTickets/{ticketId}/notes/{requestId}`. These and audit records remain entirely server-owned; direct client reads/writes/deletes are denied by both included rule candidates, including for the owner and Super Admin. Ticket mutations go through the existing verified staff API and create audit records atomically. Ticket descriptions and note bodies are not duplicated into the audit stream.

No production data, roles, hosting, rules, notifications, billing, customer balance or financial feature flag was changed. Existing two-person financial approvals and all provider activation gates remain in force.

## Activation prerequisites

Follow `firebase-control/DEPLOYMENT.md` first. Provision the trusted backend and stage the reviewed rules before connecting the frontend. The new query indexes in `firebase-control/firestore.indexes.json` must be deployed and ready in staging before testing compound ticket/audit filters; emulator tests do not prove production index readiness. Apply these indexes using the Control Center config, not the older Spark config. Do not upgrade Spark billing, replace stable hosting, create a production administrator, or enable provider integrations without the owner's existing review/approval process.

The internal ticket workflow does not send email, WhatsApp, Push or a customer reply. Follow-up dates are agent-selected reminders shown in the dashboard and table; no automatic SLA commitment or external escalation is implemented. Real providers, production telemetry, historical report jobs and private KYC intake still require the integrations listed in the previous checkpoint.

## Verification

Use Node 22+ and Java 21+ for Firebase emulator tests; Android compilation uses the JDK documented in the Android README. Dependencies remain pinned by the existing lockfiles.

See `ORIN-Admin-1.4.0-Verification.json` and included execution logs for actual results. Tests cover server authorization, assignment rules, state transitions, stale revisions, duplicate/concurrent notes, query pagination with tied timestamps, inclusive dates, exports, server-only rules, preview behavior and previous application regressions. TypeScript, web build and server build are checked.

No live browser visual test, physical Android test, production deployment or real provider test was run. The previous browser preview restriction remains in force and was not bypassed.

## Android and reproducibility

The authorized existing signing backup was restored outside the deliverable and its SHA-256 certificate matches `743a8d0179b768419931be6be205644d49509eaf0a90fe90b7b98950f5f66f02`. The key and password are excluded from the source package. The official pinned Android SDK archives are absent; a download attempt could not establish the proxy connection, and `android-app/build.py` correctly refused to build. No replacement key was generated. The old 1.3.1 APK must not be labeled as 1.4.0.

Restore the original signing files locally, install the SDK documented in `android-app/README.md`, build the tested Spark web bundle, then run the Android builder and verify the signature, alignment, version and assets. Check that versionCode 7 has not been used by another distributed build before distributing this version. Keep backend activation gated until staging succeeds.

This package restores the source `build/` plugin files that were omitted by the previous archive's broad directory exclusion. `build/` here contains necessary source code; only Android's generated `android-app/build/` must be excluded. Dependencies and SDK remain reproducible external prerequisites.

Primary implementation references: https://firebase.google.com/docs/firestore/query-data/query-cursors and https://firebase.google.com/docs/firestore/query-data/index-overview .
