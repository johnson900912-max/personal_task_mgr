export type SourceType = "mission_control" | "apple_reminders" | "apple_notes" | "chatgpt" | "claude";

export type ProjectStatus = "planned" | "active" | "blocked" | "done" | "archived";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "parking_lot" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Recurrence = "none" | "daily" | "weekly";

export type ContentParentType = "project" | "task";
export type ContentEntryType = "text" | "url" | "image";

export interface Project {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  dueDate: string | null;
  completionPercent: number;
  source: SourceType;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  projectId: string;
  source: SourceType;
  order: number;
  recurrence: Recurrence;
  createdAt: string;
  updatedAt: string;
}

export interface ContentAsset {
  id: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface ContentEntry {
  id: string;
  parentType: ContentParentType;
  parentId: string;
  entryType: ContentEntryType;
  textContent: string | null;
  url: string | null;
  assetId: string | null;
  asset: ContentAsset | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportStatus {
  source: SourceType;
  importedCount: number;
  lastImportedAt: string;
}

export interface ActivityLog {
  id: string;
  entityType: "project" | "task" | "content" | "import";
  entityId: string;
  action: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface DashboardSummary {
  overdue: number;
  dueToday: number;
  blocked: number;
  completedThisWeek: number;
}

export type ImportType = "apple_reminders" | "apple_notes" | "chatgpt_projects" | "claude_projects";
export type ImportEntityType = "task" | "project";
export type ImportAction = "create" | "update" | "skip";

export interface ImportPreviewRequest {
  type: ImportType;
  text: string;
}

export interface ImportDuplicateMatch {
  entityType: ImportEntityType;
  id: string;
  title: string;
  score: number;
  kind: "exact" | "fuzzy";
}

export interface ImportPreviewRow {
  line: number;
  values: Record<string, string>;
  error: string | null;
  suggestedAction: ImportAction;
  duplicateMatch: ImportDuplicateMatch | null;
}

export interface ImportPreviewResponse {
  headers: string[];
  rows: ImportPreviewRow[];
  validRows: number;
  invalidRows: number;
}

export interface ImportCommitRow {
  values: Record<string, string>;
  action: ImportAction;
  duplicateMatch: ImportDuplicateMatch | null;
}

export interface ImportCommitRequest {
  type: ImportType;
  rows: ImportCommitRow[];
}

export interface ImportCommitResponse {
  createdProjects: number;
  updatedProjects: number;
  createdTasks: number;
  updatedTasks: number;
  createdContentEntries: number;
  updatedContentEntries: number;
  skippedRows: number;
}

export interface TaskReorderRequest {
  movedTaskId: string;
  toStatus: TaskStatus;
  orderedTaskIds: string[];
}
