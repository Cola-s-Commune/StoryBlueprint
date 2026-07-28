import { StoryNodeType } from '@story-blueprint/common';
import type { NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode';
import { DialogueNode } from './DialogueNode';
import { ChoiceNode } from './ChoiceNode';
import { BranchNode } from './BranchNode';
import { EndNode } from './EndNode';
import { GetVariableNode, SetVariableNode } from './VariableNode';
import { CallSubstoryNode, ReturnNode } from './SubstoryNode';
import { FlowAnchorNode, FlowJumpNode, RerouteNode } from './FlowNode';
import { CallEventNode, WaitSignalNode } from './EventNode';

/** React Flow nodeTypes mapping — pass to <ReactFlow nodeTypes={...}> */
export const nodeTypes: NodeTypes = {
  [StoryNodeType.Start]: StartNode,
  [StoryNodeType.Dialogue]: DialogueNode,
  [StoryNodeType.Choice]: ChoiceNode,
  [StoryNodeType.Branch]: BranchNode,
  [StoryNodeType.GetVariable]: GetVariableNode,
  [StoryNodeType.SetVariable]: SetVariableNode,
  [StoryNodeType.CallEvent]: CallEventNode,
  [StoryNodeType.WaitSignal]: WaitSignalNode,
  [StoryNodeType.CallSubstory]: CallSubstoryNode,
  [StoryNodeType.Reroute]: RerouteNode,
  [StoryNodeType.FlowAnchor]: FlowAnchorNode,
  [StoryNodeType.FlowJump]: FlowJumpNode,
  [StoryNodeType.Return]: ReturnNode,
  [StoryNodeType.End]: EndNode,
};
