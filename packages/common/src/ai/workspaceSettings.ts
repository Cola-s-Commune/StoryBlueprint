export interface StoryBlueprintWorkspaceSettings {
  allowAiAutoApply?: boolean;
}

export interface PendingAIProposal {
  id: string;
  storyPath: string;
  targetFilePath: string;
  command: unknown;
  intent?: string;
  createdAt: string;
}

export const WORKSPACE_SETTINGS_RELATIVE_PATH = '.storyblueprint/settings.json';
export const PENDING_PROPOSAL_RELATIVE_PATH = '.storyblueprint/pending_proposal.json';
