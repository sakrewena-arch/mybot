import type { PrismaClient, BotSettings } from '@prisma/client';

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
      return client.botSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
          id: 1,
          systemPrompt: defaultPrompt,
          enabled: true,
          defaultLanguage: 'en',
        },
      });
    },

    updateSystemPrompt(systemPrompt) {
      return client.botSettings.update({ where: { id: 1 }, data: { systemPrompt } });
    },

    setEnabled(enabled) {
      return client.botSettings.update({ where: { id: 1 }, data: { enabled } });
    },
  };
}