// Export jobs move from queued to rendering and end as done, failed or cancelled.
export const TERMINAL_JOB_STATES = ['done', 'failed', 'cancelled'];
export const isTerminalJobState = state => TERMINAL_JOB_STATES.includes(state);
export const RESTART_MESSAGE = 'The editor restarted during export. Export again.';
export const CANCELLED_MESSAGE = 'Export cancelled.';
