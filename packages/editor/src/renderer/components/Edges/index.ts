import type { EdgeTypes } from '@xyflow/react';
import { BlueprintSmoothStepEdge } from './BlueprintEdge';

export { BlueprintSmoothStepEdge };

export const edgeTypes: EdgeTypes = {
  smoothstep: BlueprintSmoothStepEdge,
  default: BlueprintSmoothStepEdge,
};
