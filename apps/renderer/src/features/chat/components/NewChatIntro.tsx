import type { Project, RetrievalScope } from '@localchat/contracts';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import { cn } from '@/shared/lib/cn';
import styles from './NewChatIntro.module.css';

interface NewChatIntroProps {
  projects: Project[];
  activeProjectId: string | null;
  scope: RetrievalScope;
  generalDocumentCount: number;
  onScopeChange: (scope: RetrievalScope, projectId: string | null) => void;
  onDropFiles: () => void;
}

/**
 * The empty state. It leads with the scope choice rather than the text box, because picking
 * what to search is the decision that determines whether the first answer is any good.
 */
export function NewChatIntro({
  projects,
  activeProjectId,
  scope,
  generalDocumentCount,
  onScopeChange,
  onDropFiles,
}: NewChatIntroProps) {
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const projectDocumentCount = activeProject?.documentCount ?? 0;

  return (
    <div className={styles.intro}>
      <div className={styles.column}>
        <header className={styles.header}>
          <h1 className={styles.title}>What do you need from the documentation?</h1>
          <p className={styles.subtitle}>
            Every answer cites the document, section and page it came from.
          </p>
        </header>

        <div className={styles.scopes} role="radiogroup" aria-label="What to search">
          <ScopeCard
            icon="globe"
            title="General"
            description="Company-wide manuals, standards and procedures."
            count={`${generalDocumentCount} documents`}
            selected={scope === 'general'}
            onSelect={() => onScopeChange('general', null)}
          />
          <ScopeCard
            icon="folder"
            title="Project"
            description={activeProject?.name ?? 'Pick a project from the sidebar.'}
            count={activeProject ? `${projectDocumentCount} documents` : 'none selected'}
            selected={scope === 'project'}
            disabled={!activeProject}
            onSelect={() => onScopeChange('project', activeProjectId)}
          />
          <ScopeCard
            icon="union"
            title="Both"
            description="Project first, then fall back to general."
            count={`${projectDocumentCount + generalDocumentCount} documents`}
            selected={scope === 'both'}
            disabled={!activeProject}
            onSelect={() => onScopeChange('both', activeProjectId)}
          />
        </div>

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

function ScopeCard({
  icon,
  title,
  description,
  count,
  selected,
  disabled = false,
  onSelect,
}: {
  icon: 'globe' | 'folder' | 'union';
  title: string;
  description: string;
  count: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={cn(styles.scope, selected && styles.scopeSelected)}
      onClick={onSelect}
    >
      <span className={styles.scopeHead}>
        <Icon name={icon} size={17} className={styles.scopeIcon} />
        <span className={styles.scopeTitle}>{title}</span>
        {selected && (
          <Icon name="check" size={16} strokeWidth={2.4} className={styles.scopeCheck} />
        )}
      </span>
      <span className={styles.scopeDescription}>{description}</span>
      <Mono className={styles.scopeCount}>{count}</Mono>
    </button>
  );
}
