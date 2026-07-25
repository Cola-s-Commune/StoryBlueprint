import { Group, Panel, Separator } from 'react-resizable-panels';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { ResourceBrowser } from '../Panels/ResourceBrowser';
import { StoryGraph } from '../Panels/StoryGraph';
import { Inspector } from '../Panels/Inspector';
import { ConsolePanel } from '../Panels/Console';
import { StoryGraphStoreProvider } from '../../graph/StoryGraphStore';
import styles from './MainLayout.module.css';

export function MainLayout() {
  return (
    <StoryGraphStoreProvider>
      <div className={styles.root}>
        <MenuBar />

        <div className={styles.content}>
          <Group orientation="horizontal">
            {/* Resource Browser */}
            <Panel defaultSize={20} minSize={15} maxSize={30}>
              <ResourceBrowser />
            </Panel>
            <Separator className={styles.resizeHandle} />

            {/* Center: Story Graph + Bottom Console */}
            <Panel defaultSize={60} minSize={40}>
              <Group orientation="vertical">
                <Panel defaultSize={75} minSize={50}>
                  <StoryGraph />
                </Panel>
                <Separator className={styles.resizeHandle} />
                <Panel defaultSize={25} minSize={10} maxSize={40}>
                  <ConsolePanel />
                </Panel>
              </Group>
            </Panel>

            <Separator className={styles.resizeHandle} />

            {/* Inspector */}
            <Panel defaultSize={20} minSize={15} maxSize={35}>
              <Inspector />
            </Panel>
          </Group>
        </div>

        <StatusBar />
      </div>
    </StoryGraphStoreProvider>
  );
}
