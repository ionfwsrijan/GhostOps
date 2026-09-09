import { useEffect, useRef, useState } from 'react';
import { LiveEvent } from '@/api/types';
import { eventsUrl } from '@/api/client';

/**
 * Subscribes to the GhostOps SSE stream. Supports both:
 *  - global stream (no incidentId) for dashboard-wide updates
 *  - per-incident stream for the investigation workspace
 */
export function useLiveEvents(opts?: { incidentId?: string; onEvent?: (evt: LiveEvent) => void }) {
  const [connected, setConnected] = useState(false);
  const [event, setEvent] = useState<LiveEvent | null>(null);
  const handlerRef = useRef(opts?.onEvent);
  handlerRef.current = opts?.onEvent;

  useEffect(() => {
    let retry = 0;
    let es: EventSource | null = null;
    let alive = true;

    const connect = () => {
      es = new EventSource(eventsUrl(opts?.incidentId));
      es.onopen = () => {
        setConnected(true);
        retry = 0;
      };
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as LiveEvent;
          setEvent(evt);
          handlerRef.current?.(evt);
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        setConnected(false);
        if (alive) {
          retry += 1;
          const delay = Math.min(3000 * retry, 15000);
          setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      alive = false;
      es?.close();
    };
  }, [opts?.incidentId]);

  return { connected, event };
}