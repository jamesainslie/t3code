// The release quality job re-runs checks that CI (fork) already runs on every
// push to main. When CI went green on the exact release commit, re-running
// them only delays the release; anything short of that runs the full suite.
const CI_WORKFLOW = "ci-fork.yml";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 30 * 1000;

async function newestCiRun({ github, context, sha }) {
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...context.repo,
    workflow_id: CI_WORKFLOW,
    head_sha: sha,
    branch: context.payload.repository.default_branch,
    event: "push",
    per_page: 20,
  });
  return data.workflow_runs.reduce(
    (newest, run) => (!newest || run.id > newest.id ? run : newest),
    undefined,
  );
}

async function mainCiPassed({
  github,
  context,
  core,
  sha,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const run = await newestCiRun({ github, context, sha });
    if (!run) {
      core.info(`CI never ran on ${sha}. Running the full suite.`);
      return false;
    }
    if (run.status === "completed") {
      if (run.conclusion === "success") {
        core.info(`CI passed on ${sha}: ${run.html_url}`);
        return true;
      }
      core.info(`CI ended ${run.conclusion} on ${sha}: ${run.html_url}. Running the full suite.`);
      return false;
    }
    if (now() + pollMs > deadline) {
      core.info(`CI is still ${run.status} on ${sha}: ${run.html_url}. Running the full suite.`);
      return false;
    }
    core.info(`CI is ${run.status} on ${sha}. Waiting for it: ${run.html_url}`);
    await sleep(pollMs);
  }
}

module.exports = { mainCiPassed };
