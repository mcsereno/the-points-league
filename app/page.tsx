import { PoolExperience } from "./PoolExperience";
import { getLeagueSettings } from "./lib/league-settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = await getLeagueSettings();
  return <PoolExperience settings={settings} />;
}
