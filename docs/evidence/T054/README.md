# T054 keyboard and accessibility

The Mac test seeds a disposable product with an approved PRD and linked backlog drafts. It reaches controls using Tab and activates them with the keyboard. The test covers the primary routes, the local stakeholder draft, exact-content review and PDF export, browser inspector, terminal dock and portfolio switcher in the default, Navy Gold and Navy Cyan themes.

The populated-screen scan found a serious axe violation in all three themes. The inspector tab list included the Close button as a direct child. Moving Close beside the tab list retained keyboard access and cleared the violation. All three source-app runs passed. The existing development gallery and three-theme packaged drawer checks also passed.

These tests cover local navigation and export. The full section 6 keyboard golden path, including governed publication, sprint commitment, crew reattachment, PR merge, acceptance and Notion publication in sequence, remains open.

The rebuilt packaged Mac app also passed all three theme journeys with zero serious or critical axe findings on the 16 scanned views per theme. The separate packaged reminder restart check passed alongside them. The workspace check passed lint, type checking, 506 unit tests and formatting.
