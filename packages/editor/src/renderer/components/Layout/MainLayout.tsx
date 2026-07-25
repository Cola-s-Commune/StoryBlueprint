import { useCallback, useRef } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { ResourceBrowser } from '../Panels/ResourceBrowser';
import { StoryGraph } from '../Panels/StoryGraph';
import { Inspector } from '../Panels/Inspector';
import { ConsolePanel } from '../Panels/Console';
import { StoryData } from '../Panels/StoryData';
import { StoryGraphStoreProvider } from '../../graph/StoryGraphStore';
import styles from './MainLayout.module.css';

const layoutStorageKey = 'story-blueprint:dock-layout:v2';

const dockComponents = {
  resources: (_props: IDockviewPanelProps) => <ResourceBrowser />,
  storyData: (_props: IDockviewPanelProps) => <StoryData />,
  graph: (_props: IDockviewPanelProps) => <StoryGraph />,
  inspector: (_props: IDockviewPanelProps) => <Inspector />,
  console: (_props: IDockviewPanelProps) => <ConsolePanel />,
};

function dockPosition(panelId: string): 'left' | 'right' | 'bottom' {
  if (panelId === 'resources' || panelId === 'storyData') return 'left';
  if (panelId === 'console') return 'bottom';
  return 'right';
}

function createDefaultLayout(api: DockviewApi) {
  api.clear();
  const graph = api.addPanel({
    id: 'graph',
    component: 'graph',
    title: 'Story Graph',
    minimumWidth: 420,
  });
  const resources = api.addPanel({
    id: 'resources',
    component: 'resources',
    title: 'Resource Browser',
    position: { referencePanel: 'graph', direction: 'left' },
    initialWidth: 240,
    minimumWidth: 190,
    maximumWidth: 420,
  });
  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: 'graph', direction: 'right' },
    initialWidth: 420,
    minimumWidth: 360,
    maximumWidth: 720,
  });
  const storyData = api.addPanel({
    id: 'storyData',
    component: 'storyData',
    title: 'Story Data',
    position: { referencePanel: 'resources', direction: 'below' },
    initialHeight: 320,
    minimumHeight: 160,
  });
  const consolePanel = api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    position: { referencePanel: 'graph', direction: 'below' },
    initialHeight: 230,
    minimumHeight: 120,
  });

  resources.api.group.api.setSize({ width: 240 });
  storyData.api.group.api.setSize({ height: 320 });
  inspector.api.group.api.setSize({ width: 420 });
  consolePanel.api.group.api.setSize({ height: 230 });
  graph.api.setActive();
}

type DockPanelId = keyof typeof dockComponents;

function showPanel(api: DockviewApi, panelId: DockPanelId) {
  const existing = api.getPanel(panelId);
  if (existing) {
    existing.api.setActive();
    return;
  }

  const graph = api.getPanel('graph');
  const common = { id: panelId, component: panelId };
  switch (panelId) {
    case 'graph':
      api.addPanel({ ...common, title: 'Story Graph', minimumWidth: 420 });
      break;
    case 'resources':
      api.addPanel({
        ...common,
        title: 'Resource Browser',
        ...(graph && { position: { referencePanel: graph, direction: 'left' as const } }),
        initialWidth: 240,
        minimumWidth: 190,
        maximumWidth: 420,
      });
      break;
    case 'storyData': {
      const resources = api.getPanel('resources');
      api.addPanel({
        ...common,
        title: 'Story Data',
        ...((resources ?? graph) && {
          position: { referencePanel: resources ?? graph!, direction: 'below' as const },
        }),
        initialHeight: 320,
        minimumHeight: 160,
      });
      break;
    }
    case 'inspector':
      api.addPanel({
        ...common,
        title: 'Inspector',
        ...(graph && { position: { referencePanel: graph, direction: 'right' as const } }),
        initialWidth: 420,
        minimumWidth: 360,
        maximumWidth: 720,
      });
      break;
    case 'console':
      api.addPanel({
        ...common,
        title: 'Console',
        ...(graph && { position: { referencePanel: graph, direction: 'below' as const } }),
        initialHeight: 230,
        minimumHeight: 120,
      });
      break;
  }
}

function readSavedLayout(): SerializedDockview | undefined {
  try {
    const serialized = localStorage.getItem(layoutStorageKey);
    return serialized ? (JSON.parse(serialized) as SerializedDockview) : undefined;
  } catch {
    localStorage.removeItem(layoutStorageKey);
    return undefined;
  }
}

export function MainLayout() {
  const dockApiRef = useRef<DockviewApi>();

  const resetLayout = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    localStorage.removeItem(layoutStorageKey);
    createDefaultLayout(api);
  }, []);

  const showDockPanel = useCallback((panelId: DockPanelId) => {
    const api = dockApiRef.current;
    if (api) showPanel(api, panelId);
  }, []);

  const onDockReady = useCallback((event: DockviewReadyEvent) => {
    dockApiRef.current = event.api;
    const savedLayout = readSavedLayout();

    if (savedLayout) {
      try {
        event.api.fromJSON(savedLayout);
      } catch {
        localStorage.removeItem(layoutStorageKey);
        createDefaultLayout(event.api);
      }
    } else {
      createDefaultLayout(event.api);
    }

    event.api.onDidLayoutChange(() => {
      localStorage.setItem(layoutStorageKey, JSON.stringify(event.api.toJSON()));
    });
  }, []);

  return (
    <StoryGraphStoreProvider>
      <div className={styles.root}>
        <MenuBar onResetLayout={resetLayout} onShowPanel={showDockPanel} />
        <div className={styles.content}>
          <DockviewReact
            className="dockview-theme-dark"
            components={dockComponents}
            dndStrategy="pointer"
            floatingGroupBounds="boundedWithinViewport"
            floatingGroupDragHandle="titlebar"
            keyboardNavigation
            getTabContextMenuItems={({ api, panel }) => {
              const isFloating = panel.api.location.type === 'floating';
              const dockTarget = api.panels.find(
                (candidate) => candidate.id !== panel.id && candidate.api.location.type === 'grid',
              );
              return [
                isFloating
                  ? {
                      label: 'Dock Panel',
                      disabled: !dockTarget,
                      action: () =>
                        dockTarget &&
                        panel.api.moveTo({
                          group: dockTarget.group,
                          position: dockPosition(panel.id),
                        }),
                    }
                  : {
                      label: 'Float Panel',
                      action: () =>
                        api.addFloatingGroup(panel, {
                          width:
                            panel.id === 'inspector' ? 520 : panel.id === 'storyData' ? 360 : 480,
                          height: panel.id === 'console' ? 380 : 640,
                        }),
                    },
                'separator',
                'close',
              ];
            }}
            onReady={onDockReady}
          />
        </div>
        <StatusBar />
      </div>
    </StoryGraphStoreProvider>
  );
}
