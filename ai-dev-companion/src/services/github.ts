import { Octokit } from '@octokit/rest';

/**
 * Get PR diff
 */
export async function getPRDiff(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: {
      format: 'diff',
    },
  });

  // @ts-expect-error - data is a string when format is 'diff'
  return data as string;
}

/**
 * Post review comment on PR
 */
export async function postPRComment(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

/**
 * Get repository file tree (for context)
 */
export async function getRepoFileTree(
  token: string,
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: 'true',
    });

    const fileList = data.tree
      .filter((item) => item.type === 'blob')
      .map((item) => item.path)
      .join('\n');

    return fileList;
  } catch (error) {
    console.error('Failed to get repo file tree:', error);
    return 'Unable to retrieve repository file tree.';
  }
}

/**
 * Get README content
 */
export async function getRepoReadme(
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.repos.getReadme({
      owner,
      repo,
    });

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    console.error('Failed to get README:', error);
    return 'No README found.';
  }
}

/**
 * Post comment on GitHub issue
 */
export async function postIssueComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  commenterName?: string
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  const finalBody = commenterName
    ? `*Reviewed and approved by @${commenterName}*\n\n${body}`
    : body;

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: finalBody,
  });
}
