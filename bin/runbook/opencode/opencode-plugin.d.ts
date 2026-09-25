// OpenCode loads this plugin. The host package is not a dependency of the CLI.
declare module '@opencode-ai/plugin' {
  export type Plugin = () => Promise<{
    'experimental.session.compacting': (input: {
      sessionID: string;
    }) => Promise<void>;
    event: (args: { event: { type: string } }) => Promise<void>;
  }>;
}
