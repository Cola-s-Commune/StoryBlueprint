import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DetachedWindowProps {
  id: string;
  title: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  onClose: () => void;
  children: ReactNode;
}

function copyStyles(target: Document): void {
  for (const source of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.head.appendChild(source.cloneNode(true));
  }
}

export function DetachedWindow({
  id,
  title,
  width = 480,
  height = 760,
  x,
  y,
  onClose,
  children,
}: DetachedWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const detachedRef = useRef<Window | null>(null);
  const portalRootRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    const positionFeatures = x === undefined || y === undefined ? '' : `,left=${x},top=${y}`;
    let detached = detachedRef.current;
    if (!detached || detached.closed) {
      detached = window.open(
        'about:blank',
        `story-blueprint-panel-${id}`,
        `popup=yes,width=${width},height=${height}${positionFeatures}`,
      );
    }
    if (!detached) {
      onCloseRef.current();
      return;
    }
    detachedRef.current = detached;

    let portalRoot = portalRootRef.current;
    if (!portalRoot || portalRoot.ownerDocument !== detached.document) {
      detached.document.title = `${title} — Story Blueprint`;
      detached.document.documentElement.style.height = '100%';
      detached.document.body.style.height = '100%';
      detached.document.body.style.margin = '0';
      detached.document.body.style.overflow = 'hidden';
      detached.document.body.style.background = '#1e1e1e';
      copyStyles(detached.document);

      portalRoot = detached.document.createElement('div');
      portalRoot.style.height = '100%';
      detached.document.body.appendChild(portalRoot);
      portalRootRef.current = portalRoot;
    }
    setContainer(portalRoot);

    const handleClose = () => onCloseRef.current();
    detached.addEventListener('beforeunload', handleClose);

    return () => {
      detached.removeEventListener('beforeunload', handleClose);
      closeTimerRef.current = setTimeout(() => {
        if (!detached.closed) detached.close();
        if (detachedRef.current === detached) detachedRef.current = null;
        if (portalRootRef.current === portalRoot) portalRootRef.current = null;
        closeTimerRef.current = null;
      }, 0);
    };
  }, [height, id, title, width, x, y]);

  return container ? createPortal(children, container) : null;
}
