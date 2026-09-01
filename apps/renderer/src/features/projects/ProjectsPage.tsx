import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@localchat/contracts';
import { useCreateProject, useProjects } from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono, ProgressBar, StatusDot } from '@/shared/ui/Indicators';
import { formatCount, formatEta, formatRelative } from '@/shared/lib/format';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NewProjectDialog } from './NewProjectDialog';
import styles from './Projects.module.css';

export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useProjects();
  const createProject = useCreateProject();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Projects"
        description="Each project keeps its own documents, its own index and its own chats."
        actions={
          <Button variant="cta" icon="plus" onClick={() => setDialogOpen(true)}>
            New project
          </Button>
        }
      />

      <div className={styles.grid}>
        {projects.data?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onOpen={() => navigate(`/projects/${project.id}`)}
          />
        ))}

        <button type="button" className={styles.newCard} onClick={() => setDialogOpen(true)}>
          <span className={styles.newIcon}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
          </span>
          <span className={styles.newTitle}>New project</span>
          <span className={styles.newHint}>
            Point it at a documentation folder — indexing runs in the background.
          </span>
        </button>
      </div>

      {dialogOpen && (
        <NewProjectDialog
          pending={createProject.isPending}
          onCancel={() => setDialogOpen(false)}
          onCreate={async (values) => {
            const result = await createProject.mutateAsync(values);
            setDialogOpen(false);
            navigate(`/projects/${result.project.id}`);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const indexing = project.indexState === 'indexing' && project.indexProgress !== null;

  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <Icon name="folder" size={17} />
        </span>
        <span className={styles.cardTitleGroup}>
          <span className={styles.cardTitle}>{project.name}</span>
          <Mono className={styles.cardStatus}>
            {indexing
              ? `indexing ${Math.round((project.indexProgress ?? 0) * 100)}%`
              : project.lastOpenedAt
                ? `opened ${formatRelative(project.lastOpenedAt)}`
                : 'not opened yet'}
          </Mono>
        </span>
      </span>

      <span className={styles.cardDescription}>{project.description}</span>

      <span className={styles.cardFooter}>
        {indexing ? (
          <>
            <ProgressBar value={project.indexProgress ?? 0} thickness={3} label="Indexing" />
            <span className={styles.cardMetaRow}>
              <Mono className={styles.cardMeta}>{formatCount(project.documentCount)} docs</Mono>
              <span className={styles.spacer} />
              <Mono className={styles.cardEta}>
                {project.indexEtaSeconds !== null ? formatEta(project.indexEtaSeconds) : ''}
              </Mono>
            </span>
          </>
        ) : (
          <span className={styles.cardMetaRow}>
            <span className={styles.cardMetaItem}>
              <Icon name="document" size={13} />
              <Mono className={styles.cardMeta}>{formatCount(project.documentCount)} docs</Mono>
            </span>
            <span className={styles.cardMetaItem}>
              <Icon name="chat" size={13} />
              <Mono className={styles.cardMeta}>{formatCount(project.chatCount)} chats</Mono>
            </span>
            <span className={styles.spacer} />
            <StatusDot
              tone={project.indexState === 'ready' ? 'success' : 'warning'}
              label={project.indexState === 'ready' ? 'indexed' : project.indexState}
            />
          </span>
        )}
      </span>
    </button>
  );
}
