import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { WorkspaceGitRepository } from '../shared/electronApi';
import { createProjectGitignoreIfMissing } from './projectGitignore';

function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(stderr.trim() || error.message));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

export function workspaceGitCheckoutKey(git: WorkspaceGitRepository): string | undefined {
  if (!git.initialized || !git.repositoryRoot) return undefined;
  const checkout = git.branch ? `branch:${git.branch}` : `detached:${git.headRevision ?? 'unborn'}`;
  return `${git.repositoryRoot}\0${checkout}\0conflicts:${git.conflictRevision ?? 'none'}`;
}

export async function readWorkspaceGitRepository(
  rootPath: string,
): Promise<WorkspaceGitRepository> {
  const resolvedRoot = await realpath(rootPath);
  try {
    await runGit(['--version'], resolvedRoot);
  } catch {
    return { available: false, initialized: false };
  }

  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(['rev-parse', '--show-toplevel'], resolvedRoot)).trim();
  } catch {
    return { available: true, initialized: false };
  }

  let branch: string | undefined;
  try {
    branch = (await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], resolvedRoot)).trim();
  } catch {
    branch = undefined;
  }
  let headRevision: string | undefined;
  try {
    headRevision = (await runGit(['rev-parse', '--verify', 'HEAD'], resolvedRoot)).trim();
  } catch {
    headRevision = undefined;
  }
  let conflictRevision: string | undefined;
  try {
    const unmerged = await runGit(['ls-files', '-u', '-z'], resolvedRoot);
    if (unmerged) conflictRevision = createHash('sha256').update(unmerged).digest('hex');
  } catch {
    conflictRevision = undefined;
  }

  return {
    available: true,
    initialized: true,
    repositoryRoot,
    branch: branch || undefined,
    headRevision: headRevision || undefined,
    conflictRevision,
  };
}

export async function initializeWorkspaceGitRepository(
  rootPath: string,
): Promise<WorkspaceGitRepository> {
  const current = await readWorkspaceGitRepository(rootPath);
  if (!current.available) throw new Error('Git is not installed or is unavailable on PATH');
  if (current.initialized) return current;

  const resolvedRoot = await realpath(rootPath);
  await runGit(['init', '--initial-branch=main'], resolvedRoot);
  await createProjectGitignoreIfMissing(resolvedRoot);
  return readWorkspaceGitRepository(resolvedRoot);
}
