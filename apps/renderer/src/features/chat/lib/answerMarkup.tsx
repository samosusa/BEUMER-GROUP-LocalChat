import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately tiny Markdown subset: paragraphs, bullets, `**bold**`, `` `code` `` and
 * `[n]` citation markers.
 *
 * Not a general Markdown renderer, and not `dangerouslySetInnerHTML`. The model's output is
 * untrusted text; parsing a fixed grammar into React nodes means a document that contains
 * `<img onerror=...>` renders as the characters an engineer typed, never as markup.
 */

export interface AnswerBlock {
  kind: 'paragraph' | 'bullet';
  content: ReactNode;
}

export function parseAnswer(source: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;

    const bullet = /^[-*]\s+(.*)$/.exec(line.trimStart());
    if (bullet) {
      blocks.push({ kind: 'bullet', content: parseInline(bullet[1] ?? '') });
    } else {
      blocks.push({ kind: 'paragraph', content: parseInline(line) });
    }
  }

  return blocks;
}

/** Bold, inline code and citation markers, in one pass so nesting cannot go wrong. */
const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[\d+\])/g;

function parseInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const [token] = match;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<CitationMarker key={key++} marker={Number.parseInt(token.slice(1, -1), 10)} />);
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <Fragment>{nodes}</Fragment>;
}

/**
 * A citation marker is a real button so it is keyboard reachable, but it carries no handler:
 * the answer body listens once and resolves the target from `data-citation-marker`. One
 * listener instead of one per marker, and the parser stays a pure function of its input.
 */
function CitationMarker({ marker }: { marker: number }) {
  return (
    <sup>
      <button type="button" data-citation-marker={marker} aria-label={`Jump to source ${marker}`}>
        [{marker}]
      </button>
    </sup>
  );
}
