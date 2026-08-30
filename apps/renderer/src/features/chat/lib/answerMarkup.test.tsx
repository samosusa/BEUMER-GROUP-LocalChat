import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseAnswer } from './answerMarkup';

function renderAnswer(source: string) {
  const blocks = parseAnswer(source);
  return render(
    <div data-testid="answer">
      {blocks.map((block, index) => (
        <p key={index} data-kind={block.kind}>
          {block.content}
        </p>
      ))}
    </div>,
  );
}

describe('parseAnswer', () => {
  it('renders model output as text, never as markup', () => {
    // The single most important test in this file: answers are untrusted text.
    renderAnswer('Check <img src=x onerror="alert(1)"> the manual.');
    const answer = screen.getByTestId('answer');
    expect(answer.querySelector('img')).toBeNull();
    expect(answer).toHaveTextContent('Check <img src=x onerror="alert(1)"> the manual.');
  });

  it('marks bold and inline code', () => {
    const { container } = renderAnswer(
      'Rated at **13,200 items/hour** when `CHUTE_FULL` is clear.',
    );
    expect(container.querySelector('strong')).toHaveTextContent('13,200 items/hour');
    expect(container.querySelector('code')).toHaveTextContent('CHUTE_FULL');
  });

  it('turns [n] into a citation marker carrying its number', () => {
    const { container } = renderAnswer('Speed is capped at 1.2 m/s.[3]');
    const marker = container.querySelector('[data-citation-marker]');
    expect(marker).toHaveTextContent('[3]');
    expect((marker as HTMLElement).dataset.citationMarker).toBe('3');
    // Keyboard reachable, because a citation is the thing people actually want to jump to.
    expect(marker?.tagName).toBe('BUTTON');
  });

  it('classifies bullets separately from paragraphs', () => {
    const blocks = parseAnswer(
      ['Two conditions:', '', '- First one.[1]', '- Second one.'].join('\n'),
    );
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'bullet', 'bullet']);
  });

  it('drops blank lines rather than emitting empty paragraphs', () => {
    expect(parseAnswer('One.\n\n\nTwo.')).toHaveLength(2);
  });

  it('leaves an unmatched marker alone instead of throwing', () => {
    const { container } = renderAnswer('A stray bracket [ and a number 3.');
    expect(container.querySelector('sup')).toBeNull();
    expect(screen.getByTestId('answer')).toHaveTextContent('A stray bracket [ and a number 3.');
  });
});
