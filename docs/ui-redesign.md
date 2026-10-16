# FlowSync interface redesign

The app now uses a shared workspace shell across overview, organizations,
workspaces, projects, and Kanban boards. The dashboard puts assigned work first;
project management separates overview, members, the assistant, and settings into
keyboard-accessible tabs. Board navigation is horizontal, administration sits
below the task canvas, and task details open in a full-height drawer.

Authentication uses the same visual system, with inline validation, password
visibility controls, and a focused mobile layout. Global search is discoverable
in the toolbar and opens with Ctrl/Cmd+K. Mobile navigation traps focus, closes
with Escape, and returns focus to its trigger. Theme changes apply atomically.

## Stitch sources

Project: `1147826556671896586`; design system: `assets/3390103566712004395`.

| Screen   | Screen ID                          | Local reference                                                                    |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Overview | `901a6e6a09c34a4dbf9dade0e7956d80` | [HTML](../.stitch/designs/overview.html), [image](../.stitch/designs/overview.png) |
| Kanban   | `6ed954fcd97f4297aa37f08fd2fa43e1` | [HTML](../.stitch/designs/kanban.html), [image](../.stitch/designs/kanban.png)     |
| Sign in  | `caebe691d8514fce8aa1345dd8b7af67` | [HTML](../.stitch/designs/auth.html), [image](../.stitch/designs/auth.png)         |

All three references were retrieved through Stitch MCP and visually reviewed.
The implementation adapts their layout to the existing Next.js app, live API,
permissions, and supported features. Reference-only reports, billing, export,
and automation controls are omitted. Production data is never replaced with
the sample content from the designs.

[Design guidelines](../.stitch/DESIGN.md),
[sync metadata](../.stitch/metadata.json), and
[extracted design tokens](../apps/web/resources/style-guide.json) are checked in.
Canvas positions are null because the project response did not expose them.
Inter is served locally with its OFL license; no remote fonts are needed at runtime.

## Validation

The production build, repository lint, formatting checks, and all 12 browser tests
pass. Browser coverage runs against the
production frontend and real local PostgreSQL, Redis, MinIO, Mailpit, and API.
It exercises authentication, CRUD, access control, invitations, attachments,
comments, notifications, realtime collaboration, pointer/keyboard sorting,
optimistic rollback, and AI task confirmation. AI inference itself remains a
deterministic test fixture; these checks do not validate a live model provider.

The additional workspace checks cover populated dashboard pagination, deadline
and priority filters, search, task deep links, drawer placement, keyboard tabs,
mobile focus handling, theme rendering, and authentication error states.
Saving a task on a board also verifies that the sidebar does not refetch dashboard
aggregates. Other pages read cached recent-project shortcuts; the overview owns
their refresh.

## Application screenshots

- [Populated overview](screenshots/dashboard-populated.png)
- [Dark overview](screenshots/dashboard-populated-dark.png)
- [Kanban](screenshots/kanban.png)
- [Task drawer](screenshots/task-drawer.png)
- [Mobile project overview](screenshots/project-overview-mobile.png)
- [Sign in](screenshots/login.png)
- [Mobile sign-in error](screenshots/login-mobile.png)

The redesign is implemented and pushed to `main` in incremental commits. Public
deployment is a separate operation.
