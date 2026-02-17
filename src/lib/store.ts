import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ActivityLog,
  ContentAsset,
  ContentEntry,
  ContentEntryType,
  ContentParentType,
  ImportStatus,
  Priority,
  Project,
  ProjectStatus,
  Recurrence,
  SourceType,
  Task,
  TaskStatus
} from "@/src/lib/types";

type SqliteRow = Record<string, unknown>;

type LegacyNote = {
  id: string;
  title: string;
  content: string;
  projectId: string | null;
  taskId: string | null;
  source: SourceType;
  createdAt: string;
  updatedAt: string;
};

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): SqliteRow | undefined;
  all(...params: unknown[]): SqliteRow[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (filename: string) => SqliteDatabase };

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "mission-control.db");
const LEGACY_STORE_PATH = path.join(DATA_DIR, "store.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const INBOX_PROJECT_ID = "proj-inbox";

const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "parking_lot", "done"];
const RECURRENCES: Recurrence[] = ["none", "daily", "weekly"];

let dbInstance: SqliteDatabase | null = null;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function ensureColumn(db: SqliteDatabase, table: string, columnName: string, alterSql: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    db.exec(alterSql);
  }
}

function rowToProject(row: SqliteRow): Project {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    status: row.status as ProjectStatus,
    dueDate: row.due_date === null ? null : String(row.due_date),
    completionPercent: Number(row.completion_percent),
    source: row.source as SourceType,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToTask(row: SqliteRow): Task {
  const recurrence = String(row.recurrence ?? "none") as Recurrence;
  return {
    id: String(row.id),
    title: String(row.title),
    details: row.details === null ? null : String(row.details),
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    dueDate: row.due_date === null ? null : String(row.due_date),
    scheduledAt: row.scheduled_at === null ? null : String(row.scheduled_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    projectId: String(row.project_id),
    source: row.source as SourceType,
    order: Number(row.order_index ?? 0),
    recurrence: RECURRENCES.includes(recurrence) ? recurrence : "none",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToAsset(row: SqliteRow): ContentAsset {
  return {
    id: String(row.id),
    filePath: String(row.file_path),
    mimeType: String(row.mime_type),
    fileSize: Number(row.file_size),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: String(row.created_at)
  };
}

function rowToContentEntry(row: SqliteRow): ContentEntry {
  const hasAsset = row.asset_id !== null;
  return {
    id: String(row.id),
    parentType: row.parent_type as ContentParentType,
    parentId: String(row.parent_id),
    entryType: row.entry_type as ContentEntryType,
    textContent: row.text_content === null ? null : String(row.text_content),
    url: row.url === null ? null : String(row.url),
    assetId: row.asset_id === null ? null : String(row.asset_id),
    asset: hasAsset
      ? {
          id: String(row.asset_id),
          filePath: String(row.file_path),
          mimeType: String(row.mime_type),
          fileSize: Number(row.file_size),
          width: row.width === null ? null : Number(row.width),
          height: row.height === null ? null : Number(row.height),
          createdAt: String(row.asset_created_at)
        }
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToImportStatus(row: SqliteRow): ImportStatus {
  return {
    source: row.source as SourceType,
    importedCount: Number(row.imported_count),
    lastImportedAt: String(row.last_imported_at)
  };
}

function rowToActivity(row: SqliteRow): ActivityLog {
  return {
    id: String(row.id),
    entityType: row.entity_type as ActivityLog["entityType"],
    entityId: String(row.entity_id),
    action: String(row.action),
    createdAt: String(row.created_at),
    payload: row.payload ? (JSON.parse(String(row.payload)) as Record<string, unknown>) : {}
  };
}

function createSchema(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      due_date TEXT,
      completion_percent INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_date TEXT,
      scheduled_at TEXT,
      completed_at TEXT,
      project_id TEXT,
      source TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_assets (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_entries (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK(parent_type IN ('project','task')),
      parent_id TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('text','url','image')),
      text_content TEXT,
      url TEXT,
      asset_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES content_assets(id)
    );

    CREATE TABLE IF NOT EXISTS import_statuses (
      source TEXT PRIMARY KEY,
      imported_count INTEGER NOT NULL,
      last_imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_content_parent ON content_entries(parent_type, parent_id, created_at DESC);
  `);
}

function ensureTaskAndLegacyNoteColumns(db: SqliteDatabase): void {
  ensureColumn(db, "projects", "due_date", "ALTER TABLE projects ADD COLUMN due_date TEXT");
  ensureColumn(db, "tasks", "order_index", "ALTER TABLE tasks ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "recurrence", "ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "notes", "task_id", "ALTER TABLE notes ADD COLUMN task_id TEXT");
}

function insertActivity(entityType: ActivityLog["entityType"], entityId: string, action: string, payload: Record<string, unknown>): void {
  const db = getDb();
  db.prepare("INSERT INTO activity (id, entity_type, entity_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    createId("act"),
    entityType,
    entityId,
    action,
    JSON.stringify(payload),
    new Date().toISOString()
  );
}

function migrationApplied(db: SqliteDatabase, name: string): boolean {
  const row = db.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(name) as { name: string } | undefined;
  return Boolean(row);
}

function markMigration(db: SqliteDatabase, name: string): void {
  db.prepare("INSERT OR IGNORE INTO schema_migrations (name, created_at) VALUES (?, ?)").run(name, new Date().toISOString());
}

function normalizeTaskOrder(db: SqliteDatabase): void {
  for (const status of TASK_STATUSES) {
    const rows = db
      .prepare("SELECT id FROM tasks WHERE status = ? ORDER BY order_index ASC, created_at ASC, updated_at ASC, id ASC")
      .all(status) as Array<{ id: string }>;
    rows.forEach((row, index) => {
      db.prepare("UPDATE tasks SET order_index = ? WHERE id = ?").run(index, row.id);
    });
  }
}

function projectExists(db: SqliteDatabase, projectId: string): boolean {
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as { id: string } | undefined;
  return Boolean(row);
}

export function ensureInboxProject(dbInput?: SqliteDatabase): string {
  const db = dbInput ?? getDb();
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(INBOX_PROJECT_ID) as { id: string } | undefined;
  if (!row) {
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO projects (id, title, description, status, due_date, completion_percent, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      INBOX_PROJECT_ID,
      "Inbox",
      "System default project for uncategorized tasks.",
      "active",
      null,
      0,
      "mission_control",
      ts,
      ts
    );
  }
  return INBOX_PROJECT_ID;
}

function enforceTaskOwnership(db: SqliteDatabase): void {
  const inboxId = ensureInboxProject(db);
  db.prepare("UPDATE tasks SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(inboxId);
}

function migrateLegacyNotesToContent(db: SqliteDatabase): void {
  const migrationName = "migrate_notes_to_content_entries_v1";
  if (migrationApplied(db, migrationName)) {
    return;
  }

  const notes = db
    .prepare("SELECT id, title, content, project_id, task_id, source, created_at, updated_at FROM notes ORDER BY created_at ASC")
    .all() as Array<{
    id: string;
    title: string;
    content: string;
    project_id: string | null;
    task_id: string | null;
    source: SourceType;
    created_at: string;
    updated_at: string;
  }>;

  if (notes.length === 0) {
    markMigration(db, migrationName);
    return;
  }

  const inboxId = ensureInboxProject(db);

  const tx = db.transaction(() => {
    for (const note of notes) {
      let parentType: ContentParentType = "project";
      let parentId: string = inboxId;

      if (note.task_id) {
        const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(note.task_id) as { id: string } | undefined;
        if (task) {
          parentType = "task";
          parentId = note.task_id;
        }
      }

      if (parentType === "project" && note.project_id) {
        const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(note.project_id) as { id: string } | undefined;
        if (project) {
          parentId = note.project_id;
        }
      }

      const text = (note.content || "").trim() || note.title;
      db.prepare(
        "INSERT INTO content_entries (id, parent_type, parent_id, entry_type, text_content, url, asset_id, created_at, updated_at) VALUES (?, ?, ?, 'text', ?, NULL, NULL, ?, ?)"
      ).run(createId("entry"), parentType, parentId, text, note.created_at, note.updated_at);
    }

    markMigration(db, migrationName);
  });

  tx();
}

function getNextTaskOrder(db: SqliteDatabase, status: TaskStatus): number {
  const row = db.prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM tasks WHERE status = ?").get(status) as {
    next_order: number;
  };
  return Number(row.next_order ?? 0);
}

function listTaskRows(db: SqliteDatabase): SqliteRow[] {
  return db
    .prepare(
      "SELECT id, title, details, status, priority, due_date, scheduled_at, completed_at, project_id, source, order_index, recurrence, created_at, updated_at FROM tasks ORDER BY status ASC, order_index ASC, updated_at DESC"
    )
    .all() as SqliteRow[];
}

function addRecurrenceDate(date: string | null, recurrence: Recurrence): string | null {
  if (!date || recurrence === "none") {
    return date;
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return date;
  }
  if (recurrence === "daily") {
    d.setDate(d.getDate() + 1);
  }
  if (recurrence === "weekly") {
    d.setDate(d.getDate() + 7);
  }
  return d.toISOString();
}

function seedDefaults(db: SqliteDatabase): void {
  const ts = new Date().toISOString();
  const insertProject = db.prepare(
    "INSERT INTO projects (id, title, description, status, due_date, completion_percent, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  insertProject.run("proj-orion", "Orion AI Assistant", "Core personal AI workflow and tooling", "active", null, 68, "claude", ts, ts);
  insertProject.run("proj-ops", "Personal Ops Hub", "Systemize planning and execution", "blocked", null, 42, "mission_control", ts, ts);
  insertProject.run("proj-portal", "Client Portal v2", "Client-facing project portal", "active", null, 23, "chatgpt", ts, ts);
  insertProject.run(INBOX_PROJECT_ID, "Inbox", "System default project for uncategorized tasks.", "active", null, 0, "mission_control", ts, ts);

  const insertTask = db.prepare(
    "INSERT INTO tasks (id, title, details, status, priority, due_date, scheduled_at, completed_at, project_id, source, order_index, recurrence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  insertTask.run(
    "task-1",
    "Finalize import validator",
    null,
    "in_progress",
    "high",
    "2026-02-14T17:00:00.000Z",
    "2026-02-14T15:00:00.000Z",
    null,
    "proj-orion",
    "mission_control",
    0,
    "none",
    ts,
    ts
  );
  insertTask.run(
    "task-2",
    "Map Apple Notes folders",
    null,
    "todo",
    "medium",
    "2026-02-15T20:00:00.000Z",
    null,
    null,
    "proj-ops",
    "apple_notes",
    0,
    "weekly",
    ts,
    ts
  );
  insertTask.run(
    "task-3",
    "Backfill Claude project statuses",
    null,
    "blocked",
    "high",
    "2026-02-13T18:00:00.000Z",
    "2026-02-13T16:00:00.000Z",
    null,
    "proj-orion",
    "claude",
    0,
    "none",
    ts,
    ts
  );

  const insertImport = db.prepare("INSERT INTO import_statuses (source, imported_count, last_imported_at) VALUES (?, ?, ?)");
  insertImport.run("apple_reminders", 124, ts);
  insertImport.run("apple_notes", 56, ts);
  insertImport.run("claude", 18, ts);

  const insertLegacyNote = db.prepare(
    "INSERT INTO notes (id, title, content, project_id, task_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertLegacyNote.run("legacy-note-1", "Meeting Notes - Orion", "Imported from Apple Notes.", "proj-orion", null, "apple_notes", ts, ts);

  normalizeTaskOrder(db);
}

function maybeMigrateLegacyJson(db: SqliteDatabase): boolean {
  if (!existsSync(LEGACY_STORE_PATH)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(LEGACY_STORE_PATH, "utf8")) as {
      projects?: Project[];
      tasks?: Task[];
      notes?: LegacyNote[];
      importStatuses?: ImportStatus[];
      activity?: ActivityLog[];
    };

    const counters: Record<TaskStatus, number> = { todo: 0, in_progress: 0, blocked: 0, parking_lot: 0, done: 0 };

    const tx = db.transaction(() => {
      const p = db.prepare(
        "INSERT INTO projects (id, title, description, status, due_date, completion_percent, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const item of parsed.projects ?? []) {
        p.run(item.id, item.title, item.description, item.status, item.dueDate ?? null, item.completionPercent, item.source, item.createdAt, item.updatedAt);
      }

      const t = db.prepare(
        "INSERT INTO tasks (id, title, details, status, priority, due_date, scheduled_at, completed_at, project_id, source, order_index, recurrence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const item of parsed.tasks ?? []) {
        const order = typeof item.order === "number" ? item.order : counters[item.status]++;
        t.run(
          item.id,
          item.title,
          item.details,
          item.status,
          item.priority,
          item.dueDate,
          item.scheduledAt,
          item.completedAt,
          item.projectId || INBOX_PROJECT_ID,
          item.source,
          order,
          item.recurrence ?? "none",
          item.createdAt,
          item.updatedAt
        );
      }

      const n = db.prepare(
        "INSERT INTO notes (id, title, content, project_id, task_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const item of parsed.notes ?? []) {
        n.run(item.id, item.title, item.content, item.projectId, item.taskId, item.source, item.createdAt, item.updatedAt);
      }

      const i = db.prepare("INSERT INTO import_statuses (source, imported_count, last_imported_at) VALUES (?, ?, ?)");
      for (const item of parsed.importStatuses ?? []) {
        i.run(item.source, item.importedCount, item.lastImportedAt);
      }

      const a = db.prepare("INSERT INTO activity (id, entity_type, entity_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const item of parsed.activity ?? []) {
        a.run(item.id, item.entityType, item.entityId, item.action, JSON.stringify(item.payload ?? {}), item.createdAt);
      }
    });

    tx();
    return true;
  } catch {
    return false;
  }
}

function initializeDatabase(db: SqliteDatabase): void {
  createSchema(db);
  ensureTaskAndLegacyNoteColumns(db);

  const count = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  if (count.count === 0) {
    if (!maybeMigrateLegacyJson(db)) {
      seedDefaults(db);
    }
  }

  ensureInboxProject(db);
  enforceTaskOwnership(db);
  normalizeTaskOrder(db);
  migrateLegacyNotesToContent(db);
}

function getDb(): SqliteDatabase {
  if (dbInstance) {
    return dbInstance;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new DatabaseSync(DB_PATH);

  const maybeTx = (dbInstance as unknown as { transaction?: unknown }).transaction;
  if (typeof maybeTx !== "function") {
    (dbInstance as unknown as { transaction: (fn: () => void) => () => void }).transaction = (fn: () => void) => {
      return () => {
        dbInstance?.exec("BEGIN");
        try {
          fn();
          dbInstance?.exec("COMMIT");
        } catch (error) {
          dbInstance?.exec("ROLLBACK");
          throw error;
        }
      };
    };
  }

  initializeDatabase(dbInstance);
  return dbInstance;
}

export async function listProjects(): Promise<Project[]> {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title, description, status, due_date, completion_percent, source, created_at, updated_at FROM projects ORDER BY updated_at DESC")
    .all() as SqliteRow[];
  return rows.map(rowToProject);
}

export async function createProject(input: {
  title: string;
  description?: string | null;
  status?: ProjectStatus;
  dueDate?: string | null;
  source?: SourceType;
}): Promise<Project> {
  const db = getDb();
  const ts = new Date().toISOString();
  const item: Project = {
    id: createId("proj"),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    status: input.status ?? "planned",
    dueDate: input.dueDate ?? null,
    completionPercent: input.status === "done" ? 100 : 0,
    source: input.source ?? "mission_control",
    createdAt: ts,
    updatedAt: ts
  };

  db.prepare(
    "INSERT INTO projects (id, title, description, status, due_date, completion_percent, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(item.id, item.title, item.description, item.status, item.dueDate, item.completionPercent, item.source, item.createdAt, item.updatedAt);

  insertActivity("project", item.id, "created", { title: item.title });
  return item;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "description" | "status" | "dueDate" | "completionPercent">>
): Promise<Project | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, title, description, status, due_date, completion_percent, source, created_at, updated_at FROM projects WHERE id = ?")
    .get(id) as SqliteRow | undefined;
  if (!row) {
    return null;
  }

  const current = rowToProject(row);
  const item: Project = {
    ...current,
    title: typeof patch.title === "string" ? patch.title.trim() : current.title,
    description: typeof patch.description === "string" || patch.description === null ? patch.description : current.description,
    status: patch.status ?? current.status,
    dueDate: typeof patch.dueDate === "string" || patch.dueDate === null ? patch.dueDate : current.dueDate,
    completionPercent:
      typeof patch.completionPercent === "number" ? Math.max(0, Math.min(100, patch.completionPercent)) : current.completionPercent,
    updatedAt: new Date().toISOString()
  };

  db.prepare("UPDATE projects SET title = ?, description = ?, status = ?, due_date = ?, completion_percent = ?, updated_at = ? WHERE id = ?").run(
    item.title,
    item.description,
    item.status,
    item.dueDate,
    item.completionPercent,
    item.updatedAt,
    id
  );

  insertActivity("project", id, "updated", patch as Record<string, unknown>);
  return item;
}

export async function deleteProject(id: string): Promise<boolean> {
  if (id === INBOX_PROJECT_ID) {
    return false;
  }
  const db = getDb();
  const exists = db.prepare("SELECT id FROM projects WHERE id = ?").get(id) as { id: string } | undefined;
  if (!exists) {
    return false;
  }

  ensureInboxProject(db);
  db.prepare("UPDATE tasks SET project_id = ? WHERE project_id = ?").run(INBOX_PROJECT_ID, id);
  db.prepare("UPDATE content_entries SET parent_id = ? WHERE parent_type = 'project' AND parent_id = ?").run(INBOX_PROJECT_ID, id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  insertActivity("project", id, "deleted", {});
  return true;
}

export async function listTasks(): Promise<Task[]> {
  return listTaskRows(getDb()).map(rowToTask);
}

export async function createTask(input: {
  title: string;
  details?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  scheduledAt?: string | null;
  projectId?: string | null;
  source?: SourceType;
  recurrence?: Recurrence;
}): Promise<Task> {
  const db = getDb();
  const ts = new Date().toISOString();
  const status = input.status ?? "todo";
  const recurrence: Recurrence = RECURRENCES.includes(input.recurrence ?? "none") ? (input.recurrence ?? "none") : "none";

  let projectId = input.projectId ?? INBOX_PROJECT_ID;
  if (!projectExists(db, projectId)) {
    projectId = ensureInboxProject(db);
  }

  const item: Task = {
    id: createId("task"),
    title: input.title.trim(),
    details: input.details?.trim() || null,
    status,
    priority: input.priority ?? "medium",
    dueDate: input.dueDate ?? null,
    scheduledAt: input.scheduledAt ?? null,
    completedAt: status === "done" ? ts : null,
    projectId,
    source: input.source ?? "mission_control",
    order: getNextTaskOrder(db, status),
    recurrence,
    createdAt: ts,
    updatedAt: ts
  };

  db.prepare(
    "INSERT INTO tasks (id, title, details, status, priority, due_date, scheduled_at, completed_at, project_id, source, order_index, recurrence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    item.id,
    item.title,
    item.details,
    item.status,
    item.priority,
    item.dueDate,
    item.scheduledAt,
    item.completedAt,
    item.projectId,
    item.source,
    item.order,
    item.recurrence,
    item.createdAt,
    item.updatedAt
  );

  insertActivity("task", item.id, "created", { title: item.title });
  return item;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "details" | "status" | "priority" | "dueDate" | "scheduledAt" | "projectId" | "order" | "recurrence">>
): Promise<Task | null> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, title, details, status, priority, due_date, scheduled_at, completed_at, project_id, source, order_index, recurrence, created_at, updated_at FROM tasks WHERE id = ?"
    )
    .get(id) as SqliteRow | undefined;
  if (!row) {
    return null;
  }

  if (patch.projectId === null) {
    return null;
  }

  const current = rowToTask(row);
  const nextStatus = patch.status ?? current.status;
  const nextRecurrence: Recurrence = patch.recurrence && RECURRENCES.includes(patch.recurrence) ? patch.recurrence : current.recurrence;

  let nextOrder = current.order;
  if (typeof patch.order === "number") {
    nextOrder = Math.max(0, Math.trunc(patch.order));
  } else if (nextStatus !== current.status) {
    nextOrder = getNextTaskOrder(db, nextStatus);
  }

  let projectId = current.projectId;
  if (typeof patch.projectId === "string") {
    projectId = projectExists(db, patch.projectId) ? patch.projectId : ensureInboxProject(db);
  }

  const item: Task = {
    ...current,
    title: typeof patch.title === "string" ? patch.title.trim() : current.title,
    details: typeof patch.details === "string" || patch.details === null ? patch.details : current.details,
    status: nextStatus,
    priority: patch.priority ?? current.priority,
    dueDate: typeof patch.dueDate === "string" || patch.dueDate === null ? patch.dueDate : current.dueDate,
    scheduledAt: typeof patch.scheduledAt === "string" || patch.scheduledAt === null ? patch.scheduledAt : current.scheduledAt,
    completedAt: nextStatus === "done" ? new Date().toISOString() : null,
    projectId,
    order: nextOrder,
    recurrence: nextRecurrence,
    updatedAt: new Date().toISOString()
  };

  db.prepare(
    "UPDATE tasks SET title = ?, details = ?, status = ?, priority = ?, due_date = ?, scheduled_at = ?, completed_at = ?, project_id = ?, order_index = ?, recurrence = ?, updated_at = ? WHERE id = ?"
  ).run(
    item.title,
    item.details,
    item.status,
    item.priority,
    item.dueDate,
    item.scheduledAt,
    item.completedAt,
    item.projectId,
    item.order,
    item.recurrence,
    item.updatedAt,
    id
  );

  if (current.status !== item.status) {
    normalizeTaskOrder(db);
  }

  if (current.status !== "done" && item.status === "done" && item.recurrence !== "none") {
    await createTask({
      title: item.title,
      details: item.details,
      status: "todo",
      priority: item.priority,
      dueDate: addRecurrenceDate(item.dueDate, item.recurrence),
      scheduledAt: addRecurrenceDate(item.scheduledAt, item.recurrence),
      projectId: item.projectId,
      source: item.source,
      recurrence: item.recurrence
    });
  }

  insertActivity("task", id, "updated", patch as Record<string, unknown>);
  return item;
}

export async function reorderTasksInLane(input: { movedTaskId: string; toStatus: TaskStatus; orderedTaskIds: string[] }): Promise<Task[] | null> {
  const db = getDb();
  const moved = db.prepare("SELECT id, status FROM tasks WHERE id = ?").get(input.movedTaskId) as { id: string; status: TaskStatus } | undefined;
  if (!moved) {
    return null;
  }

  const orderedIds = Array.from(new Set(input.orderedTaskIds.filter(Boolean)));
  if (!orderedIds.includes(input.movedTaskId)) {
    return null;
  }

  if (orderedIds.length > 0) {
    const placeholders = orderedIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id, status FROM tasks WHERE id IN (${placeholders})`).all(...orderedIds) as Array<{ id: string; status: TaskStatus }>;
    if (rows.length !== orderedIds.length) {
      return null;
    }
    for (const row of rows) {
      if (row.id !== input.movedTaskId && row.status !== input.toStatus) {
        return null;
      }
    }
  }

  const tx = db.transaction(() => {
    const ts = new Date().toISOString();
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(input.toStatus, ts, input.movedTaskId);

    let remaining: Array<{ id: string }>;
    if (orderedIds.length > 0) {
      const placeholders = orderedIds.map(() => "?").join(",");
      remaining = db
        .prepare(`SELECT id FROM tasks WHERE status = ? AND id NOT IN (${placeholders}) ORDER BY order_index ASC, updated_at DESC, id ASC`)
        .all(input.toStatus, ...orderedIds) as Array<{ id: string }>;
    } else {
      remaining = db
        .prepare("SELECT id FROM tasks WHERE status = ? AND id <> ? ORDER BY order_index ASC, updated_at DESC, id ASC")
        .all(input.toStatus, input.movedTaskId) as Array<{ id: string }>;
    }

    const finalIds = [...orderedIds, ...remaining.map((item) => item.id)];
    finalIds.forEach((taskId, index) => {
      db.prepare("UPDATE tasks SET status = ?, order_index = ?, updated_at = ? WHERE id = ?").run(input.toStatus, index, ts, taskId);
    });

    if (moved.status !== input.toStatus) {
      const sourceRows = db
        .prepare("SELECT id FROM tasks WHERE status = ? ORDER BY order_index ASC, updated_at DESC, id ASC")
        .all(moved.status) as Array<{ id: string }>;
      sourceRows.forEach((row, index) => {
        db.prepare("UPDATE tasks SET order_index = ? WHERE id = ?").run(index, row.id);
      });
    }
  });

  tx();
  insertActivity("task", input.movedTaskId, "reordered", { toStatus: input.toStatus, orderedTaskIds: orderedIds });
  return listTasks();
}

export async function deleteTask(id: string): Promise<boolean> {
  const db = getDb();
  const task = db.prepare("SELECT id, status FROM tasks WHERE id = ?").get(id) as { id: string; status: TaskStatus } | undefined;
  if (!task) {
    return false;
  }

  db.prepare("DELETE FROM content_entries WHERE parent_type = 'task' AND parent_id = ?").run(id);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

  const rows = db.prepare("SELECT id FROM tasks WHERE status = ? ORDER BY order_index ASC, updated_at DESC, id ASC").all(task.status) as Array<{
    id: string;
  }>;
  rows.forEach((row, index) => {
    db.prepare("UPDATE tasks SET order_index = ? WHERE id = ?").run(index, row.id);
  });

  insertActivity("task", id, "deleted", {});
  return true;
}

export async function listContentEntries(parentType: ContentParentType, parentId: string): Promise<ContentEntry[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.id, e.parent_type, e.parent_id, e.entry_type, e.text_content, e.url, e.asset_id, e.created_at, e.updated_at,
              a.id AS asset_id, a.file_path, a.mime_type, a.file_size, a.width, a.height, a.created_at AS asset_created_at
       FROM content_entries e
       LEFT JOIN content_assets a ON a.id = e.asset_id
       WHERE e.parent_type = ? AND e.parent_id = ?
       ORDER BY e.created_at DESC`
    )
    .all(parentType, parentId) as SqliteRow[];
  return rows.map(rowToContentEntry);
}

export async function createContentAsset(input: {
  filePath: string;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
}): Promise<ContentAsset> {
  const db = getDb();
  const item: ContentAsset = {
    id: createId("asset"),
    filePath: input.filePath,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    width: input.width ?? null,
    height: input.height ?? null,
    createdAt: new Date().toISOString()
  };

  db.prepare("INSERT INTO content_assets (id, file_path, mime_type, file_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    item.id,
    item.filePath,
    item.mimeType,
    item.fileSize,
    item.width,
    item.height,
    item.createdAt
  );

  return item;
}

export async function getContentAssetById(id: string): Promise<ContentAsset | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, file_path, mime_type, file_size, width, height, created_at FROM content_assets WHERE id = ?")
    .get(id) as SqliteRow | undefined;
  return row ? rowToAsset(row) : null;
}

export async function saveContentAssetFromBuffer(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}): Promise<ContentAsset> {
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const id = createId("asset");
  const extFromName = path.extname(input.originalName).toLowerCase();
  const extByMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const ext = extFromName || extByMime[input.mimeType] || ".bin";
  const filename = `${id}${ext}`;
  const absolutePath = path.join(UPLOADS_DIR, filename);
  await writeFile(absolutePath, input.buffer);

  return createContentAsset({
    filePath: path.join("data", "uploads", filename),
    mimeType: input.mimeType,
    fileSize: input.buffer.byteLength,
    width: input.width ?? null,
    height: input.height ?? null
  });
}

export async function createContentEntry(input: {
  parentType: ContentParentType;
  parentId: string;
  entryType: ContentEntryType;
  textContent?: string | null;
  url?: string | null;
  assetId?: string | null;
}): Promise<ContentEntry | null> {
  const db = getDb();
  if (input.parentType === "project" && !projectExists(db, input.parentId)) {
    return null;
  }
  if (input.parentType === "task") {
    const row = db.prepare("SELECT id FROM tasks WHERE id = ?").get(input.parentId) as { id: string } | undefined;
    if (!row) {
      return null;
    }
  }

  if (input.entryType === "url") {
    try {
      if (!input.url) {
        return null;
      }
      const parsed = new URL(input.url);
      if (!parsed.protocol.startsWith("http")) {
        return null;
      }
    } catch {
      return null;
    }
  }

  if (input.entryType === "image") {
    if (!input.assetId) {
      return null;
    }
    const row = db.prepare("SELECT id FROM content_assets WHERE id = ?").get(input.assetId) as { id: string } | undefined;
    if (!row) {
      return null;
    }
  }

  const ts = new Date().toISOString();
  const id = createId("entry");
  db.prepare(
    "INSERT INTO content_entries (id, parent_type, parent_id, entry_type, text_content, url, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.parentType,
    input.parentId,
    input.entryType,
    input.textContent ?? null,
    input.url ?? null,
    input.assetId ?? null,
    ts,
    ts
  );

  insertActivity("content", id, "created", { parentType: input.parentType, parentId: input.parentId, entryType: input.entryType });
  const entries = await listContentEntries(input.parentType, input.parentId);
  return entries.find((entry) => entry.id === id) ?? null;
}

export async function updateContentEntry(
  id: string,
  patch: Partial<Pick<ContentEntry, "textContent" | "url" | "assetId">>
): Promise<ContentEntry | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, parent_type, parent_id, entry_type, text_content, url, asset_id, created_at, updated_at FROM content_entries WHERE id = ?")
    .get(id) as SqliteRow | undefined;

  if (!row) {
    return null;
  }

  const current = rowToContentEntry({ ...row, file_path: null, mime_type: null, file_size: null, width: null, height: null, asset_created_at: null });

  if (row.entry_type === "url" && typeof patch.url === "string") {
    try {
      const parsed = new URL(patch.url);
      if (!parsed.protocol.startsWith("http")) {
        return null;
      }
    } catch {
      return null;
    }
  }

  if (typeof patch.assetId === "string") {
    const asset = db.prepare("SELECT id FROM content_assets WHERE id = ?").get(patch.assetId) as { id: string } | undefined;
    if (!asset) {
      return null;
    }
  }

  const updatedAt = new Date().toISOString();
  const textContent = typeof patch.textContent === "string" || patch.textContent === null ? patch.textContent : current.textContent;
  const url = typeof patch.url === "string" || patch.url === null ? patch.url : current.url;
  const assetId = typeof patch.assetId === "string" || patch.assetId === null ? patch.assetId : current.assetId;

  db.prepare("UPDATE content_entries SET text_content = ?, url = ?, asset_id = ?, updated_at = ? WHERE id = ?").run(
    textContent,
    url,
    assetId,
    updatedAt,
    id
  );

  insertActivity("content", id, "updated", patch as Record<string, unknown>);
  const entries = await listContentEntries(current.parentType, current.parentId);
  return entries.find((entry) => entry.id === id) ?? null;
}

export async function deleteContentEntry(id: string): Promise<boolean> {
  const db = getDb();
  const row = db.prepare("SELECT id FROM content_entries WHERE id = ?").get(id) as { id: string } | undefined;
  if (!row) {
    return false;
  }
  db.prepare("DELETE FROM content_entries WHERE id = ?").run(id);
  insertActivity("content", id, "deleted", {});
  return true;
}

export async function listImportStatuses(): Promise<ImportStatus[]> {
  const db = getDb();
  const rows = db.prepare("SELECT source, imported_count, last_imported_at FROM import_statuses ORDER BY source").all() as SqliteRow[];
  return rows.map(rowToImportStatus);
}

export async function bumpImportStatus(source: SourceType, count: number): Promise<void> {
  const db = getDb();
  const ts = new Date().toISOString();
  const row = db.prepare("SELECT source FROM import_statuses WHERE source = ?").get(source) as { source: string } | undefined;
  if (row) {
    db.prepare("UPDATE import_statuses SET imported_count = imported_count + ?, last_imported_at = ? WHERE source = ?").run(count, ts, source);
  } else {
    db.prepare("INSERT INTO import_statuses (source, imported_count, last_imported_at) VALUES (?, ?, ?)").run(source, count, ts);
  }
  insertActivity("import", source, "imported", { count });
}

export async function listActivity(): Promise<ActivityLog[]> {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, entity_type, entity_id, action, payload, created_at FROM activity ORDER BY created_at DESC LIMIT 100")
    .all() as SqliteRow[];
  return rows.map(rowToActivity);
}

export function buildDashboardSummary(tasks: Task[]): { overdue: number; dueToday: number; blocked: number; completedThisWeek: number } {
  const nowDate = new Date();
  const today = nowDate.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(nowDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let overdue = 0;
  let dueToday = 0;
  let blocked = 0;
  let completedThisWeek = 0;

  for (const task of tasks) {
    if (task.status === "blocked") {
      blocked += 1;
    }
    if (task.dueDate && task.status !== "done") {
      const dueDateOnly = task.dueDate.slice(0, 10);
      if (dueDateOnly < today) {
        overdue += 1;
      }
      if (dueDateOnly === today) {
        dueToday += 1;
      }
    }
    if (task.completedAt && new Date(task.completedAt) >= sevenDaysAgo) {
      completedThisWeek += 1;
    }
  }

  return { overdue, dueToday, blocked, completedThisWeek };
}
