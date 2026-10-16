// Interface copy only. Projects, tasks, people, and metrics come from the API.
export const workspaceCopy = {
  navigation: 'Workspace navigation',
  overview: 'Overview',
  tasks: 'My tasks',
  organizations: 'Organizations',
  projects: 'RECENT PROJECTS',
  account: 'Personal workspace',
  accountDescription: 'Your work, in one place',
  emptyProjects: 'Your recent projects will appear here.',
  teamTitle: 'Better work, together',
  teamDescription: 'Find your team and make your next idea happen.',
  browseTeams: 'Browse teams',
  signOut: 'Sign out',
  loading: 'Loading your workspace',
  unavailable: 'We couldn’t reach your workspace',
  retryDescription: 'Check your connection and try again.',
  retry: 'Try again',
  skip: 'Skip to content',
};
export const dashboardCopy = {
  eyebrow: 'YOUR WORK, AT A GLANCE',
  description: 'A little clarity for everything you’re moving forward.',
  taskDescription: 'Your next steps, all in one place.',
  emptyTasks: 'You’re all caught up',
  emptyTasksDescription:
    'Assigned tasks will appear here. Try another filter or explore your team’s projects.',
  emptyProjects: 'Make room for your next project',
  emptyProjectsDescription:
    'Open an organization to find your workspace and start something together.',
  emptyActivity: 'Your team’s story starts here',
  emptyActivityDescription: 'Project and task updates will appear as your team gets to work.',
  metrics: [
    {
      key: 'activeProjects',
      label: 'Active projects',
      caption: 'Moving ideas forward',
      tone: 'primary',
    },
    { key: 'openTasks', label: 'Open tasks', caption: 'Across your projects', tone: 'success' },
    { key: 'dueSoon', label: 'Due in 7 days', caption: 'Coming up next', tone: 'warning' },
    { key: 'overdue', label: 'Overdue tasks', caption: 'A little extra attention', tone: 'danger' },
  ] as const,
  deadlines: [
    { value: 'all', label: 'All deadlines' },
    { value: 'soon', label: 'Due soon' },
    { value: 'overdue', label: 'Overdue' },
  ] as const,
};
export const authCopy = {
  eyebrow: 'A LITTLE LESS CHAOS. A LOT MORE FLOW.',
  headline: ['Less busywork.', 'More possibility.'],
  description: 'One shared space for your team, projects, and everything you’re moving forward.',
  footer: 'Together, in flow.',
  previewTitle: 'Your next great project',
  previewLabel: 'A GLIMPSE OF YOUR WORKSPACE',
  previewTasks: [
    'Bring your best ideas together',
    'Make the next step clear',
    'Celebrate the small wins',
  ],
};
