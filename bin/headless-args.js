const SUBC_VALUE_FLAGS = new Set(['--model', '-p', '--profile']);
const SUBC_INLINE_FLAGS = ['--model=', '--profile='];

/**
 * Index of the headless prompt when `argv` (the words after the agent name)
 * asks for a headless run, otherwise -1. Only subc's own flags may come
 * before "headless"; later on it is an ordinary agent argument.
 */
export function headlessPromptIndex(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (SUBC_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (SUBC_INLINE_FLAGS.some((prefix) => arg.startsWith(prefix))) continue;
    return arg === 'headless' ? i + 1 : -1;
  }
  return -1;
}

/** Index of the first "--" separator; a headless prompt of "--" is not one. */
export function separatorIndex(argv) {
  const prompt = headlessPromptIndex(argv);
  return argv.findIndex((arg, index) => arg === '--' && index !== prompt);
}
