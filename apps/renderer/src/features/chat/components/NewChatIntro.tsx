import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import styles from './NewChatIntro.module.css';

interface NewChatIntroProps {
  onDropFiles: () => void;
}

/** The empty state, shown before a chat has any messages. */
export function NewChatIntro({ onDropFiles }: NewChatIntroProps) {
  return (
    <div className={styles.intro}>
      <div className={styles.column}>
        <header className={styles.header}>
          <h1 className={styles.title}>What do you need from the documentation?</h1>
          <p className={styles.subtitle}>
            Every answer cites the document, section and page it came from.
          </p>
        </header>

        <div className={styles.lower}>
          <button type="button" className={styles.dropzone} onClick={onDropFiles}>
            <Icon name="upload" size={26} strokeWidth={1.6} />
            <span className={styles.dropTitle}>Drop documents here</span>
            <Mono className={styles.dropHint}>PDF, DOCX, Markdown, TXT</Mono>
          </button>
        </div>
      </div>
    </div>
  );
}
