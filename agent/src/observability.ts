import * as weave from "weave";

/**
 * Weave (W&B) observability bootstrap.
 *
 * W&B credentials are optional for local demos. If WANDB_API_KEY is missing or
 * W&B is unreachable, Alfred keeps running and the Weave-wrapped ops become
 * normal async functions.
 */
export async function initWeave(project: string): Promise<boolean> {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) {
    console.warn("[weave] WANDB_API_KEY not set; tracing disabled.");
    return false;
  }

  try {
    await weave.login(apiKey);
    await weave.init(project);
    console.log(`[weave] tracing on -> project "${project}"`);
    return true;
  } catch (error) {
    console.warn(
      `[weave] could not initialize tracing: ${
        error instanceof Error ? error.message : String(error)
      }; continuing without tracing.`,
    );
    return false;
  }
}
