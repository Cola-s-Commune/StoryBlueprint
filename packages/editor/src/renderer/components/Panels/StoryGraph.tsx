import { useCallback, useState } from 'react';
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
  type Edge,
  type OnConnectEnd,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  StoryNodeType,
  nodeRegistry,
  NodeFactory,
  createStableId,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
} from '@story-blueprint/common';
import { nodeTypes } from '../Nodes';
import styles from './StoryGraph.module.css';

// Register built-in types at module level so they're available before first render
nodeRegistry.registerBuiltins();

/** Build demo initial nodes using the registry + factory */
function buildInitialNodes(): Node[] {
  return [
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.Start), StoryNodeType.Start, {
      x: 250,
      y: 50,
    }),
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.Dialogue), StoryNodeType.Dialogue, {
      x: 250,
      y: 220,
    }),
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.Choice), StoryNodeType.Choice, {
      x: 200,
      y: 400,
    }),
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.Branch), StoryNodeType.Branch, {
      x: 500,
      y: 400,
    }),
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.End), StoryNodeType.End, {
      x: 200,
      y: 600,
    }),
    NodeFactory.create(NodeFactory.generateId(StoryNodeType.End), StoryNodeType.End, {
      x: 500,
      y: 600,
    }),
  ].filter(Boolean) as unknown as Node[];
}

function toGraphNodes(nodes: readonly Node[]): GraphNodeLike[] {
  return nodes
    .filter((node) => node.type && nodeRegistry.has(node.type as StoryNodeType))
    .map((node) => ({
      id: node.id,
      type: node.type as StoryNodeType,
      data: node.data as unknown as GraphNodeLike['data'],
    }));
}

function toGraphEdges(edges: readonly Edge[]): GraphEdgeLike[] {
  return edges
    .filter((edge) => edge.sourceHandle && edge.targetHandle)
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourcePortId: edge.sourceHandle as string,
      target: edge.target,
      targetPortId: edge.targetHandle as string,
    }));
}

export function StoryGraph() {
  const [nodes, , onNodesChange] = useNodesState<Node>(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const validateConnection = useCallback(
    (connection: Connection | Edge) =>
      validateGraphConnection(
        {
          source: connection.source,
          sourcePortId: connection.sourceHandle ?? null,
          target: connection.target,
          targetPortId: connection.targetHandle ?? null,
        },
        toGraphNodes(nodes),
        toGraphEdges(edges),
      ),
    [edges, nodes],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => validateConnection(connection).valid,
    [validateConnection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnection(connection);
      if (!result.valid) {
        setConnectionError(result.diagnostic.message);
        return;
      }

      setConnectionError(null);
      setEdges((currentEdges) =>
        addEdge({ ...connection, id: createStableId('edge') }, currentEdges),
      );
    },
    [setEdges, validateConnection],
  );

  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, connectionState) => {
      const { fromHandle, toHandle } = connectionState;
      if (!fromHandle || !toHandle) return;

      const sourceHandle = fromHandle.type === 'source' ? fromHandle : toHandle;
      const targetHandle = fromHandle.type === 'target' ? fromHandle : toHandle;
      const result = validateConnection({
        source: sourceHandle.nodeId,
        sourceHandle: sourceHandle.id ?? null,
        target: targetHandle.nodeId,
        targetHandle: targetHandle.id ?? null,
      });
      if (!result.valid) setConnectionError(result.diagnostic.message);
    },
    [validateConnection],
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
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
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
        {connectionError && <div className={styles.connectionError}>{connectionError}</div>}
      </div>
    </div>
  );
}
