// Variables that point git at another repository or index, as inside a git hook. The Lab may inherit them from
// whatever launched it; its own git calls and the agents it starts in a worktree must never follow them.
const GIT_LOCATION = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX)$/i;

export const withoutGitLocation = env => Object.fromEntries(Object.entries(env).filter(([key]) => !GIT_LOCATION.test(key)));

/** The environment for the Lab's own git calls: no location variables, no credential prompt. */
export const gitEnv = (extra = {}) => ({ ...withoutGitLocation(process.env), GIT_TERMINAL_PROMPT: '0', ...extra });
