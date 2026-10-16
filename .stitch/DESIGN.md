# Design System: FlowSync / Focus Workspace

**Project ID:** 1147826556671896586  
**Stitch design system:** assets/3390103566712004395

## 1. Visual Theme & Atmosphere

A calm, precise team workspace that puts current work ahead of configuration.
Use a persistent navigation rail, clear page headings, aligned task metadata,
and progressive disclosure for administration. All production content comes
from the existing authenticated API; design examples are references only.

## 2. Color Palette & Roles

- Focus violet (`#5b4ce2`): primary actions, selected navigation, focus rings.
- Cool canvas (`#f7f8fa`): application background.
- White (`#ffffff`): navigation, panels, dialogs, and controls.
- Ink (`#202330`): headings and primary content.
- Slate (`#687083`): supporting text and secondary controls.
- Hairline (`#e8eaf0`): panel boundaries and row separators.
- Mint, amber, and rose: success, upcoming deadlines, and overdue work.
- Dark mode maps semantic tokens to dark surfaces with readable foregrounds.

## 3. Typography Rules

Inter with system sans-serif fallbacks. Page titles are 30–32px, semibold,
with compact tracking. Body text is 14px; supporting metadata is 12px.
Use sentence case for human-readable statuses. Small uppercase labels belong
only to navigation groups and table headings.

## 4. Component Stylings

- **Buttons:** compact, gently rounded, minimum 40px height; touch controls 44px.
- **Panels:** white surfaces, 12px corners, subtle borders and restrained shadows.
- **Inputs:** clear persistent labels, visible focus rings and validation feedback.
- **Tasks:** title first, followed by project, status, priority, and deadline.
- **Boards:** distinct column status dots, count pills, spacious task cards,
  visible drag handles, keyboard sorting, and a horizontal scroll boundary.
- **Administration:** contextual tabs and collapsible settings keep work visible.
- **Empty states:** explain the next available action with a working destination.

## 5. Layout Principles

The desktop sidebar is approximately 248px wide. The toolbar remains consistent
on overview, organizations, workspaces, projects, and boards. Content uses 24–32px
gutters with a wide task area and a narrower progress/activity column. On mobile,
navigation becomes an accessible drawer and content stacks without page overflow.
The account menu and home link remain available throughout the app.

## Implementation constraints

Preserve Next.js routing, authentication, authorization, API contracts, realtime
updates, task deep links, forms, drag/drop, optimistic rollback, and dark mode.
Use shared semantic CSS tokens rather than copying standalone Stitch markup.
