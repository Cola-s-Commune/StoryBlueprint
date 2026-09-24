import React from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { SnapLine } from '../../graph/storyGraphSnap';
import styles from './AlignmentGuides.module.css';

interface AlignmentGuidesProps {
  lines: readonly SnapLine[];
}

export function AlignmentGuides({ lines }: AlignmentGuidesProps) {
  if (!lines || lines.length === 0) return null;

  return (
    <ViewportPortal>
      <svg className={styles.overlay} aria-hidden="true">
        <defs>
          <filter id="guide-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#38bdf8" floodOpacity="0.8" />
          </filter>
        </defs>
        {lines.map((line) => {
          if (line.orientation === 'horizontal') {
            return (
              <g key={line.id} className={styles.guideGroup}>
                <line
                  x1={line.start}
                  y1={line.coordinate}
                  x2={line.end}
                  y2={line.coordinate}
                  className={styles.guideLine}
                  filter="url(#guide-glow)"
                />
                <circle cx={line.start} cy={line.coordinate} r={2} className={styles.guideCap} />
                <circle cx={line.end} cy={line.coordinate} r={2} className={styles.guideCap} />
                {line.markers.map((markerX, idx) => (
                  <circle
                    key={`${line.id}-m-${idx}`}
                    cx={markerX}
                    cy={line.coordinate}
                    r={3}
                    className={styles.guideMarker}
                  />
                ))}
              </g>
            );
          }

          return (
            <g key={line.id} className={styles.guideGroup}>
              <line
                x1={line.coordinate}
                y1={line.start}
                x2={line.coordinate}
                y2={line.end}
                className={styles.guideLine}
                filter="url(#guide-glow)"
              />
              <circle cx={line.coordinate} cy={line.start} r={2} className={styles.guideCap} />
              <circle cx={line.coordinate} cy={line.end} r={2} className={styles.guideCap} />
              {line.markers.map((markerY, idx) => (
                <circle
                  key={`${line.id}-m-${idx}`}
                  cx={line.coordinate}
                  cy={markerY}
                  r={3}
                  className={styles.guideMarker}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
