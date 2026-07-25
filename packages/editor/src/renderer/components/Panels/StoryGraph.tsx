import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Connection,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  StoryNodeType,
  nodeRegistry,
  NodeFactory,
} from '@story-blueprint/common';
import { nodeTypes } from '../Nodes';
import styles from './StoryGraph.module.css';

// Register built-in types at module level so they're available before first render
nodeRegistry.registerBuiltins();

/** Build demo initial nodes using the registry + factory */
function buildInitialNodes(): Node[] {
  return ([
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.Start),
      StoryNodeType.Start,
      { x: 250, y: 50 },
    ),
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.Dialogue),
      StoryNodeType.Dialogue,
      { x: 250, y: 220 },
    ),
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.Choice),
      StoryNodeType.Choice,
      { x: 200, y: 400 },
    ),
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.Branch),
      StoryNodeType.Branch,
      { x: 500, y: 400 },
    ),
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.End),
      StoryNodeType.End,
      { x: 200, y: 600 },
    ),
    NodeFactory.create(
      NodeFactory.generateId(StoryNodeType.End),
      StoryNodeType.End,
      { x: 500, y: 600 },
    ),
  ].filter(Boolean) as unknown as Node[]);
}

export function StoryGraph() {
  const [nodes, , onNodesChange] = useNodesState(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Story Graph</div>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode="Control"
          selectionKeyCode="Shift"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3d3d3d" />
          <MiniMap nodeStrokeColor="#555" nodeColor="#333" maskColor="rgba(0,0,0,0.6)" />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
