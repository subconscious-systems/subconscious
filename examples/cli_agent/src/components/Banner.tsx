// The startup banner. Two accent colors, one short title, the essentials below.
// Keep it tasteful — judges and DevRel decks see this frame first.

import { Box, Text } from "ink";

export interface BannerProps {
  model: string;
  toolCount: number;
  serverCount: number;
}

export function Banner({ model, toolCount, serverCount }: BannerProps) {
  const toolsLine =
    serverCount > 0
      ? `${toolCount} from ${serverCount} mcp server${serverCount === 1 ? "" : "s"}`
      : "none connected";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="cyan" bold>
          sub
        </Text>
        <Text color="magenta"> · subconscious agent</Text>
      </Text>
      <Text dimColor>─────────────────────────────</Text>
      <Text>
        <Text dimColor>model: </Text>
        {model}
      </Text>
      <Text>
        <Text dimColor>tools: </Text>
        {toolsLine}
      </Text>
      <Text dimColor>shortcuts: /tools /clear /help /exit</Text>
    </Box>
  );
}
