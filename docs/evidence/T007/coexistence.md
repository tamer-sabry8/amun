# Existing-installation coexistence foundation

User scenario: Herdr starts Pi; Pi automatically loads Firstmate. Work stays in M0/T007, with T008 reattachment still open.

Implemented `packages/crew/src/existing-setup.ts`: read-only bounded metadata discovery, version inventory, conservative PID observation and canonical state-path separation. It does not invoke installed tools, read authentication files, modify configuration, acquire locks or launch sessions.

TDD evidence:

- `coexistence-red.log`: six failing inventory/isolation tests before implementation.
- `coexistence-green.log`: those six tests pass.
- `discovery-red.log`: executable-link discovery fails before implementation.
- `discovery-green.log`: nine inventory/discovery tests pass.
- `state-alias-red.log`: redirected state directory incorrectly appeared live.
- `state-alias-green.log`: all eleven tests pass after rejecting an escaping state directory; also checks generic malformed-metadata errors.

Fixtures include a credential canary, a live test-process PID, newer package metadata, executable links and shell-wrapper text. These are synthetic fixtures on Linux; no claim is made that the user's actual Mac installation has been inspected. Runtime and onboarding integration, Firstmate code compatibility, explicit authentication reuse, and actual Herdr session attachment remain unverified. See ADR-005 for the first-install acceptance checklist.
