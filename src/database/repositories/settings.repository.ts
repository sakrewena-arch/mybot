import type { PrismaClient, BotSettings } from '@prisma/client';
import { LEGACY_SYSTEM_PROMPTS } from '../../ai/prompt.service.js';

export interface SettingsRepository {
  getSettings(): Promise<BotSettings>;
  updateSystemPrompt(systemPrompt: string): Promise<BotSettings>;
  setEnabled(enabled: boolean): Promise<BotSettings>;
}

export function createSettingsRepository(
  client: PrismaClient,
  defaultPrompt: string,
): SettingsRepository {
  return {
    async getSettings() {
      const settings = await client.botSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
          id: 1,
          systemPrompt: defaultPrompt,
          enabled: true,
          defaultLanguage: 'en',
        },
      });

      // Persona upgrades: if the stored prompt is empty or is a known legacy
      // default, silently move to the current DEFAULT_SYSTEM_PROMPT.
      if (
        settings.systemPrompt.trim() === '' ||
        LEGACY_SYSTEM_PROMPTS.includes(settings.systemPrompt)
      ) {
        return client.botSettings.update({
          where: { id: 1 },
          data: { systemPrompt: defaultPrompt },
        });
      }
      return settings;
    },

    updateSystemPrompt(systemPrompt) {
      return client.botSettings.update({ where: { id: 1 }, data: { systemPrompt } });
    },

    setEnabled(enabled) {
      return client.botSettings.update({ where: { id: 1 }, data: { enabled } });
    },
  };
}