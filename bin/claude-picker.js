// The env claudeModelPickerEnv sets, described for readers that cannot run it.
export const CLAUDE_PICKER_ENV_DESCRIPTION = [
  ...['OPUS', 'SONNET', 'HAIKU', 'FABLE'].flatMap((role, index) => {
    const alias = role.toLowerCase();
    return [
      {
        name: `ANTHROPIC_DEFAULT_${role}_MODEL`,
        value: `{catalog[${index}]}`,
        override: [`ANTHROPIC_DEFAULT_${role}_MODEL`],
        description: `Model behind the ${alias} alias. Set from the catalog, padded to four entries; a profile or environment value is kept only when it is in the live catalog.`,
      },
      {
        name: `ANTHROPIC_DEFAULT_${role}_MODEL_NAME`,
        value: `{catalog[${index}]}`,
        override: [`ANTHROPIC_DEFAULT_${role}_MODEL_NAME`],
        description: `Picker label for the ${alias} alias.`,
      },
      {
        name: `ANTHROPIC_DEFAULT_${role}_MODEL_DESCRIPTION`,
        value: `Subconscious model {catalog[${index}]}`,
        override: [`ANTHROPIC_DEFAULT_${role}_MODEL_DESCRIPTION`],
        description: `Picker description for the ${alias} alias.`,
      },
    ];
  }),
  {
    name: 'ANTHROPIC_CUSTOM_MODEL_OPTION',
    value: '{catalog[4]}',
    description:
      'Fifth picker entry, with _NAME and _DESCRIPTION. Only when the catalog has five or more models.',
  },
  {
    name: 'SUBC_CLAUDE_SETTINGS',
    value: '{claudeSettings}',
    description: 'Picker settings JSON passed to --settings.',
  },
];

const CLAUDE_MODEL_PICKER_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
];

const CLAUDE_MODEL_PICKER_ID_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
];

function uniqueCatalogModels(models, fallbackModel) {
  const unique = [];
  for (const model of models) {
    if (model && !unique.includes(model)) unique.push(model);
  }
  if (unique.length === 0 && fallbackModel) unique.push(fallbackModel);
  return unique;
}

export function claudePickerSettings(models, fallbackModel) {
  const unique = uniqueCatalogModels(models, fallbackModel);
  return {
    availableModels: unique,
    modelPicker: {
      replaceBuiltInOptions: true,
      options: unique.map((model) => ({
        model,
        label: model,
        description: `Subconscious model ${model}`,
      })),
    },
  };
}

export function claudeModelPickerEnv(model, models) {
  // Only the live catalog belongs in Claude's picker. Packaged registry slots
  // (Haiku → DeepSeek, etc.) must not be unioned back in — that advertised
  // models the key cannot call.
  //
  // Pad through Fable so the built-in `fable` alias cannot resolve to Anthropic
  // Fable 5. The /model menu itself is replaced via claudePickerSettings.
  const pickerModels = uniqueCatalogModels(models, model);
  while (pickerModels.length < 4)
    pickerModels.push(pickerModels.at(-1) || model);

  const roles = ['OPUS', 'SONNET', 'HAIKU', 'FABLE'];
  const env = {};
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index];
    const model = pickerModels[index];
    if (!model) continue;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL`] = model;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL_NAME`] = model;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL_DESCRIPTION`] =
      `Subconscious model ${model}`;
  }
  const customModel = pickerModels[4];
  if (customModel) {
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = customModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = customModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = `Subconscious model ${customModel}`;
  }
  return Object.fromEntries(
    CLAUDE_MODEL_PICKER_KEYS.map((key) => [key, env[key]]).filter(
      ([, value]) => value,
    ),
  );
}

export function applyClaudePickerCatalog(env, picker, models) {
  if (Object.keys(picker).length === 0) return env;
  const allowed = new Set(models);

  for (const key of CLAUDE_MODEL_PICKER_KEYS) {
    if (!picker[key]) {
      delete env[key];
    }
  }

  for (const key of CLAUDE_MODEL_PICKER_ID_KEYS) {
    if (!picker[key] || !env[key] || allowed.has(env[key])) continue;
    env[key] = picker[key];
    const nameKey = `${key}_NAME`;
    const descriptionKey = `${key}_DESCRIPTION`;
    if (picker[nameKey]) env[nameKey] = picker[nameKey];
    if (picker[descriptionKey]) env[descriptionKey] = picker[descriptionKey];
  }
  return env;
}
