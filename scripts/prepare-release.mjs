import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

try {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_TOKEN: token,
    DEPLOY_DOMAIN: suppliedDomain,
  } = process.env;
  const domain = suppliedDomain?.trim().toLowerCase();
  if (
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    !token ||
    !process.env.GITHUB_OUTPUT ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '') ||
    !domain ||
    domain.length > 253 ||
    domain.split('.').length < 2 ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error('Invalid release configuration');
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`);
  url.search = new URLSearchParams({ head_sha: sha, event: 'push', per_page: '100' }).toString();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('CI status unavailable');
  const data = await response.json();
  if (
    !Array.isArray(data.workflow_runs) ||
    !data.workflow_runs.some(
      (run) =>
        run.head_sha === sha &&
        run.event === 'push' &&
        run.status === 'completed' &&
        run.conclusion === 'success',
    )
  )
    throw new Error('This commit has no successful CI run');
  const tag = `${sha}-${createHash('sha256').update(domain).digest('hex').slice(0, 12)}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const imagePrefix = `ghcr.io/${repository.toLowerCase()}`;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `domain=${domain}\nimage_prefix=${imagePrefix}\nrelease_tag=${tag}\n`,
  );
  console.log(`Verified release ${tag} for ${domain}`);
} catch {
  console.error(
    'Release preparation failed: select main, a valid public hostname and a commit with successful FlowSync CI.',
  );
  process.exitCode = 1;
}
