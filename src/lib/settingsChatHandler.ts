import { evaluateSettingsCommand, SettingsCommandHandlers, SettingsEvaluationResult } from './chatCapabilityManifest';

/**
 * Handles settings commands executed via natural language in chat.
 */
export function handleSettingsChatCommand(
  text: string,
  handlers: SettingsCommandHandlers
): SettingsEvaluationResult {
  return evaluateSettingsCommand(text, handlers);
}
