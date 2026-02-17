import {
  bumpImportStatus,
  createContentEntry,
  createProject,
  createTask,
  ensureInboxProject,
  listProjects,
  listTasks,
  updateProject,
  updateTask
} from "@/src/lib/store";
import {
  ImportAction,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportDuplicateMatch,
  ImportEntityType,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportPreviewRow,
  ImportType,
  SourceType,
  TaskStatus
} from "@/src/lib/types";

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split(",").map((item) => item.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((item) => item.trim()));
  return { headers, rows };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function bigrams(value: string): Set<string> {
  const text = ` ${normalize(value)} `;
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function diceSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of A) {
    if (B.has(token)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (A.size + B.size);
}

function requiredHeadersByType(type: ImportType): string[] {
  switch (type) {
    case "apple_reminders":
    case "apple_notes":
    case "chatgpt_projects":
    case "claude_projects":
      return ["title"];
    default:
      return [];
  }
}

function typeToSource(type: ImportType): SourceType {
  if (type === "apple_reminders") {
    return "apple_reminders";
  }
  if (type === "apple_notes") {
    return "apple_notes";
  }
  if (type === "chatgpt_projects") {
    return "chatgpt";
  }
  return "claude";
}

function typeToEntity(type: ImportType): ImportEntityType | null {
  if (type === "apple_reminders") {
    return "task";
  }
  if (type === "chatgpt_projects" || type === "claude_projects") {
    return "project";
  }
  return null;
}

function normalizeProjectStatus(raw?: string): "planned" | "active" | "blocked" | "done" {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "active" || value === "blocked" || value === "done") {
    return value;
  }
  return "planned";
}

function normalizeTaskStatus(raw?: string): TaskStatus {
  const value = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (value === "in_progress" || value === "blocked" || value === "parking_lot" || value === "done") {
    return value;
  }
  return "todo";
}

async function findDuplicate(source: SourceType, entityType: ImportEntityType, title: string): Promise<ImportDuplicateMatch | null> {
  if (entityType === "task") {
    const tasks = (await listTasks()).filter((item) => item.source === source);
    const exact = tasks.find((item) => normalize(item.title) === normalize(title));
    if (exact) {
      return { entityType, id: exact.id, title: exact.title, score: 1, kind: "exact" };
    }

    let best: { id: string; title: string; score: number } | null = null;
    for (const item of tasks) {
      const score = diceSimilarity(item.title, title);
      if (!best || score > best.score) {
        best = { id: item.id, title: item.title, score };
      }
    }
    if (best && best.score >= 0.72) {
      return { entityType, id: best.id, title: best.title, score: Number(best.score.toFixed(2)), kind: "fuzzy" };
    }
    return null;
  }

  const projects = (await listProjects()).filter((item) => item.source === source);
  const exact = projects.find((item) => normalize(item.title) === normalize(title));
  if (exact) {
    return { entityType, id: exact.id, title: exact.title, score: 1, kind: "exact" };
  }

  let best: { id: string; title: string; score: number } | null = null;
  for (const item of projects) {
    const score = diceSimilarity(item.title, title);
    if (!best || score > best.score) {
      best = { id: item.id, title: item.title, score };
    }
  }
  if (best && best.score >= 0.72) {
    return { entityType, id: best.id, title: best.title, score: Number(best.score.toFixed(2)), kind: "fuzzy" };
  }
  return null;
}

function suggestedAction(match: ImportDuplicateMatch | null): ImportAction {
  if (!match) {
    return "create";
  }
  return match.kind === "exact" ? "update" : "skip";
}

export async function previewImport(payload: ImportPreviewRequest): Promise<ImportPreviewResponse> {
  const { headers, rows } = parseCsv(payload.text);
  const requiredHeaders = requiredHeadersByType(payload.type);
  const missingHeaders = requiredHeaders.filter((required) => !headers.includes(required));

  if (missingHeaders.length > 0) {
    return {
      headers,
      rows: [
        {
          line: 1,
          values: {},
          error: `Missing headers: ${missingHeaders.join(", ")}`,
          duplicateMatch: null,
          suggestedAction: "skip"
        }
      ],
      validRows: 0,
      invalidRows: 1
    };
  }

  const source = typeToSource(payload.type);
  const entityType = typeToEntity(payload.type);
  const parsedRows: ImportPreviewRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const values: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      values[header] = row[headerIndex] ?? "";
    });

    const title = values.title?.trim() ?? "";
    if (!title) {
      parsedRows.push({
        line: index + 2,
        values,
        error: "Missing required title",
        duplicateMatch: null,
        suggestedAction: "skip"
      });
      continue;
    }

    const duplicateMatch = entityType ? await findDuplicate(source, entityType, title) : null;
    parsedRows.push({
      line: index + 2,
      values,
      error: null,
      duplicateMatch,
      suggestedAction: suggestedAction(duplicateMatch)
    });
  }

  const invalidRows = parsedRows.filter((row) => row.error).length;
  return {
    headers,
    rows: parsedRows,
    validRows: parsedRows.length - invalidRows,
    invalidRows
  };
}

function normalizeCommitRows(payload: ImportCommitRequest): ImportCommitRequest["rows"] {
  return payload.rows.map((row) => {
    if (Object.prototype.hasOwnProperty.call(row, "values")) {
      return row;
    }
    const legacy = row as unknown as Record<string, string>;
    return { values: legacy, action: "create", duplicateMatch: null };
  });
}

export async function commitImport(payload: ImportCommitRequest): Promise<ImportCommitResponse> {
  const source = typeToSource(payload.type);
  const rows = normalizeCommitRows(payload);

  let createdProjects = 0;
  let updatedProjects = 0;
  let createdTasks = 0;
  let updatedTasks = 0;
  let createdContentEntries = 0;
  let updatedContentEntries = 0;
  let skippedRows = 0;

  const inboxId = ensureInboxProject();

  for (const row of rows) {
    const values = row.values;
    const title = values.title?.trim();
    if (!title || row.action === "skip") {
      skippedRows += 1;
      continue;
    }

    if (payload.type === "apple_reminders") {
      const projectId = values.project_id?.trim() || inboxId;
      if (row.action === "update" && row.duplicateMatch?.entityType === "task") {
        const item = await updateTask(row.duplicateMatch.id, {
          title,
          details: values.notes || null,
          dueDate: values.due_date || null,
          status: normalizeTaskStatus(values.status),
          projectId
        });
        if (item) {
          updatedTasks += 1;
          continue;
        }
      }

      await createTask({
        title,
        details: values.notes || null,
        dueDate: values.due_date || null,
        status: normalizeTaskStatus(values.status),
        projectId,
        source
      });
      createdTasks += 1;
      continue;
    }

    if (payload.type === "apple_notes") {
      const parentType = values.task_id?.trim() ? "task" : "project";
      const parentId = values.task_id?.trim() || values.project_id?.trim() || inboxId;
      const created = await createContentEntry({
        parentType,
        parentId,
        entryType: "text",
        textContent: values.content?.trim() || title
      });
      if (created) {
        createdContentEntries += 1;
      } else {
        skippedRows += 1;
      }
      continue;
    }

    if (row.action === "update" && row.duplicateMatch?.entityType === "project") {
      const item = await updateProject(row.duplicateMatch.id, {
        title,
        description: values.notes || null,
        dueDate: values.due_date || null,
        status: normalizeProjectStatus(values.status)
      });
      if (item) {
        updatedProjects += 1;
        continue;
      }
    }

    await createProject({
      title,
      description: values.notes || null,
      dueDate: values.due_date || null,
      status: normalizeProjectStatus(values.status),
      source
    });
    createdProjects += 1;
  }

  const changed = createdProjects + createdTasks + createdContentEntries + updatedProjects + updatedTasks + updatedContentEntries;
  if (changed > 0) {
    await bumpImportStatus(source, changed);
  }

  return {
    createdProjects,
    updatedProjects,
    createdTasks,
    updatedTasks,
    createdContentEntries,
    updatedContentEntries,
    skippedRows
  };
}
