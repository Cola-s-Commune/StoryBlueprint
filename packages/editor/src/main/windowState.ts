export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState extends WindowRectangle {
  maximized: boolean;
}

const MIN_VISIBLE_EDGE = 80;

export function isPersistedWindowState(value: unknown): value is PersistedWindowState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<PersistedWindowState>;
  return (
    Number.isInteger(state.x) &&
    Number.isInteger(state.y) &&
    Number.isInteger(state.width) &&
    Number.isInteger(state.height) &&
    state.width! >= 320 &&
    state.height! >= 240 &&
    state.width! <= 50_000 &&
    state.height! <= 50_000 &&
    typeof state.maximized === 'boolean'
  );
}

function intersectionArea(left: WindowRectangle, right: WindowRectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  if (width < MIN_VISIBLE_EDGE || height < MIN_VISIBLE_EDGE) return 0;
  return width * height;
}

function fitWithinWorkArea(bounds: WindowRectangle, workArea: WindowRectangle): WindowRectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

export function resolveWindowBounds(
  stored: PersistedWindowState | undefined,
  workAreas: readonly WindowRectangle[],
  primaryWorkArea: WindowRectangle,
  defaultSize: Pick<WindowRectangle, 'width' | 'height'>,
): WindowRectangle {
  if (stored) {
    const target = workAreas
      .map((workArea) => ({ workArea, area: intersectionArea(stored, workArea) }))
      .sort((left, right) => right.area - left.area)[0];
    if (target && target.area > 0) return fitWithinWorkArea(stored, target.workArea);
  }

  const width = Math.min(defaultSize.width, primaryWorkArea.width);
  const height = Math.min(defaultSize.height, primaryWorkArea.height);
  return {
    x: primaryWorkArea.x + Math.round((primaryWorkArea.width - width) / 2),
    y: primaryWorkArea.y + Math.round((primaryWorkArea.height - height) / 2),
    width,
    height,
  };
}
