import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadRepoEnv } from "./env";
import { createTalonCompanyDelegateFromEnv } from "./talon";

interface TestAgentArgs {
  question: string;
  meetingId: string;
  speakerName: string;
  repeat: number;
  interactive: boolean;
  keepAlive: boolean;
}

const DEFAULT_QUESTION = "Priya is out. Is the onboarding redesign safe to ship to production?";

loadRepoEnv();

const args = parseArgs(process.argv.slice(2));
const delegate = createTalonCompanyDelegateFromEnv(process.env);

try {
  const info = await delegate.ready();
  console.log(`[agent:test] Talon namespace=${info.namespace} agent=${info.agentName}`);
  console.log(`[agent:test] grpc=${info.grpcEndpoint}`);
  console.log(`[agent:test] ui/rest=${info.uiEndpoint}`);
  console.log(`[agent:test] data=${info.dataDir}`);
  console.log(`[agent:test] workspace=${info.workspaceDir}`);
  for (const mcp of info.mcpServers) {
    const mcpArgs = mcp.args.length ? ` ${mcp.args.join(" ")}` : "";
    console.log(`[agent:test] mcp ${mcp.name} ${mcp.transport} -> ${mcp.target}${mcpArgs}`);
  }

  for (let i = 0; i < args.repeat; i += 1) {
    await askAndPrint(args.question, args, i);
  }

  if (args.interactive) {
    await runInteractive(args);
  } else if (args.keepAlive) {
    console.log("[agent:test] keeping Talon node alive; press Ctrl+C to stop");
    await new Promise<void>(() => {});
  }
} finally {
  await delegate.close();
}

async function askAndPrint(question: string, config: TestAgentArgs, index: number): Promise<void> {
  const label = config.repeat > 1 ? ` #${index + 1}` : "";
  console.log(`\n[agent:test] question${label}: ${question}`);
  const answer = await delegate.ask({
    meetingId: config.meetingId,
    speaker: { id: "agent-test", displayName: config.speakerName },
    question,
  });
  console.log(`[agent:test] answer${label}:\n${answer}`);
}

async function runInteractive(config: TestAgentArgs): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const question = (await rl.question("\nagent:test> ")).trim();
      if (!question || question === "exit" || question === "quit") break;
      await askAndPrint(question, { ...config, repeat: 1 }, 0);
    }
  } finally {
    rl.close();
  }
}

function parseArgs(argv: string[]): TestAgentArgs {
  const positional: string[] = [];
  const args = argv[0] === "question" ? argv.slice(1) : argv;
  const parsed: TestAgentArgs = {
    question: "",
    meetingId: "agent-test",
    speakerName: "Agent Test User",
    repeat: 1,
    interactive: false,
    keepAlive: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--question":
      case "-q":
        parsed.question = requireValue(args, ++i, arg);
        break;
      case "--meeting-id":
      case "-m":
        parsed.meetingId = requireValue(args, ++i, arg);
        break;
      case "--speaker":
      case "-s":
        parsed.speakerName = requireValue(args, ++i, arg);
        break;
      case "--repeat":
      case "-r":
        parsed.repeat = readPositiveInteger(requireValue(args, ++i, arg), arg);
        break;
      case "--interactive":
      case "-i":
        parsed.interactive = true;
        break;
      case "--keep-alive":
        parsed.keepAlive = true;
        break;
      default:
        positional.push(arg);
    }
  }

  parsed.question = parsed.question || positional.join(" ").trim() || DEFAULT_QUESTION;
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readPositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage:
  bun run agent:test -- [question]
  bun run agent:test -- question "Is the onboarding redesign safe to ship?"
  bun run agent:test -- --question "Is the onboarding redesign safe to ship?"
  bun run agent:test -- --interactive

Options:
  -q, --question <text>      Question to send to the Talon delegate
  -m, --meeting-id <id>      Meeting/session key to reuse (default: agent-test)
  -s, --speaker <name>       Speaker display name (default: Agent Test User)
  -r, --repeat <count>       Ask the same question repeatedly against one session
  -i, --interactive          Keep reading questions from stdin
      --keep-alive           Keep the Talon node running after the one-shot ask
  -h, --help                 Show this help`);
}
