// OpenCode loads these plugins. The host package is not a dependency of the CLI,
// so only the hooks our plugins use are declared.
declare module '@opencode-ai/plugin' {
  type ProviderConfig = {
    options?: Record<string, unknown> & { fetch?: typeof fetch };
  };
  export type Plugin = () => Promise<{
    'experimental.session.compacting'?: (input: {
      sessionID: string;
    }) => Promise<void>;
    event?: (args: { event: { type: string } }) => Promise<void>;
    config?: (config: {
      provider?: Record<string, ProviderConfig>;
    }) => Promise<void>;
  }>;
}
