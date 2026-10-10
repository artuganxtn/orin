# ORIN Support / AI Support administration

Routes are under `/admin/support-ai`, with server reads through `/api/control/support-ai` and audited commands through `/api/control/action`. This section uses the existing ORIN admin identity, active staff record, RBAC, recent authentication and transaction-time custom-session checks. No production configuration was mutated during implementation.

Sections: runtime/provider/model configuration, reviewed knowledge, support conversations, escalated tickets, daily usage, and bounded diagnostic errors. Runtime readiness performs an actual provider model-availability request cached for 30 seconds; it does not imply a generated answer has passed an end-to-end test. A disabled setting remains disabled even if a provider secret exists.

Provider credentials and endpoint allowlists exist exclusively in server environment / Secret Manager. The dashboard receives booleans about configured credentials and constrained provider/model settings; it never receives API keys or endpoint values. Configuration accepts only the shared schema in `lib/support-ai-control.ts`. Daily budget is bounded to 1,000–1,000,000 tokens, reply budget to 128–2,048 tokens, and style guidance to 1,500 characters. The inference service enforces the budget atomically. Style guidance is supplied as lower-priority untrusted data; immutable scope/security rules are not editable.

Permissions:

- `support.ai.read`: support, operations, content manager, auditor, super admin.
- `support.ai.configure`: super admin only by default.
- `support.knowledge.manage` / `support.knowledge.publish`: content manager and super admin.
- Conversation/ticket content additionally requires `tickets.read`.
- Explicit automated-reply resumption requires `tickets.manage`, plus either assignment to the staff member or `tickets.assign` when a different agent owns the ticket.

Knowledge is stored in `orinSupportKnowledge/{id}`. Saving always creates a draft and clears its reviewed flag. Publishing requires the current revision and explicit review confirmation. Editing a published document does not leave an unreviewed revision available to the model. Updates are revision-checked, idempotent and audited. Audit records include content/guidance hashes and metadata, not document bodies or provider credentials.

Configuration is stored in `orinSupportConfiguration/current`. Enabling requires server provider configuration; browser toggles cannot manufacture availability. Readiness failure is shown honestly. There is no client direct-write path to configuration, knowledge, usage, diagnostic or escalation records; they remain denied by default Firestore rules and are accessed through trusted server authorization.

Conversations use `orinSupportConversations`; this AI administration view redacts known credential formats before displaying text. Viewing a conversation is audited. Lists and knowledge/ticket cursors are scoped; older chat messages are paginated. Customer-visible staff replies remain in the existing support desk, separate from private ticket notes.

Escalations use `orinControlTickets` with `source:'orin-ai'` and `conversationId`, and `orinSupportEscalations/{uid}` maps the current ticket. Human takeover remains active even after opening a thread. The explicit resume action checks the mapped ticket is resolved/closed and belongs to the same conversation, then changes `handoffRequested` atomically with an audit entry. It never marks an unresolved request handled.

Usage comes from `orinSupportUsage/{UTC-day}`. Measured token totals, conservative budget debits for unknown provider usage, pending reservations and failures are distinct. Errors come from `orinSupportErrors`, projecting only code/time/provider/model. Empty collections are shown as empty, never fabricated traffic or connection status.

Verification: seven real Firestore-emulator tests passed for RBAC/recent auth, config constraints, approval/revision workflow, concurrent idempotency, revoked sessions, redacted conversation views and safe resumption, and pagination. Tests assert a demo project and emulator host to prevent production writes. Run `scripts/test-support-admin.sh` inside `firebase emulators:exec --project demo-orin-support-admin-160 ...`. No physical-device/UI/provider production end-to-end acceptance is claimed by these tests.
