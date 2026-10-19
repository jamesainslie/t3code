const assert = require("node:assert/strict");
const test = require("node:test");
const { mainCiPassed } = require("./main-ci-verdict.cjs");

const minute = 60 * 1000;

function fixture(polls) {
  const queries = [];
  const sleeps = [];
  let clock = 0;
  let poll = 0;
  return {
    queries,
    sleeps,
    options: {
      context: {
        payload: { repository: { default_branch: "main" } },
        repo: { owner: "example", repo: "app" },
      },
      core: { info() {} },
      github: {
        rest: {
          actions: {
            async listWorkflowRuns(params) {
              queries.push(params);
              const runs = polls[Math.min(poll, polls.length - 1)];
              poll += 1;
              return { data: { workflow_runs: runs } };
            },
          },
        },
      },
      sha: "candidate",
      now: () => clock,
      async sleep(ms) {
        sleeps.push(ms);
        clock += ms;
      },
    },
  };
}

const run = (id, status, conclusion = null) => ({
  id,
  status,
  conclusion,
  html_url: `https://example.test/runs/${id}`,
});

test("asks only for main's push CI on the release commit", async () => {
  const { options, queries } = fixture([[run(1, "completed", "success")]]);
  await mainCiPassed(options);
  assert.deepEqual(queries[0], {
    owner: "example",
    repo: "app",
    workflow_id: "ci-fork.yml",
    head_sha: "candidate",
    branch: "main",
    event: "push",
    per_page: 20,
  });
});

test("reuses a green CI run without waiting", async () => {
  const { options, sleeps } = fixture([[run(1, "completed", "success")]]);
  assert.equal(await mainCiPassed(options), true);
  assert.equal(sleeps.length, 0);
});

test("runs the suite itself when CI failed on the commit", async () => {
  const { options } = fixture([[run(1, "completed", "failure")]]);
  assert.equal(await mainCiPassed(options), false);
});

test("runs the suite itself when CI never ran on the commit", async () => {
  const { options } = fixture([[]]);
  assert.equal(await mainCiPassed(options), false);
});

test("judges the newest run when CI ran more than once", async () => {
  const { options } = fixture([[run(1, "completed", "success"), run(2, "completed", "failure")]]);
  assert.equal(await mainCiPassed(options), false);
});

test("waits for CI that is still running and reuses its green result", async () => {
  const { options, sleeps } = fixture([
    [run(1, "in_progress")],
    [run(1, "in_progress")],
    [run(1, "completed", "success")],
  ]);
  assert.equal(await mainCiPassed(options), true);
  assert.equal(sleeps.length, 2);
});

test("stops waiting at the deadline and runs the suite itself", async () => {
  const { options } = fixture([[run(1, "queued")]]);
  assert.equal(await mainCiPassed({ ...options, timeoutMs: 5 * minute }), false);
});
