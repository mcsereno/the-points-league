import { env } from "cloudflare:workers";
import {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettings,
  validateLeagueSettings,
} from "./league-config";

export async function getLeagueSettings(): Promise<LeagueSettings> {
  try {
    const row = await env.DB.prepare(
      "SELECT settings_json AS settingsJson FROM season_settings WHERE id=?",
    ).bind(DEFAULT_LEAGUE_SETTINGS.seasonId).first<{ settingsJson: string }>();
    if (!row?.settingsJson) return DEFAULT_LEAGUE_SETTINGS;
    return validateLeagueSettings(JSON.parse(row.settingsJson));
  } catch {
    return DEFAULT_LEAGUE_SETTINGS;
  }
}

export async function saveLeagueSettings(settings: LeagueSettings, actor: string) {
  const validated = validateLeagueSettings(settings);
  await env.DB.prepare(`
    INSERT INTO season_settings (id,settings_json,updated_by,updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      settings_json=excluded.settings_json,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    validated.seasonId,
    JSON.stringify(validated),
    actor,
  ).run();
  return validated;
}
