'use client';

import { ImageOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { hasRemoteImages, sanitizeForReader } from '@/lib/email/sanitize';

const HEIGHT_MESSAGE = 'iris-iframe-height';

function buildSrcdoc(sanitized: string, allowImages: boolean): string {
  const imgSrc = allowImages ? 'https: data:' : 'data:';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src https: data:;">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; }
  body {
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  table { max-width: 100%; }
</style>
</head>
<body>
${sanitized}
<script>
(function() {
  function send() {
    var h = document.body.scrollHeight;
    parent.postMessage({ type: '${HEIGHT_MESSAGE}', height: h }, '*');
  }
  send();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(send).observe(document.body);
  }
  window.addEventListener('load', send);
})();
</script>
</body>
</html>`;
}

export function HtmlMessageBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [imagesShown, setImagesShown] = useState(false);
  const [height, setHeight] = useState(80);

  const sanitized = useMemo(() => sanitizeForReader(html), [html]);
  const hasImages = useMemo(() => hasRemoteImages(sanitized), [sanitized]);
  const srcdoc = useMemo(() => buildSrcdoc(sanitized, imagesShown), [sanitized, imagesShown]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        typeof event.data !== 'object' ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== HEIGHT_MESSAGE
      ) {
        return;
      }
      const next = (event.data as { height?: unknown }).height;
      if (typeof next === 'number' && next > 0) setHeight(Math.ceil(next));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      {hasImages && !imagesShown && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <ImageOff className="size-3.5" />
            Remote images blocked
          </span>
          <button
            type="button"
            onClick={() => setImagesShown(true)}
            className="rounded-md bg-[var(--surface)] px-2 py-1 text-[var(--text)] hover:brightness-110"
          >
            Show images
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        // Re-mount on toggle so the new CSP applies (CSP is set at document load).
        key={imagesShown ? 'images-on' : 'images-off'}
        title="Message body"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcdoc}
        style={{ width: '100%', height: `${height}px`, border: 0, display: 'block' }}
      />
    </div>
  );
}
