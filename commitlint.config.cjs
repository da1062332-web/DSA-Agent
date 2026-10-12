// Conventional Commits with the task ID, e.g. `feat(leads): TASK-107 create lead with routing` (Contracts §14).
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
  },
};
