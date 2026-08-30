import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Chat, Project } from '@localchat/contracts';
import { useChats, useProjects, useSettings } from '@/shared/api/queries';
import { SearchField } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { EmptyState, Mono } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatCount, formatDayHeading, formatListTimestamp } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import styles from './History.module.css';

type Filter = { kind: 'all' } | { kind: 'project'; id: string } | { kind: 'general' };

export function HistoryPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const projects = useProjects();
  const settings = useSettings();
  const chats = useChats({ query: search || undefined });

  const filtered = useMemo(() => {
    const all = chats.data ?? [];
    if (filter.kind === 'project') return all.filter((chat) => chat.projectId === filter.id);
    if (filter.kind === 'general') return all.filter((chat) => chat.projectId === null);
    return all;
  }, [chats.data, filter]);

  const days = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Chat history"
        description={
          <>
            {formatCount(chats.data?.length ?? 0)} conversations, stored locally in{' '}
            <Mono>{settings.data?.indexLocation ?? '%APPDATA%\\LocalChat'}</Mono>
          </>
        }
        actions={
          <div className={styles.search}>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search questions and answers"
              label="Search chat history"
            />
          </div>
        }
      />

      <div className={styles.filters}>
        <FilterChip active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
          All
        </FilterChip>
        {projects.data?.map((project: Project) => (
          <FilterChip
            key={project.id}
            icon
            active={filter.kind === 'project' && filter.id === project.id}
            onClick={() => setFilter({ kind: 'project', id: project.id })}
          >
            {project.name}
          </FilterChip>
        ))}
        <FilterChip
          active={filter.kind === 'general'}
          onClick={() => setFilter({ kind: 'general' })}
        >
          General only
        </FilterChip>
      </div>

      <div className={styles.list}>
        {days.length === 0 ? (
          <EmptyState
            icon="search"
            title={search ? `No chats match “${search}”` : 'No chats yet'}
            description={
              search
                ? 'Search covers both the questions you asked and the answers LocalChat gave.'
                : 'Ask a question and it will show up here.'
            }
          />
        ) : (
          days.map(([day, entries]) => (
            <section className={styles.day} key={day}>
              <h2 className={styles.dayHeading}>
                {formatDayHeading(entries[0]?.updatedAt ?? day)}
              </h2>
              {entries.map((chat) => (
                <ChatRow key={chat.id} chat={chat} projects={projects.data ?? []} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ChatRow({ chat, projects }: { chat: Chat; projects: Project[] }) {
  const project = projects.find((entry) => entry.id === chat.projectId);
  return (
    <Link to={`/chat/${chat.id}`} className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{chat.title}</span>
        <Mono className={styles.cardTime}>{formatListTimestamp(chat.updatedAt)}</Mono>
      </div>
      <p className={styles.cardPreview}>{chat.preview}</p>
      <div className={styles.cardMeta}>
        <span className={styles.tag}>
          <Icon name={project ? 'folder' : 'globe'} size={11} />
          {project?.name ?? 'General'}
        </span>
        {chat.sourceCount > 0 && (
          <span className={styles.tag}>
            <Mono>
              {chat.sourceCount} {chat.sourceCount === 1 ? 'source' : 'sources'}
            </Mono>
          </span>
        )}
        <span className={styles.tag}>
          <Mono>{chat.messageCount} turns</Mono>
        </span>
        {chat.hadNoEvidence && (
          <span className={cn(styles.tag, styles.tagWarning)}>no evidence found</span>
        )}
      </div>
    </Link>
  );
}

function FilterChip({
  active,
  icon = false,
  onClick,
  children,
}: {
  active: boolean;
  icon?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(styles.filter, active && styles.filterActive)}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon && <Icon name="folder" size={12} />}
      {children}
    </button>
  );
}

function groupByDay(chats: Chat[]): Array<[string, Chat[]]> {
  const groups = new Map<string, Chat[]>();
  for (const chat of [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const day = chat.updatedAt.slice(0, 10);
    const existing = groups.get(day);
    if (existing) existing.push(chat);
    else groups.set(day, [chat]);
  }
  return [...groups.entries()];
}
