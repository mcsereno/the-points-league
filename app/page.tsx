import { PoolExperience } from "./PoolExperience";
import { RecoveryRedirect } from "./components/RecoveryRedirect";
import { getLeagueSettings } from "./lib/league-settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = await getLeagueSettings();
  return <><RecoveryRedirect /><PoolExperience settings={settings} /></>;
}
