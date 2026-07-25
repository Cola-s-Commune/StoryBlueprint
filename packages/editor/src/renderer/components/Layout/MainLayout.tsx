import { useCallback, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { DetachedWindow } from './DetachedWindow';
import { ResourceBrowser } from '../Panels/ResourceBrowser';
import { StoryGraph } from '../Panels/StoryGraph';
import { Inspector } from '../Panels/Inspector';
import { ConsolePanel } from '../Panels/Console';
import { StoryGraphStoreProvider } from '../../graph/StoryGraphStore';
import styles from './MainLayout.module.css';

interface FloatingPanels {
  resources: boolean;
  inspector: boolean;
  console: boolean;
}

export function MainLayout() {
  const [floating, setFloating] = useState<FloatingPanels>({
    resources: false,
    inspector: false,
    console: false,
  });

  const floatResources = useCallback(
    () => setFloating((state) => ({ ...state, resources: true })),
    [],
  );
  const dockResources = useCallback(
    () => setFloating((state) => ({ ...state, resources: false })),
    [],
  );
  const floatInspector = useCallback(
    () => setFloating((state) => ({ ...state, inspector: true })),
    [],
  );
  const dockInspector = useCallback(
    () => setFloating((state) => ({ ...state, inspector: false })),
    [],
  );
  const floatConsole = useCallback(() => setFloating((state) => ({ ...state, console: true })), []);
  const dockConsole = useCallback(() => setFloating((state) => ({ ...state, console: false })), []);

  return (
    <StoryGraphStoreProvider>
      <div className={styles.root}>
        <MenuBar />

        <div className={styles.content}>
          <Group orientation="horizontal">
            {!floating.resources && (
              <>
                <Panel id="resources" defaultSize={18} minSize={14} maxSize={32}>
                  <ResourceBrowser onToggleFloating={floatResources} />
                </Panel>
                <Separator className={styles.resizeHandle} />
              </>
            )}

            <Panel id="center" defaultSize={54} minSize={35}>
              <Group orientation="vertical">
                <Panel id="graph" defaultSize={floating.console ? 100 : 75} minSize={45}>
                  <StoryGraph />
                </Panel>
                {!floating.console && (
                  <>
                    <Separator className={styles.resizeHandle} />
                    <Panel id="console" defaultSize={25} minSize={10} maxSize={45}>
                      <ConsolePanel onToggleFloating={floatConsole} />
                    </Panel>
                  </>
                )}
              </Group>
            </Panel>

            {!floating.inspector && (
              <>
                <Separator className={styles.resizeHandle} />
                <Panel id="inspector" defaultSize={28} minSize={22} maxSize={45}>
                  <Inspector onToggleFloating={floatInspector} />
                </Panel>
              </>
            )}
          </Group>
        </div>

        <StatusBar />
      </div>

      {floating.resources && (
        <DetachedWindow
          id="resources"
          title="Resource Browser"
          width={420}
          height={720}
          onClose={dockResources}
        >
          <ResourceBrowser floating onToggleFloating={dockResources} />
        </DetachedWindow>
      )}
      {floating.inspector && (
        <DetachedWindow
          id="inspector"
          title="Inspector"
          width={520}
          height={820}
          onClose={dockInspector}
        >
          <Inspector floating onToggleFloating={dockInspector} />
        </DetachedWindow>
      )}
      {floating.console && (
        <DetachedWindow id="console" title="Console" width={760} height={420} onClose={dockConsole}>
          <ConsolePanel floating onToggleFloating={dockConsole} />
        </DetachedWindow>
      )}
    </StoryGraphStoreProvider>
  );
}
