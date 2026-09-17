import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@localchat/contracts';
import {
  useCreateProject,
  useDeleteAllProjects,
  useDeleteProject,
  useIngestDocuments,
  useProjects,
} from '@/shared/api/queries';
import { Button, IconButton } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono, ProgressBar, SectionLabel, StatusDot } from '@/shared/ui/Indicators';
import { DangerAction } from '@/shared/ui/DangerAction';
import { formatCount, formatEta, formatRelative } from '@/shared/lib/format';
import { PageHeader } from '@/shared/ui/PageHeader';
import { LibraryNav } from './LibraryNav';
import { NewProjectDialog } from './NewProjectDialog';
import styles from './Projects.module.css';

export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const deleteAllProjects = useDeleteAllProjects();
  const ingest = useIngestDocuments();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Which single card is asking for confirmation before its own irreversible delete - only
  // one at a time, mirroring the chat list's inline confirm (Sidebar.tsx).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function handleDeleteProject(project: Project) {
    setConfirmingId(null);
    deleteProject.mutate(project.id);
  }

  return (
    <div className={styles.page}>
      <LibraryNav />

      <div className={styles.content}>
        <PageHeader
          title="Projects"
          description="Each project keeps its own documents, its own index and its own chats."
          actions={
            <Button variant="cta" icon="plus" onClick={() => setDialogOpen(true)}>
              New project
            </Button>
          }
        />

        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <SectionLabel
              action={
                <span className={styles.sectionActions}>
                  <Mono className={styles.cardHeaderMeta}>
                    {projects.data?.length ?? 0} projects
                  </Mono>
                  <DangerAction
                    label="Delete all projects"
                    confirmText={`Delete all ${projects.data?.length ?? 0} projects, and every document and chat inside them? This can't be undone.`}
                    pending={deleteAllProjects.isPending}
                    disabled={!projects.data?.length}
                    onConfirm={() => deleteAllProjects.mutate()}
                  />
                </span>
              }
            >
              Projects
            </SectionLabel>
          </header>

          <div className={styles.grid}>
            {projects.data?.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                confirming={confirmingId === project.id}
                deletePending={deleteProject.isPending}
                onOpen={() => navigate(`/projects/${project.id}`)}
                onRequestDelete={() => setConfirmingId(project.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => handleDeleteProject(project)}
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
        </section>
      </div>

      {dialogOpen && (
        <NewProjectDialog
          pending={createProject.isPending || ingest.isPending}
          onCancel={() => setDialogOpen(false)}
          onCreate={async (values, documents) => {
            const result = await createProject.mutateAsync(values);
            // The project has to exist before anything can be tagged with its id, so this
            // is a second request rather than part of creation itself — same two-step
            // shape as adding documents from the project screen afterwards.
            if (documents.paths.length > 0 || documents.files.length > 0) {
              await ingest.mutateAsync({
                projectId: result.project.id,
                paths: documents.paths,
                files: documents.files,
              });
            }
            setDialogOpen(false);
            navigate(`/projects/${result.project.id}`);
          }}
        />
      )}
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  confirming: boolean;
  deletePending: boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ProjectCard({
  project,
  confirming,
  deletePending,
  onOpen,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ProjectCardProps) {
  const indexing = project.indexState === 'indexing' && project.indexProgress !== null;

  if (confirming) {
    return (
      <div className={styles.projectCardConfirm}>
        <span className={styles.confirmText}>
          Delete <strong>{project.name}</strong>? Its documents and chats go with it — this
          can&rsquo;t be undone.
        </span>
        <span className={styles.confirmActions}>
          <button type="button" className={styles.confirmCancel} onClick={onCancelDelete}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmDelete}
            disabled={deletePending}
            onClick={onConfirmDelete}
          >
            Delete
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={styles.projectCard}>
      <button type="button" className={styles.projectCardOpen} onClick={onOpen}>
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

      <IconButton
        icon="trash"
        label={`Delete "${project.name}"`}
        size={13}
        className={styles.cardDelete}
        onClick={onRequestDelete}
      />
    </div>
  );
}
