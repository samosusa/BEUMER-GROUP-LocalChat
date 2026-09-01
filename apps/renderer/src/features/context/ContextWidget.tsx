import { useEffect, useId, useMemo, useRef } from 'react';
import type { Chat, Document, Project, RetrievalScope } from '@localchat/contracts';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Button, IconButton } from '@/shared/ui/Button';
import { Chip, SegmentedControl, type SegmentedOption } from '@/shared/ui/Controls';
import { Mono, ProgressBar, SectionLabel } from '@/shared/ui/Indicators';
import { formatBytes, formatCount } from '@/shared/lib/format';
import { useUiStore } from '@/shared/store/uiStore';
import { cn } from '@/shared/lib/cn';
import styles from './ContextWidget.module.css';

const SCOPE_OPTIONS: ReadonlyArray<SegmentedOption<RetrievalScope>> = [
  { value: 'general', label: 'General', icon: 'globe' },
  { value: 'project', label: 'Project', icon: 'folder' },
  { value: 'both', label: 'Both', icon: 'union' },
];

const SCOPE_LABEL: Record<RetrievalScope, string> = {
  general: 'General only',
  project: 'Project only',
  both: 'Project + General',
};

const FORMAT_ICON: Record<Document['format'], IconName> = {
  pdf: 'document',
  docx: 'document',
  markdown: 'document',
  text: 'document',
  image: 'image',
};

/** Enough to recognise the corpus without turning a popover into a file manager. */
const CORPUS_PREVIEW = 6;

interface ContextWidgetProps {
  chat: Chat;
  project: Project | undefined;
  /** Every document the chat could attach — project corpus plus general. */
  available: Document[];
  onScopeChange: (scope: RetrievalScope) => void;
  onAttachmentsChange: (attachmentIds: string[]) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
}

/**
 * The context widget. Anchored top-left of the chat, it answers the only question an
 * engineer has before trusting an answer: *what did it just search?*
 *
 * One click opens it, a second changes the scope — the two-click budget the requirements
 * set. Attachments here are scoped to this chat; the project corpus is edited on the
 * project screen, and the copy says so, because confusing the two loses work.
 */
export function ContextWidget({
  chat,
  project,
  available,
  onScopeChange,
  onAttachmentsChange,
  onAddFiles,
  onAddFolder,
}: ContextWidgetProps) {
  const open = useUiStore((state) => state.contextPanelOpen);
  const setOpen = useUiStore((state) => state.setContextPanelOpen);
  const rememberRemoval = useUiStore((state) => state.rememberRemoval);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const attached = useMemo(
    () => chat.attachmentIds.map((id) => available.find((doc) => doc.id === id)).filter(isDocument),
    [chat.attachmentIds, available],
  );

  // Close on outside click and on Escape — a popover that traps the engineer is a bug.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  function detach(document: Document) {
    rememberRemoval({ chatId: chat.id, documentId: document.id, title: document.title });
    onAttachmentsChange(chat.attachmentIds.filter((id) => id !== document.id));
  }

  const empty = attached.length === 0;
  /** Nothing pinned AND nothing indexed: the only state where there is truly no context. */
  const nothingToSearch = empty && available.length === 0;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={cn(
          styles.trigger,
          nothingToSearch && styles.triggerEmpty,
          open && styles.triggerOpen,
        )}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <Icon name="database" size={15} className={styles.triggerIcon} />
        {nothingToSearch ? (
          <span className={styles.triggerEmptyLabel}>No documents yet</span>
        ) : (
          <>
            <span className={styles.triggerLabel}>Context</span>
            <Mono className={styles.scopeBadge}>{SCOPE_LABEL[chat.scope]}</Mono>
            {/*
              With nothing pinned the chat still searches the whole corpus, so counting
              only pinned files reported "no context" while the answer was being drawn
              out of an indexed document. Say what is actually being searched.
            */}
            <span className={styles.triggerCount}>
              {empty
                ? `${available.length} ${available.length === 1 ? 'document' : 'documents'}`
                : `${attached.length} ${attached.length === 1 ? 'file' : 'files'}`}
            </span>
          </>
        )}
        <Icon name="chevronDown" size={14} strokeWidth={2} className={styles.triggerChevron} />
      </button>

      <IconButton
        icon="plus"
        label="Add documents to this chat"
        variant="accent"
        size={13}
        className={styles.addButton}
        onClick={onAddFiles}
      />

      <div className={styles.chips}>
        {attached.slice(0, 2).map((document) => (
          <Chip
            key={document.id}
            icon={FORMAT_ICON[document.format]}
            maxWidth={190}
            onRemove={() => detach(document)}
            removeLabel={`Remove ${document.title} from context`}
          >
            {document.title}
          </Chip>
        ))}
        {attached.length > 2 && (
          <button type="button" className={styles.more} onClick={() => setOpen(true)}>
            +{attached.length - 2}
          </button>
        )}
      </div>

      {open && (
        <div className={styles.panel} id={panelId} role="dialog" aria-label="Chat context">
          <section className={styles.panelSection}>
            <SectionLabel>What should LocalChat search?</SectionLabel>
            <SegmentedControl
              options={project ? SCOPE_OPTIONS : SCOPE_OPTIONS.filter((o) => o.value === 'general')}
              value={chat.scope}
              onChange={onScopeChange}
              label="Retrieval scope"
            />
            <p className={styles.scopeExplainer}>{explainScope(chat.scope, project)}</p>
          </section>

          <section className={styles.panelSection}>
            <SectionLabel
              action={<Mono className={styles.attachedCount}>{attached.length} of 20</Mono>}
            >
              Attached to this chat
            </SectionLabel>

            {empty ? (
              <p className={styles.panelEmpty}>
                Nothing pinned. This chat searches the whole{' '}
                {chat.scope === 'general' ? 'general corpus' : 'project corpus'}.
              </p>
            ) : (
              <ul className={styles.fileList}>
                {attached.map((document) => (
                  <li key={document.id} className={styles.fileRow}>
                    <Icon
                      name={FORMAT_ICON[document.format]}
                      size={15}
                      className={cn(styles.fileIcon, styles[`format_${document.format}`])}
                    />
                    <span className={styles.fileText}>
                      <span className={styles.fileName}>{document.filename}</span>
                      <Mono className={styles.fileMeta}>{describeDocument(document)}</Mono>
                    </span>
                    {document.status === 'indexing' && document.progress !== null ? (
                      <div className={styles.fileProgress}>
                        <ProgressBar value={document.progress} thickness={2} label="Indexing" />
                      </div>
                    ) : (
                      <IconButton
                        icon="close"
                        label={`Remove ${document.title} from context`}
                        size={14}
                        onClick={() => detach(document)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panelSection}>
            <SectionLabel action={<Mono className={styles.attachedCount}>{available.length}</Mono>}>
              {chat.scope === 'project' && project ? `${project.name} corpus` : 'General corpus'}
            </SectionLabel>

            {available.length === 0 ? (
              <p className={styles.panelEmpty}>
                Nothing indexed yet. Add a file and it becomes searchable from here.
              </p>
            ) : (
              <>
                <ul className={styles.fileList}>
                  {available.slice(0, CORPUS_PREVIEW).map((document) => (
                    <li key={document.id} className={styles.fileRow}>
                      <Icon
                        name={FORMAT_ICON[document.format]}
                        size={15}
                        className={cn(styles.fileIcon, styles[`format_${document.format}`])}
                      />
                      <span className={styles.fileText}>
                        <span className={styles.fileName}>{document.filename}</span>
                        <Mono className={styles.fileMeta}>{describeDocument(document)}</Mono>
                      </span>
                      {document.status === 'indexing' && document.progress !== null && (
                        <div className={styles.fileProgress}>
                          <ProgressBar value={document.progress} thickness={2} label="Indexing" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {available.length > CORPUS_PREVIEW && (
                  <p className={styles.panelEmpty}>and {available.length - CORPUS_PREVIEW} more</p>
                )}
              </>
            )}
          </section>

          <footer className={styles.panelFooter}>
            <Button variant="accent" size="sm" icon="plus" onClick={onAddFiles}>
              Add files
            </Button>
            <Button variant="outline" size="sm" icon="folder" onClick={onAddFolder}>
              Add folder
            </Button>
            <span className={styles.spacer} />
            <Button
              variant="danger"
              size="sm"
              onClick={() => onAttachmentsChange([])}
              disabled={empty}
            >
              Clear all
            </Button>
          </footer>
        </div>
      )}
    </div>
  );
}

function explainScope(scope: RetrievalScope, project: Project | undefined): string {
  if (scope === 'general') return 'Searching company-wide documentation only.';
  if (!project) return 'Searching company-wide documentation.';
  if (scope === 'project') return `Searching ${project.name} only.`;
  return `Searching ${project.name} first, then falling back to company-wide documentation.`;
}

function describeDocument(document: Document): string {
  if (document.status === 'no_text_layer') return 'no text layer — cannot be cited';
  if (document.status === 'indexing') return 'indexing…';
  if (document.format === 'image') return '1 figure · described on retrieval';

  // A backend that does not report chunk counts or file sizes sends zeroes. Printing
  // "0 chunks · 0 B" beside a document that just answered a question reads as a fault in
  // the index rather than a gap in what the service tells us, so those are dropped.
  const parts: string[] = [];
  if (document.chunkCount > 0) parts.push(`${formatCount(document.chunkCount)} chunks`);
  if (document.revision) parts.push(document.revision);
  if (document.sizeBytes > 0) parts.push(formatBytes(document.sizeBytes));
  if (parts.length === 0) parts.push(document.indexedAt ? 'indexed' : 'not indexed yet');
  return parts.join(' · ');
}

function isDocument(value: Document | undefined): value is Document {
  return value !== undefined;
}
