# Beneficiary export privacy

## Export policy

- Export actions require an authenticated authorization context with `canExport`.
- Exports default to public and operational fields only.
- Personal fields require an admin/auditor role, an explicit confirmation in the export UI, and a verified consent record reference supplied by the trusted application session.
- Fields classified as sensitive are never included by the export helper.
- The export helper awaits the audit callback before creating the downloadable file. The callback must persist actor, role, format, row count, exported field names, timestamp, and consent reference to a trusted server-side audit log.

## Integration contract

The host application must construct `ExportAuthorization` from its authenticated session and verified consent service. Connect `auditExport` to an authenticated backend endpoint that durably records the event and rejects failed writes. Do not use a local-only callback or values supplied by the browser as the source of truth for authorization, identity, or consent.

Every `ExportField` must declare a classification. Prefer an allowlist of fields needed for the stated reporting purpose; do not pass full beneficiary objects or include identity, contact, medical, or recovery details unless there is a documented lawful basis and verified consent.

## Important on-chain limitation

A browser export guard does not make blockchain state private. Public Soroban ledger data can be read outside this UI. Do not write beneficiary names, contact details, medical needs, or other directly identifying personal information to public contract storage. Use pseudonymous identifiers and keep the identity mapping in a separately protected off-chain service.
