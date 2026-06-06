import * as weave from "weave";

/**
 * Weave (W&B) observability bootstrap.
 *
 * Why this exists: weave.init() resolves the W&B host from your ~/.netrc BEFORE reading
 * WANDB_API_KEY, so a bare env var isn't enough on a fresh machine. weave.login(apiKey)
 * writes the netrc entry (the JS equivalent of `wandb login`), after which init() works.
 * We run login automatically from WANDB_API_KEY so tracing "just connects" from .env.
 *
 * Tracing is observability, not the product — if W&B is unreachable we warn loudly and let
 * the agent run untraced rather than crash a live meeting.
 */
export async function initWeave(project: string): Promise<boolean> {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) {
    console.warn(
      "[weave] WANDB_API_KEY not set — tracing disabled. Set it in .env to connect to W&B."
    );
    return false;
  }
  try {
    // Idempotent: verifies the key with W&B and persists credentials to ~/.netrc.
    await weave.login(apiKey);
    await weave.init(project);
    console.log(`[weave] tracing on → project "${project}"`);
    return true;
  } catch (err) {
    console.warn(
      `[weave] could not initialize tracing: ${
        err instanceof Error ? err.message : String(err)
      } — continuing without tracing.`
    );
    return false;
  }
}
