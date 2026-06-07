import { loadRepoEnv } from "./env";
import { createTalonCompanyDelegateFromEnv } from "./talon";

loadRepoEnv();

const question =
  process.argv.slice(2).join(" ").trim() ||
  "Priya is out. Is the onboarding redesign safe to ship to production?";

const delegate = createTalonCompanyDelegateFromEnv(process.env);

try {
  const info = await delegate.ready();
  console.log(`[agent:demo] Talon namespace=${info.namespace} agent=${info.agentName}`);
  const answer = await delegate.ask({
    meetingId: "agent-demo",
    speaker: { id: "demo", displayName: "Demo User" },
    question,
  });
  console.log(answer);
} finally {
  await delegate.close();
}
