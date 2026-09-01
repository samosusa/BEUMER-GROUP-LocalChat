import { useEffect, useRef, useState } from 'react';
import { useChats, useProjects } from '@/shared/api/queries';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import styles from './QuickAsk.module.css';

/**
 * The quick-ask strip: a frameless, always-on-top window summoned by the global hotkey.
 *
 * It does one thing — take a question and hand it to the main window. It deliberately does
 * not answer in place, because an answer without its sources block is the one thing this
 * product must never show, and there is no room for a sources block in 108 pixels.
 */
export function QuickAskPage() {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chats = useChats();
  const projects = useProjects();

  // The window is shown and hidden rather than created each time, so focus is taken here.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const lastChat = chats.data?.[0];
  const project = projects.data?.find((entry) => entry.id === lastChat?.projectId);

  function submit() {
    const question = value.trim();
    if (!question) return;
    window.localchat?.submitQuickAsk?.(question);
    setValue('');
  }

  return (
    <div className={styles.strip}>
      <span className={styles.mark} aria-hidden="true">
        <Icon name="chat" size={16} strokeWidth={2.4} />
      </span>

      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        placeholder={project ? `Ask about ${project.name}…` : 'Ask about your documentation…'}
        aria-label="Quick ask"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') window.localchat?.window.hide();
        }}
      />

      <span className={styles.scope}>
        <Icon name={project ? 'folder' : 'globe'} size={12} />
        {project ? 'Project' : 'General'}
      </span>

      <Mono className={styles.hint}>Esc to dismiss</Mono>
    </div>
  );
}
