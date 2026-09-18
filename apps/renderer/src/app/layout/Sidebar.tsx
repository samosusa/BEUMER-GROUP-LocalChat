import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import type { Chat, ComputeMode } from '@localchat/contracts';
import {
  useActiveModel,
  useChats,
  useDeleteAllChats,
  useDeleteChat,
  useHealth,
  useModels,
  useSettings,
} from '@/shared/api/queries';
import { Button, IconButton } from '@/shared/ui/Button';
import { SearchField } from '@/shared/ui/Controls';
import { DangerAction } from '@/shared/ui/DangerAction';
import { Icon } from '@/shared/ui/Icon';
import { Mono, SectionLabel } from '@/shared/ui/Indicators';
import { formatBytes, historyBucket } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useUiStore } from '@/shared/store/uiStore';
import styles from './Sidebar.module.css';

const BUCKET_LABELS = {
  today: 'Today',
  week: 'Previous 7 days',
  month: 'Previous 30 days',
  older: 'Older',
} as const;

export function Sidebar() {
  const navigate = useNavigate();
  const { chatId } = useParams();
  const [search, setSearch] = useState('');
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const health = useHealth();
  const settings = useSettings();
  const activeModelState = useActiveModel();
  const models = useModels();
  const chats = useChats({ query: search || undefined });
  const deleteChat = useDeleteChat();
  const deleteAllChats = useDeleteAllChats();
  // Which chat row is asking to be confirmed. Deleting cascades the chat's messages on
  // both backends and there is no undo, so the choice has to be made before, not after —
  // an inline confirm in place of the row rather than a toast with a fading window.
  const [confirmingChatId, setConfirmingChatId] = useState<string | null>(null);

  const grouped = useMemo(() => groupChats(chats.data ?? []), [chats.data]);
  const activeModel = models.data?.find(
    (model) => model.id === activeModelState.data?.activeModelId,
  );
  // Distinct from "still fetching": once both queries have settled, a model that isn't
  // active yet is a real state — the picker starts with nothing loaded — not a stuck spinner.
  const modelLabel =
    !activeModelState.data || !models.data
      ? 'Loading model…'
      : (activeModel?.name ?? 'No model selected');

  function handleDeleteChat(chat: Chat) {
    setConfirmingChatId(null);
    deleteChat.mutate(chat.id, {
      onSuccess: () => {
        if (chat.id === chatId) navigate('/chat');
      },
    });
  }

  function handleDeleteAllChats() {
    deleteAllChats.mutate(undefined, {
      onSuccess: () => navigate('/chat'),
    });
  }

  if (collapsed) {
    return (
      <nav className={cn(styles.sidebar, styles.sidebarCollapsed)} aria-label="Chats and projects">
        <div className={styles.railTop}>
          <span className={styles.mark} aria-hidden="true">
            <Icon name="chat" size={15} strokeWidth={2.4} />
          </span>
          <IconButton icon="plus" label="New chat" onClick={() => navigate('/chat')} />
          <IconButton
            icon="folder"
            label="Documents & Projects"
            onClick={() => navigate('/projects')}
          />
        </div>
        <div className={styles.railBottom}>
          <IconButton icon="settings" label="Settings" onClick={() => navigate('/settings')} />
          <IconButton icon="chevronRight" label="Expand sidebar" onClick={toggleSidebar} />
        </div>
      </nav>
    );
  }

  return (
    <nav className={styles.sidebar} aria-label="Chats and projects">
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <Icon name="chat" size={15} strokeWidth={2.4} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>BEUMER LocalChat</span>
            <Mono className={styles.brandVersion}>
              {health.data?.version ?? window.localchat?.appVersion ?? '0.4.1'}
            </Mono>
          </span>
          <IconButton
            icon="chevronLeft"
            label="Collapse sidebar"
            className={styles.collapseToggle}
            onClick={toggleSidebar}
          />
        </div>

        <OfflineBadge offline={health.data?.offline ?? settings.data?.strictOffline ?? true} />

        <Button variant="cta" size="lg" icon="plus" fullWidth onClick={() => navigate('/chat')}>
          New chat
        </Button>

        <div className={styles.searchRow}>
          <div className={styles.searchField}>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search chats"
              label="Search chats"
            />
          </div>
          {/* Ambiguous what "all" would mean while a search is narrowing the list, so this
              only acts — and is only enabled — on the true, unfiltered set of chats. */}
          <DangerAction
            label="Delete all chats"
            confirmText={`Delete all ${chats.data?.length ?? 0} chats? This can't be undone.`}
            pending={deleteAllChats.isPending}
            disabled={Boolean(search) || !chats.data?.length}
            onConfirm={handleDeleteAllChats}
          />
        </div>
      </header>

      <div className={styles.scroll}>
        <NavLink
          to="/projects"
          className={({ isActive }) => cn(styles.row, isActive && styles.rowActive)}
        >
          <Icon name="folder" size={15} className={styles.rowIcon} />
          <span className={styles.rowLabel}>Documents &amp; Projects</span>
        </NavLink>

        {grouped.map(([bucket, entries]) => (
          <section className={styles.section} key={bucket}>
            <SectionLabel>{BUCKET_LABELS[bucket]}</SectionLabel>
            <ul>
              {entries.map((chat) =>
                confirmingChatId === chat.id ? (
                  <li key={chat.id} className={cn(styles.row, styles.confirmRow)}>
                    <span className={styles.confirmText}>
                      Delete <strong>{chat.title}</strong>? This can't be undone.
                    </span>
                    <span className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.confirmCancel}
                        onClick={() => setConfirmingChatId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.confirmDelete}
                        disabled={deleteChat.isPending}
                        onClick={() => handleDeleteChat(chat)}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ) : (
                  <li key={chat.id} className={styles.chatRow}>
                    <NavLink
                      to={`/chat/${chat.id}`}
                      className={({ isActive }) => cn(styles.row, isActive && styles.rowActive)}
                    >
                      <span className={styles.rowLabel}>{chat.title}</span>
                    </NavLink>
                    <IconButton
                      icon="trash"
                      label={`Delete “${chat.title}”`}
                      size={13}
                      className={styles.rowDelete}
                      onClick={() => setConfirmingChatId(chat.id)}
                    />
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}

        {chats.isSuccess && chats.data.length === 0 && (
          <p className={styles.noResults}>
            {search ? `No chats match “${search}”.` : 'No chats yet.'}
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        <NavLink to="/settings" className={styles.modelChip}>
          <Icon
            name={activeModelState.data?.compute === 'gpu' ? 'gpu' : 'cpu'}
            size={14}
            className={styles.modelIcon}
          />
          <span className={styles.modelText}>
            <span className={styles.modelName}>{modelLabel}</span>
            <Mono className={styles.modelMeta}>
              {computeLabel(activeModelState.data?.compute, settings.data)}
            </Mono>
          </span>
          <Icon name="chevronDown" size={13} className={styles.modelChevron} />
        </NavLink>

        <div className={styles.user}>
          <IconButton
            icon="settings"
            label="Settings"
            // The generic settings button opens the first section, not a specific one.
            onClick={() => navigate('/settings')}
          />
        </div>
      </footer>
    </nav>
  );
}

function OfflineBadge({ offline }: { offline: boolean }) {
  if (!offline) {
    return (
      <span className={cn(styles.badge, styles.badgeWarning)}>
        <Icon name="globe" size={13} strokeWidth={2} />
        Network access enabled
      </span>
    );
  }
  return (
    <span className={styles.badge}>
      <Icon name="offline" size={13} strokeWidth={2} />
      Offline · nothing leaves this PC
    </span>
  );
}

/**
 * The device comes from `useActiveModel` (the service's own truth); thread count and VRAM
 * are decorative extras from the settings mock, since the service reports neither. Either
 * being unavailable still leaves an honest label rather than blocking on both.
 */
function computeLabel(
  compute: ComputeMode | undefined,
  settings: ReturnType<typeof useSettings>['data'],
): string {
  if (!compute) return '—';
  if (compute === 'cpu') {
    return settings ? `CPU · ${settings.hardware.cpuThreads} threads` : 'CPU';
  }
  const used = settings?.hardware.gpuMemoryUsedBytes;
  return used ? `GPU · ${formatBytes(used)} VRAM` : 'GPU';
}

type Bucket = ReturnType<typeof historyBucket>;

function groupChats(chats: Chat[]): Array<[Bucket, Chat[]]> {
  const order: Bucket[] = ['today', 'week', 'month', 'older'];
  const buckets = new Map<Bucket, Chat[]>();

  for (const chat of [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const bucket = historyBucket(chat.updatedAt);
    const existing = buckets.get(bucket);
    if (existing) existing.push(chat);
    else buckets.set(bucket, [chat]);
  }

  return order
    .filter((bucket) => buckets.has(bucket))
    .map((bucket) => [bucket, buckets.get(bucket) ?? []]);
}
