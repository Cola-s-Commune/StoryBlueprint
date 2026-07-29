import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import type {
  StoryGitConflictStages,
  WorkspaceGitConflictStages,
  WorkspaceMergeResourceKind,
} from '../shared/electronApi';

function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
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

function conflictRevision(
  base: string | undefined,
  local: string | undefined,
  remote: string | undefined,
): string {
  const hash = createHash('sha256');
  for (const value of [base, local, remote]) {
    hash.update(value === undefined ? 'missing' : `content:${Buffer.byteLength(value, 'utf8')}`);
    if (value !== undefined) hash.update(value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function readStoryGitConflict(
  filePath: string,
): Promise<StoryGitConflictStages | undefined> {
  const resolvedFile = await realpath(filePath);
  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(['rev-parse', '--show-toplevel'], dirname(resolvedFile))).trim();
  } catch {
    return undefined;
  }
  if (!repositoryRoot) return undefined;
  const relativePath = relative(repositoryRoot, resolvedFile).split(sep).join('/');
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    throw new Error('The selected Story is outside the Git repository');
  }
  const unmerged = await runGit(['ls-files', '-u', '--', relativePath], repositoryRoot);
  if (!unmerged.trim()) return undefined;
  const [base, local, remote] = await Promise.all(
    [1, 2, 3].map((stage) => runGit(['show', `:${stage}:${relativePath}`], repositoryRoot)),
  );
  return {
    repositoryRoot,
    relativePath,
    revision: conflictRevision(base, local, remote),
    base,
    local,
    remote,
  };
}

function resourceKind(filePath: string): WorkspaceMergeResourceKind | undefined {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.storyproject') return 'project';
  if (extension === '.character') return 'character';
  if (extension === '.asset') return 'asset';
  return undefined;
}

export async function readWorkspaceGitConflicts(
  workspaceRoot: string,
): Promise<WorkspaceGitConflictStages[]> {
  const resolvedWorkspace = await realpath(workspaceRoot);
  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(['rev-parse', '--show-toplevel'], resolvedWorkspace)).trim();
  } catch {
    return [];
  }
  const output = await runGit(['ls-files', '-u', '-z'], repositoryRoot);
  const paths = new Set<string>();
  for (const entry of output.split('\0')) {
    if (!entry) continue;
    const separator = entry.indexOf('\t');
    if (separator < 0) continue;
    paths.add(entry.slice(separator + 1));
  }

  const conflicts: WorkspaceGitConflictStages[] = [];
  for (const repositoryPath of paths) {
    const absolutePath = join(repositoryRoot, ...repositoryPath.split('/'));
    const workspacePath = relative(resolvedWorkspace, absolutePath);
    if (
      !workspacePath ||
      isAbsolute(workspacePath) ||
      workspacePath === '..' ||
      workspacePath.startsWith(`..${sep}`)
    ) {
      continue;
    }
    const kind = resourceKind(repositoryPath);
    if (!kind) continue;
    const [base, local, remote] = await Promise.all(
      [1, 2, 3].map(async (stage) => {
        try {
          return await runGit(['show', `:${stage}:${repositoryPath}`], repositoryRoot);
        } catch {
          return undefined;
        }
      }),
    );
    if (!local && !remote) continue;
    conflicts.push({
      repositoryRoot,
      relativePath: workspacePath.split(sep).join('/'),
      kind,
      revision: conflictRevision(base, local, remote),
      base,
      local,
      remote,
    });
  }
  return conflicts.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
