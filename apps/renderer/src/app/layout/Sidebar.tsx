import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import type { Chat, ComputeMode } from '@localchat/contracts';
import {
  useActiveModel,
  useChats,
  useHealth,
  useModels,
  useProjects,
  useSettings,
} from '@/shared/api/queries';
import { Button, IconButton } from '@/shared/ui/Button';
import { SearchField } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Mono, SectionLabel } from '@/shared/ui/Indicators';
import { formatBytes, historyBucket } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useCreateChat } from '@/shared/api/queries';
import styles from './Sidebar.module.css';

const BUCKET_LABELS = {
  today: 'Today',
  week: 'Previous 7 days',
  month: 'Previous 30 days',
  older: 'Older',
} as const;

export function Sidebar() {
  const navigate = useNavigate();
  const { chatId, projectId } = useParams();
  const [search, setSearch] = useState('');

  const health = useHealth();
  const settings = useSettings();
  const activeModelState = useActiveModel();
  const models = useModels();
  const projects = useProjects();
  const chats = useChats({ query: search || undefined });
  const createChat = useCreateChat();

  const grouped = useMemo(() => groupChats(chats.data ?? []), [chats.data]);
  const activeModel = models.data?.find((model) => model.id === activeModelState.data?.activeModelId);
  // Distinct from "still fetching": once both queries have settled, a model that isn't
  // active yet is a real state — the picker starts with nothing loaded — not a stuck spinner.
  const modelLabel = !activeModelState.data || !models.data
    ? 'Loading model…'
    : (activeModel?.name ?? 'No model selected');

  const activeProjectId = projectId ?? chats.data?.find((chat) => chat.id === chatId)?.projectId;

  async function startChat() {
    const result = await createChat.mutateAsync({
      projectId: activeProjectId ?? null,
      scope: activeProjectId ? 'both' : 'general',
      attachmentIds: [],
    });
    navigate(`/chat/${result.chat.id}`);
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
              v{health.data?.version ?? window.localchat?.appVersion ?? '0.4.1'}
            </Mono>
          </span>
        </div>

        <OfflineBadge offline={health.data?.offline ?? settings.data?.strictOffline ?? true} />

        <Button
          variant="cta"
          size="lg"
          icon="plus"
          fullWidth
          onClick={startChat}
          loading={createChat.isPending}
        >
          New chat
        </Button>

        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search chats and documents"
          label="Search chats and documents"
        />
      </header>

      <div className={styles.scroll}>
        <section className={styles.section}>
          <SectionLabel
            action={
              <IconButton
                icon="plus"
                label="New project"
                size={14}
                onClick={() => navigate('/projects')}
              />
            }
          >
            Projects
          </SectionLabel>
          <ul>
            {projects.data?.map((project) => (
              <li key={project.id}>
                <NavLink
                  to={`/projects/${project.id}`}
                  className={({ isActive }) =>
                    cn(styles.row, (isActive || project.id === activeProjectId) && styles.rowActive)
                  }
                >
                  <Icon name="folder" size={15} className={styles.rowIcon} />
                  <span className={styles.rowLabel}>{project.name}</span>
                  <Mono className={styles.rowCount}>{project.documentCount}</Mono>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>

        {grouped.map(([bucket, entries]) => (
          <section className={styles.section} key={bucket}>
            <SectionLabel>{BUCKET_LABELS[bucket]}</SectionLabel>
            <ul>
              {entries.map((chat) => (
                <li key={chat.id}>
                  <NavLink
                    to={`/chat/${chat.id}`}
                    className={({ isActive }) => cn(styles.row, isActive && styles.rowActive)}
                  >
                    <span className={styles.rowLabel}>{chat.title}</span>
                  </NavLink>
                </li>
              ))}
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
          <span className={styles.avatar} aria-hidden="true">
            MP
          </span>
          <span className={styles.userName}>M. Palas</span>
          <IconButton
            icon="settings"
            label="Settings"
            onClick={() => navigate('/settings?section=benchmark')}
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
