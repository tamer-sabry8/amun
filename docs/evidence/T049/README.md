# T049 selected-field Notion sync

On the arm64 Mac, a synthetic product memory text field was mapped to a named line in the approved M5 Document Hub test page. The external edit added the approved Draft value. Amun independently fetched it, saved a baseline, retained the local edit to Reviewed, displayed the outgoing difference and applied the second approved edit. Read-back returned Reviewed. A separate read verified the original fixture and publication ID were still present.

The first live read exposed Notion's inline line-break encoding. A failing regression reproduced the adjacent footer being included in the field. The corrected parser isolated the field, and the live journey then passed. The domain tests started red for missing three-way comparison. SQLite tests cover divergent edits, incoming/outgoing resolution, lost access, offline retention, a missing mapped field, stale or foreign reviews, and deletion or unlink. Loss of access is represented as unavailable and leaves local data intact.

The Electron journey opened a disposable database with a conflict, displayed both values, saved a local edit, restarted the app, unlinked and restarted again. Revocation and deletion scenarios used controlled provider outcomes. The working grant stayed active.

After the live edit, the outgoing path gained a durable write action and a conditional match that includes the following text line. The final connector read the same live page and verified the reviewed value and adjacent publication footer. The approved write was not repeated. A last-line field without a following text anchor cannot be sent through this conditional update.

A controlled connection drop after applying an outgoing edit left the write unconfirmed. Another publish was refused. A fresh service read reconciled the one recorded write to succeeded. Separate thrown permission and network errors preserved the local edit and its prior baseline.
