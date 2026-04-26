'use client';

import DOMPurify from 'dompurify';

// Email-safe tag/attr allowlists. The closed-set approach means a body that
// uses something we forgot just renders without it, never breaks the page.
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'area',
  'b',
  'blockquote',
  'body',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'map',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
];

const ALLOWED_ATTR = [
  'href',
  'src',
  'alt',
  'title',
  'name',
  'id',
  'target',
  'rel',
  'width',
  'height',
  'align',
  'valign',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
  'style',
  'class',
  'dir',
  'lang',
];

const FORBID_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'base',
  'meta',
  'link',
  'frame',
  'frameset',
];

// Hook lives on the DOMPurify singleton itself, NOT a module-local flag —
// Next.js HMR resets module state but DOMPurify is imported from node_modules
// and persists across reloads. A module-local guard would let `addHook` stack
// up duplicate handlers across hot reloads.
const HOOK_FLAG = '__irisLinkHookInstalled';
function ensureLinkHook() {
  const purify = DOMPurify as unknown as Record<string, unknown>;
  if (purify[HOOK_FLAG]) return;
  purify[HOOK_FLAG] = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function sanitizeForReader(rawHtml: string): string {
  ensureLinkHook();
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
    USE_PROFILES: { html: true },
  });
}

// True if the sanitized markup contains an <img> referencing a remote URL —
// i.e. there is something the "Show images" toggle would actually unblock.
export function hasRemoteImages(sanitizedHtml: string): boolean {
  return /<img\b[^>]+src=["']https?:\/\//i.test(sanitizedHtml);
}
