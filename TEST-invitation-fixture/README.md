# TEST invitation revocation fixture

Synthetic, local-only acceptance for “Revoke Invitation” (PRD version 3).
No product imports, services, authentication, or persistence are changed.

Run `node --test TEST-invitation-fixture/invitations.test.mjs`.
The tests start isolated HTTP servers bound to loopback on ephemeral ports.

Each fixture starts with one pending TEST invitation. An admin dashboard at
`/TEST/dashboard` lists it and provides a Revoke invitation button wired to
DELETE `/TEST/admin/invitations/TEST-invite`. Dashboard requests require the
synthetic `Authorization: Bearer TEST-admin-session` header, supplied by the
local test client. Recipient access is `/TEST/invitations/TEST-recipient-token`.
Revocation removes the pending row and makes the recipient URL return 404.
All state disappears when the fixture stops; each instance starts independently.
The fixed synthetic credential is for this fixture only.

Tests exercise the HTTP dashboard response and its DELETE endpoint, recipient
invalidation, unauthorized access, repeat revocation, and unknown routes/methods.
They do not claim a browser automation run or product invitation implementation.
