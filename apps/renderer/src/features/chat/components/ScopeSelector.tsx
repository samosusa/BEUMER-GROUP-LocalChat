import { useState } from 'react';
import type { Project, RetrievalScope } from '@localchat/contracts';
import { Icon } from '@/shared/ui/Icon';
import { SegmentedControl, type SegmentedOption } from '@/shared/ui/Controls';
import { Mono } from '@/shared/ui/Indicators';
import styles from './ScopeSelector.module.css';

interface ScopeSelectorProps {
  scope: RetrievalScope;
  onScopeChange: (scope: RetrievalScope) => void;
  /** Draft: whichever project is pending. Existing chat: the project it was created with. */
  projectId: string | null;
  projectName: string | undefined;
  /** True once the chat exists — the project it was created with can never change. */
  locked: boolean;
  /** Pre-creation only: every project the draft could be pointed at. */
  projects: Project[];
  onProjectChange: (projectId: string) => void;
}

/**
 * The one place retrieval scope is chosen, before or after the chat exists. Persistent and
 * always expanded — no popover to open first — because a click-to-reveal control is one more
 * place engineers forget to check before trusting an answer.
 */
export function ScopeSelector({
  scope,
  onScopeChange,
  projectId,
  projectName,
  locked,
  projects,
  onProjectChange,
}: ScopeSelectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasProject = projectId !== null;

  const options: ReadonlyArray<SegmentedOption<RetrievalScope>> = [
    { value: 'general', label: 'General', icon: 'globe' },
    {
      value: 'project',
      label: 'Project',
      icon: 'folder',
      disabled: locked && !hasProject,
    },
    { value: 'both', label: 'Both', icon: 'union', disabled: !hasProject },
  ];

  function selectProject(nextScope: RetrievalScope) {
    if (nextScope === 'project' && !locked && !hasProject) {
      // Selected the instant it's clicked, not only once a project is actually picked — the
      // segment turning blue is what tells the engineer the click landed at all.
      setPickerOpen(true);
      onScopeChange('project');
      return;
    }
    // Leaving the picker flow (General, or re-picking Project/Both with a project already
    // known) closes it — otherwise it kept showing under General, dangling from a project
    // choice that no longer applies to what's actually selected.
    setPickerOpen(false);
    onScopeChange(nextScope);
  }

  // Open while actively choosing a project, or while the current scope is one that uses the
  // already-known project. Not merely because a project was picked at some earlier point —
  // General never draws on it, so the picker has no business still showing under General.
  const showPicker = !locked && (pickerOpen || (hasProject && scope !== 'general'));

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <SegmentedControl
          options={options}
          value={scope}
          onChange={selectProject}
          label="Retrieval scope"
        />

        {showPicker && (
          <select
            className={styles.projectSelect}
            value={projectId ?? ''}
            aria-label="Project to search"
            onChange={(event) => {
              onProjectChange(event.target.value);
              onScopeChange('project');
            }}
          >
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}

        {locked && hasProject && (
          <span className={styles.projectLabel}>
            <Icon name="folder" size={13} />
            <Mono>{projectName ?? projectId}</Mono>
          </span>
        )}
      </div>

      <p className={styles.explainer}>{explainScope(scope, hasProject, locked, projectName)}</p>
    </div>
  );
}

function explainScope(
  scope: RetrievalScope,
  hasProject: boolean,
  locked: boolean,
  projectName: string | undefined,
): string {
  if (scope === 'general') return 'Searching company-wide documentation only.';
  if (!hasProject) {
    return locked
      ? 'This chat has no project attached — general only.'
      : 'Pick a project to search it.';
  }
  const name = projectName ?? 'the project';
  if (scope === 'project') return `Searching ${name} only.`;
  return `Searching ${name} and company-wide documentation together.`;
}
