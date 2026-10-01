import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  StoryNodeType,
  serializeStorySource,
  parseStorySource,
  serializeStoryProject,
  parseStoryProject,
  type StorySourceDocument,
  type StoryProjectDocument,
} from '../packages/common/src';
import { StoryBlueprintMcpServer } from '../packages/mcp-server/src';
import { StdioTransport } from '../packages/mcp-server/src/protocol/stdioTransport';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListPromptsResult,
  GetPromptResult,
} from '../packages/mcp-server/src/protocol/mcpTypes';
import { PassThrough } from 'node:stream';

function createSampleStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_mcp_test',
    name: 'mcp_test',
    displayName: 'MCP Test Narrative',
    root: {
      nodes: [
        {
          id: 'n_start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 100, y: 100 },
          data: { title: 'Start' },
        },
        {
          id: 'n_dialogue_1',
          name: 'guard_greeting',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 300, y: 100 },
          data: {
            lines: [
              {
                id: 'ln_greeting01',
                textId: 't_greeting01',
                text: { source: 'Halt! Who approaches the castle gates?' },
                speakerId: 'c_guard',
              },
            ],
          },
        },
        {
          id: 'n_choice_1',
          type: StoryNodeType.Choice,
          definitionVersion: 1,
          position: { x: 500, y: 100 },
          data: {
            prompt: { source: 'Respond to the guard:' },
            options: [
              { id: 'o_friend', text: { source: 'I come in peace.' } },
              { id: 'o_bribe', text: { source: 'Here are 10 gold coins.' } },
            ],
          },
        },
        {
          id: 'n_end_1',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 700, y: 100 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_dialogue_1', portId: 'in' },
        },
        {
          from: { nodeId: 'n_dialogue_1', portId: 'out' },
          to: { nodeId: 'n_choice_1', portId: 'in' },
        },
        {
          from: { nodeId: 'n_choice_1', portId: 'o_friend' },
          to: { nodeId: 'n_end_1', portId: 'in' },
        },
        {
          from: { nodeId: 'n_choice_1', portId: 'o_bribe' },
          to: { nodeId: 'n_end_1', portId: 'in' },
        },
      ],
    },
    chapters: [],
    variables: [
      {
        id: 'v_gold',
        name: 'gold',
        displayName: 'Player Gold',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 50,
      },
    ],
    characters: [
      {
        id: 'c_guard',
        name: 'Castle Guard',
        displayName: 'Gate Guard',
        emotions: {},
      },
    ],
    assets: [],
    events: [],
  };
}

describe('StoryBlueprint MCP Server', () => {
  let tmpDir: string;
  let storyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-test-'));
    storyPath = path.join(tmpDir, 'test.story');
    const kdl = serializeStorySource(createSampleStory());
    fs.writeFileSync(storyPath, kdl, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('handles MCP initialize handshake', async () => {
    const server = new StoryBlueprintMcpServer();
    let sentResponse: unknown = null;

    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
      sendError: () => {},
    } as unknown as StdioTransport;

    const s = new StoryBlueprintMcpServer(mockTransport);

    const initReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'codex', version: '1.0.0' },
      },
    };

    await s.handleMessage(initReq);
    expect(sentResponse).not.toBeNull();
    const result = sentResponse as InitializeResult;
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('story-blueprint-mcp');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.prompts).toBeDefined();
  });

  it('lists all available MCP tools', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    const result = sentResponse as ListToolsResult;
    expect(result.tools.length).toBeGreaterThanOrEqual(7);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('story_read_context');
    expect(names).toContain('story_dry_run_command');
    expect(names).toContain('story_apply_command');
    expect(names).toContain('story_compile');
    expect(names).toContain('story_search');
    expect(names).toContain('story_inspect_project');
    expect(names).toContain('story_export_ink');
  });

  it('calls story_read_context to inspect story and node neighborhood', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    // Global summary
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'story_read_context',
        arguments: { storyPath },
      },
    });

    let toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('MCP Test Narrative');
    expect(toolResult.content[0]?.text).toContain('Castle Guard');
    expect(toolResult.content[0]?.text).toContain('gold');

    // Focused node neighborhood
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'story_read_context',
        arguments: { storyPath, nodeId: 'n_dialogue_1' },
      },
    });

    toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('Halt! Who approaches');
    expect(toolResult.content[0]?.text).toContain('n_start');
  });

  it('calls story_search to find dialogue text and variables', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'story_search',
        arguments: { storyPath, query: 'castle' },
      },
    });

    const toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('n_dialogue_1');
  });

  it('calls story_export_ink to generate readable Ink script', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'story_export_ink',
        arguments: { storyPath },
      },
    });

    const toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('VAR gold = 50');
    expect(toolResult.content[0]?.text).toContain('=== n_dialogue_1 ===');
    expect(toolResult.content[0]?.text).toContain('Halt! Who approaches the castle gates?');
  });

  it('calls story_compile to run compiler verification', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'story_compile',
        arguments: { storyPath },
      },
    });

    const toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('Compilation Succeeded');
    expect(toolResult.content[0]?.text).toContain('Total Instructions');
  });

  it('calls story_dry_run_command to validate proposed actions safely', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    // Dry run adding a dialogue line
    const command = {
      version: 1,
      baseRevision: 'rev_initial',
      operations: [
        {
          operationId: 'op_add_line',
          kind: 'add-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_dialogue_1',
          line: {
            id: 'ln_line002',
            textId: 't_text002',
            text: 'Identify yourself immediately!',
            speakerId: 'c_guard',
          },
        },
      ],
    };

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'story_dry_run_command',
        arguments: { storyPath, command },
      },
    });

    const toolResult = sentResponse as CallToolResult;
    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content[0]?.text).toContain('Dry Run Succeeded');
    expect(toolResult.content[0]?.text).toContain('add-dialogue-line');
  });

  it('calls story_apply_command to persist changes with backup', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    const command = {
      version: 1,
      baseRevision: 'rev_initial',
      operations: [
        {
          operationId: 'op_add_line_apply',
          kind: 'add-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_dialogue_1',
          line: {
            id: 'ln_apply_001',
            textId: 't_apply_001',
            text: 'By order of the King!',
            speakerId: 'c_guard',
          },
        },
      ],
    };

    // 1. Missing userConfirmed is blocked by gatekeeper
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'story_apply_command',
        arguments: { storyPath, command, createBackup: true },
      },
    });
    const blockedResult = sentResponse as CallToolResult;
    expect(blockedResult.isError).toBe(true);
    expect(blockedResult.content[0]?.text).toContain('Review Gatekeeper Blocked');

    // 2. Default: autoApply is off, so it stages as a pending proposal for editor review
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'story_apply_command',
        arguments: { storyPath, command, createBackup: true, userConfirmed: true },
      },
    });

    const stagedResult = sentResponse as CallToolResult;
    expect(stagedResult.isError).toBeFalsy();
    expect(stagedResult.content[0]?.text).toContain('Staged for Author Review in Editor');
    const pendingProposalPath = path.join(tmpDir, '.storyblueprint', 'pending_proposal.json');
    expect(fs.existsSync(pendingProposalPath)).toBe(true);
    // Story file is not modified on disk yet
    expect(fs.readFileSync(storyPath, 'utf-8')).not.toContain('By order of the King!');

    // 3. When allowAiAutoApply is enabled in workspace settings, it directly applies to disk
    const settingsDir = path.join(tmpDir, '.storyblueprint');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ allowAiAutoApply: true }),
      'utf-8',
    );

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'story_apply_command',
        arguments: { storyPath, command, createBackup: true, userConfirmed: true },
      },
    });

    const autoApplyResult = sentResponse as CallToolResult;
    expect(autoApplyResult.isError).toBeFalsy();
    expect(autoApplyResult.content[0]?.text).toContain('Successfully Applied Changes to Story');
    expect(fs.existsSync(`${storyPath}.bak`)).toBe(true);

    // Verify the file on disk was updated and pending proposal was cleaned up
    const updatedContent = fs.readFileSync(storyPath, 'utf-8');
    expect(updatedContent).toContain('By order of the King!');
    expect(fs.existsSync(pendingProposalPath)).toBe(false);
  });

  it('lists and retrieves prompts', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;

    const server = new StoryBlueprintMcpServer(mockTransport);

    // List prompts
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'prompts/list',
    });
    const listResult = sentResponse as ListPromptsResult;
    expect(listResult.prompts.length).toBeGreaterThanOrEqual(2);
    expect(listResult.prompts.some((p) => p.name === 'edit_dialogue')).toBe(true);

    // Get prompt
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'prompts/get',
      params: {
        name: 'edit_dialogue',
        arguments: {
          storyPath: 'my_story.story',
          instructions: 'Make the guard more aggressive',
        },
      },
    });
    const promptResult = sentResponse as GetPromptResult;
    expect(promptResult.messages[0]?.content.text).toContain('Make the guard more aggressive');
    expect(promptResult.messages[0]?.content.text).toContain('story_dry_run_command');
  });

  it('formats mcp config paths with forward slashes across all platforms', () => {
    const rawWindowsPath = 'C:\\Apps\\StoryBlueprint\\resources\\mcp-server\\cli.cjs';
    const normalized = rawWindowsPath.replace(/\\/g, '/');
    const config = {
      mcpServers: {
        'story-blueprint': {
          command: 'C:\\Apps\\StoryBlueprint\\StoryBlueprint.exe'.replace(/\\/g, '/'),
          args: [normalized],
        },
      },
    };
    const jsonStr = JSON.stringify(config, null, 2);
    expect(jsonStr).not.toContain('\\\\');
    expect(jsonStr).toContain('C:/Apps/StoryBlueprint/resources/mcp-server/cli.cjs');
    expect(JSON.parse(jsonStr).mcpServers['story-blueprint'].args[0]).toBe(
      'C:/Apps/StoryBlueprint/resources/mcp-server/cli.cjs',
    );
  });

  it('creates a new story file and registers it in workspace .storyproject', async () => {
    // Setup a workspace with a .storyproject
    const projectDoc: StoryProjectDocument = {
      format: STORY_PROJECT_FORMAT,
      version: STORY_PROJECT_VERSION,
      id: 'prj_test_multi',
      name: 'multi_story_prj',
      displayName: 'Multi Story Project',
      stories: [
        { id: 's_main', path: 'main.story', name: 'main', displayName: 'Main Story' },
      ],
      characters: [],
      assets: [],
      events: [],
      signals: [],
      variables: [],
    };
    const projectPath = path.join(tmpDir, 'game.storyproject');
    fs.writeFileSync(projectPath, serializeStoryProject(projectDoc), 'utf-8');

    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;
    const server = new StoryBlueprintMcpServer(mockTransport);

    // Call story_create to create bus.story
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'story_create',
        arguments: {
          storyPath: 'bus.story',
          workspacePath: tmpDir,
          displayName: 'Bus Heist',
        },
      },
    });

    const callResult = sentResponse as CallToolResult;
    expect(callResult.isError).toBe(false);
    expect(callResult.content[0]?.text).toContain('Successfully created new story file');
    expect(callResult.content[0]?.text).toContain('Registered into project manifest');

    // Verify bus.story exists and is valid KDL
    const createdFile = path.join(tmpDir, 'bus.story');
    expect(fs.existsSync(createdFile)).toBe(true);
    const parsed = parseStorySource(fs.readFileSync(createdFile, 'utf-8'));
    expect(parsed.name).toBe('bus');
    expect(parsed.displayName).toBe('Bus Heist');
    expect(parsed.root.nodes.some((n) => n.type === StoryNodeType.Start)).toBe(true);
    expect(parsed.root.nodes.some((n) => n.type === StoryNodeType.End)).toBe(true);

    // Verify .storyproject was updated with the new story
    const updatedProject = parseStoryProject(fs.readFileSync(projectPath, 'utf-8'));
    expect(updatedProject.stories).toHaveLength(2);
    expect(updatedProject.stories.some((s) => s.path === 'bus.story')).toBe(true);

    // Calling it again on the same path fails with clear message
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'story_create',
        arguments: {
          storyPath: 'bus.story',
          workspacePath: tmpDir,
        },
      },
    });
    const duplicateResult = sentResponse as CallToolResult;
    expect(duplicateResult.isError).toBe(true);
    expect(duplicateResult.content[0]?.text).toContain('already exists');
  });

  it('provides repair and backup guidance when a story file is corrupted or missing', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;
    const server = new StoryBlueprintMcpServer(mockTransport);

    // 1. Missing file: advises using story_create
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'story_read_context',
        arguments: {
          storyPath: path.join(tmpDir, 'non_existent.story'),
        },
      },
    });
    const missingResult = sentResponse as CallToolResult;
    expect(missingResult.isError).toBe(true);
    expect(missingResult.content[0]?.text).toContain('story_create');

    // 2. Corrupted file: provides backup hint and repair guidance
    const corruptedPath = path.join(tmpDir, 'corrupted.story');
    fs.writeFileSync(corruptedPath, 'this is totally not valid { [ kdl story syntax', 'utf-8');
    fs.writeFileSync(`${corruptedPath}.bak`, 'backup content', 'utf-8');

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'story_read_context',
        arguments: {
          storyPath: corruptedPath,
        },
      },
    });
    const corruptedResult = sentResponse as CallToolResult;
    expect(corruptedResult.isError).toBe(true);
    expect(corruptedResult.content[0]?.text).toContain('backup file exists');
    expect(corruptedResult.content[0]?.text).toContain('ask the user for permission and attempt to inspect and repair it');
  });

  it('searches narration text and exports narration in Ink format', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;
    const server = new StoryBlueprintMcpServer(mockTransport);

    const story = createSampleStory();
    // Add narration node
    story.root.nodes.push({
      id: 'n_narration_1',
      name: 'scene_atmosphere',
      type: StoryNodeType.Narration,
      definitionVersion: 1,
      position: { x: 200, y: 100 },
      data: {
        textId: 't_narr_1',
        text: { source: 'Rain pours relentlessly onto the muddy cobblestones.' },
      },
    });
    // Add Branch node with true and false branches
    story.root.nodes.push({
      id: 'n_branch_1',
      type: StoryNodeType.Branch,
      definitionVersion: 1,
      position: { x: 300, y: 100 },
      data: {
        condition: { source: 'alert_level >= 2' },
      },
    });
    story.root.edges.push(
      { from: { nodeId: 'n_branch_1', portId: 'true' }, to: { nodeId: 'n_end_1', portId: 'in' } },
      { from: { nodeId: 'n_branch_1', portId: 'false' }, to: { nodeId: 'n_dialogue_1', portId: 'in' } },
    );

    const storyPath = path.join(tmpDir, 'narration_test.story');
    fs.writeFileSync(storyPath, serializeStorySource(story), 'utf-8');

    // 1. Search narration
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'story_search',
        arguments: {
          storyPath,
          query: 'cobblestones',
        },
      },
    });
    const searchRes = sentResponse as CallToolResult;
    expect(searchRes.isError).toBeFalsy();
    expect(searchRes.content[0]?.text).toContain('[Narration in Node `n_narration_1`]');
    expect(searchRes.content[0]?.text).toContain('cobblestones');

    // 2. Export Ink with narration and branch true/false ports
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'story_export_ink',
        arguments: {
          storyPath,
        },
      },
    });
    const inkRes = sentResponse as CallToolResult;
    expect(inkRes.isError).toBeFalsy();
    expect(inkRes.content[0]?.text).toContain('Rain pours relentlessly onto the muddy cobblestones.');
    expect(inkRes.content[0]?.text).toContain('{ alert_level >= 2:');
    expect(inkRes.content[0]?.text).toContain('-> n_end_1');
    expect(inkRes.content[0]?.text).toContain('- else:');
    expect(inkRes.content[0]?.text).toContain('-> n_dialogue_1');
  });

  it('supports lenient input shapes for remove-node, update-node and surfaces review prompt in dry-run', async () => {
    let sentResponse: unknown = null;
    const mockTransport = {
      sendResponse: (_id: string | number, res: unknown) => {
        sentResponse = res;
      },
    } as unknown as StdioTransport;
    const server = new StoryBlueprintMcpServer(mockTransport);

    const storyPath = path.join(tmpDir, 'test.story');

    // Test dry run with lenient remove-node shape: node: { id: "n_end_1" }
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'story_dry_run_command',
        arguments: {
          storyPath,
          command: {
            version: 1,
            operations: [
              {
                operationId: 'op_rem',
                kind: 'remove-node',
                graph: { kind: 'root' },
                node: { id: 'n_end_1' },
              },
            ],
          },
        },
      },
    });
    const dryRunRes = sentResponse as CallToolResult;
    expect(dryRunRes.isError).toBeFalsy();
    expect(dryRunRes.content[0]?.text).toContain('Review Required Before Apply');
    // Notice n_choice_1 options will now have dangling dead-ends because n_end_1 was removed
    expect(dryRunRes.content[0]?.text).toContain('Flow Integrity Errors');
    expect(dryRunRes.content[0]?.text).toContain('MISSING_CONNECTION');

    // Test update-node with lenient shape: { nodeId: "...", data: { ... } }
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 43,
      method: 'tools/call',
      params: {
        name: 'story_dry_run_command',
        arguments: {
          storyPath,
          command: {
            version: 1,
            operations: [
              {
                operationId: 'op_upd',
                kind: 'update-node',
                graph: { kind: 'root' },
                nodeId: 'n_dialogue_1',
                data: {
                  lines: [
                    {
                      id: 'ln_g2',
                      textId: 't_g2',
                      text: { source: 'New greeting!' },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    const updateRes = sentResponse as CallToolResult;
    expect(updateRes.isError).toBeFalsy();
    expect(updateRes.content[0]?.text).toContain('Dry Run Succeeded!');
  });
});
