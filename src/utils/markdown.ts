/** Markdown and YAML-frontmatter formatters used by client-side exports. */

import type { Note } from '../models/note.model';
import type { DefaultView } from '../models/user-preferences.model';
import { PRIORITY_LABELS } from '../constants/priorities';
import { STATUS_LABELS } from '../constants/statuses';

/**
 * Converts a Date or string to ISO date string (YYYY-MM-DD)
 * Returns empty string for invalid or missing dates
 */
function toDateString(value: Date | string | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * Escapes special characters for YAML quoted scalars
 * JSON.stringify handles control characters and ensures valid YAML
 */
function escapeYamlString(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' '));
}

/**
 * Extracts and sanitizes note title, defaulting to "Untitled Note"
 */
function getNoteTitle(note: Note): string {
  return note.title.trim() || 'Untitled Note';
}

/**
 * Escapes pipe characters and line breaks in table cell content
 * Preserves content while maintaining Markdown table structure
 */
function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, '<br>');
}

/**
 * Generates YAML frontmatter with all persisted note metadata
 * Includes optional fields only when present
 */ export function generateFrontmatter(note: Note): string {
  const lines = [
    '---',
    `title: ${escapeYamlString(getNoteTitle(note))}`,
    `status: ${escapeYamlString(note.status)}`,
    `priority: ${escapeYamlString(note.priority)}`,
    `created: ${toDateString(note.createdAt)}`,
  ];

  const dueDate = toDateString(note.dueDate);
  if (dueDate) lines.push(`dueDate: ${dueDate}`);

  if (note.tags?.length) {
    lines.push(
      'tags:',
      ...note.tags.map((tag) => `  - ${escapeYamlString(tag)}`)
    );
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Formats a single note as a complete Markdown document with frontmatter
 */
export function formatNoteToMarkdown(note: Note): string {
  const parts = [generateFrontmatter(note), '', `# ${getNoteTitle(note)}`];
  const content = note.content.trim();
  if (content) parts.push('', content);
  return `${parts.join('\n')}\n`;
}

/**
 * Routes to appropriate Markdown formatter based on active view type
 * Handles kanban, table, roadmap, and default notes views
 */
export function formatViewToMarkdown(notes: Note[], view: DefaultView): string {
  if (notes.length === 0) {
    return '# Notes Export\n\n_No notes match the current view._\n';
  }

  switch (view) {
    case 'kanban':
      return formatKanbanMarkdown(notes);
    case 'table':
      return formatTableMarkdown(notes);
    case 'roadmap':
      return formatRoadmapMarkdown(notes);
    case 'notes':
    default:
      return formatNotesMarkdown(notes);
  }
}

/**
 * Generates a safe filename for note exports
 * Removes invalid characters, normalizes spacing, and adds collision-resistant suffix
 * Handles Windows reserved names (CON, PRN, AUX, etc.)
 */
export function sanitizeFilename(title: string, id: string): string {
  const suffix = id.trim().slice(0, 8) || 'note';
  let base = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  // Prepend 'note-' to Windows reserved device names
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
    base = `note-${base}`;
  }

  return `${base || 'note'}-${suffix}.md`;
}

/**
 * Formats notes grouped by priority with table of contents and full details
 * Creates anchor links for navigation
 */
function formatNotesMarkdown(notes: Note[]): string {
  const slugs = new Map(
    notes.map((note, index) => [note.id, createSlug(getNoteTitle(note), index)])
  );
  const lines = ['# Notes Export', ''];

  (['high', 'medium', 'low'] as const).forEach((priority) => {
    const group = notes.filter((note) => note.priority === priority);
    if (!group.length) return;

    lines.push(`## ${PRIORITY_LABELS[priority]} Priority`, '');
    group.forEach((note) =>
      lines.push(`- [${getNoteTitle(note)}](#${slugs.get(note.id)})`)
    );
    lines.push('');
  });

  // Highlight active tasks
  const active = notes.filter((note) => note.status === 'in-progress');
  if (active.length) {
    lines.push('## Active Tasks', '');
    active.forEach((note) =>
      lines.push(`- [${getNoteTitle(note)}](#${slugs.get(note.id)})`)
    );
    lines.push('');
  }

  // Full note details ordered by priority (high → medium → low)
  (['high', 'medium', 'low'] as const).forEach((priority) => {
    const group = notes.filter((note) => note.priority === priority);
    group.forEach((note) => {
      lines.push(
        '',
        `<a id="${slugs.get(note.id)}"></a>`,
        `## ${getNoteTitle(note)}`,
        ''
      );
      if (note.content.trim()) {
        lines.push(note.content.trim());
      }
      lines.push('');
    });
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Formats notes as Kanban board columns (todo, in-progress, done)
 * Each card includes metadata (priority, due date)
 */
function formatKanbanMarkdown(notes: Note[]): string {
  const lines = ['# Kanban Board Export', ''];

  (['todo', 'in-progress', 'done'] as const).forEach((status) => {
    const column = notes.filter((note) => note.status === status);
    lines.push(`## ${STATUS_LABELS[status]}`, '');

    if (!column.length) {
      lines.push('_No notes in this column._', '');
      return;
    }

    column.forEach((note) => {
      const metadata = [
        `${PRIORITY_LABELS[note.priority]} priority`,
        note.dueDate ? `Due: ${toDateString(note.dueDate)}` : '',
      ].filter(Boolean);
      lines.push(
        `${status === 'done' ? '- [x]' : '- [ ]'} **${getNoteTitle(note)}**`
      );
      if (metadata.length) lines.push(`  ${metadata.join(' - ')}`);
      if (note.content.trim()) {
        lines.push(
          ...note.content
            .trim()
            .split('\n')
            .map((line) => `  > ${line}`)
        );
      }
      lines.push('');
    });
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Formats notes as a data table with columns for all key metadata
 * Suitable for spreadsheet import/analysis
 */
function formatTableMarkdown(notes: Note[]): string {
  const lines = [
    '# Notes Table Export',
    '',
    '| # | Title | Status | Priority | Created | Due Date | Tags |',
    '|---|-------|--------|----------|---------|---------|------|',
  ];

  notes.forEach((note, index) => {
    const tags = note.tags?.length ? note.tags.join(', ') : '-';
    lines.push(
      `| ${index + 1} | ${escapeTableCell(getNoteTitle(note))} | ${STATUS_LABELS[note.status]} | ${PRIORITY_LABELS[note.priority]} | ${toDateString(note.createdAt) || '-'} | ${toDateString(note.dueDate) || '-'} | ${escapeTableCell(tags)} |`
    );
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Formats notes as a timeline/roadmap grouped by due dates
 * Highlights overdue tasks and groups undated notes separately
 */
function formatRoadmapMarkdown(notes: Note[]): string {
  const today = new Date();
  const withDueDate = notes
    .filter((note) => note.dueDate)
    .sort(
      (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
    );
  const withoutDueDate = notes.filter((note) => !note.dueDate);
  const lines = ['# Roadmap Export', ''];

  if (withDueDate.length) {
    lines.push('## Timeline', '');
    withDueDate.forEach((note) => {
      const overdue = new Date(note.dueDate!) < today && note.status !== 'done';
      appendRoadmapNote(lines, note, overdue ? ' (Overdue)' : '');
    });
  }

  if (withoutDueDate.length) {
    lines.push('## No Due Date', '');
    withoutDueDate.forEach((note) => appendRoadmapNote(lines, note));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Appends a formatted note entry to the roadmap output
 * Helper function for formatRoadmapMarkdown
 */
function appendRoadmapNote(lines: string[], note: Note, suffix = ''): void {
  lines.push(`### ${getNoteTitle(note)}${suffix}`, '');
  if (note.dueDate) lines.push(`- **Due:** ${toDateString(note.dueDate)}  `);
  lines.push(
    `- **Status:** ${STATUS_LABELS[note.status]}  `,
    `- **Priority:** ${PRIORITY_LABELS[note.priority]}  `
  );
  if (note.tags?.length) lines.push(`- **Tags:** ${note.tags.join(', ')}  `);
  if (note.content.trim()) lines.push('', note.content.trim());
  lines.push('');
}

/**
 * Creates a URL-safe slug from a title for anchor links
 * Removes special characters and normalizes whitespace
 */
function createSlug(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${slug || 'note'}-${index + 1}`;
}
