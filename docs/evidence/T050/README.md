# T050 tasks and reminders

The initial service test found no scheduled task. The completed test advances time past the due date and opens a new service over the same database. Overdue consequential work creates one notification and one governed review request. Repeated wake checks leave the outbox empty.

The Mac Electron journey scheduled a consequential work reminder through the UI, exercised the production power-monitor resume listener twice with an overdue timestamp, checked one missed notification and approved completion in the task view. The Mac remained awake during this controlled resume test. An early UI run left the notification drawer covering the completion button. The final journey closed the drawer and passed.
