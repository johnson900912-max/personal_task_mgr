"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ContentEntry,
  DashboardSummary,
  ImportAction,
  ImportType,
  Project,
  ProjectStatus,
  Recurrence,
  Task,
  TaskStatus
} from "@/src/lib/types";

const taskColumns: { label: string; status: TaskStatus }[] = [
  { label: "Todo", status: "todo" },
  { label: "In Progress", status: "in_progress" },
  { label: "Blocked", status: "blocked" },
  { label: "Parking Lot", status: "parking_lot" },
  { label: "Done", status: "done" }
];

const statusOrder: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  blocked: 2,
  parking_lot: 3,
  done: 4
};

type PreviewRow = {
  line: number;
  values: Record<string, string>;
  error: string | null;
  duplicateMatch: {
    entityType: "task" | "project";
    id: string;
    title: string;
    score: number;
    kind: "exact" | "fuzzy";
  } | null;
  suggestedAction: ImportAction;
  selectedAction: ImportAction;
};

type PreviewResult = {
  headers: string[];
  rows: PreviewRow[];
  validRows: number;
  invalidRows: number;
};

type TaskSortMode = "kanban_order" | "due_asc";

const initialSummary: DashboardSummary = {
  overdue: 0,
  dueToday: 0,
  blocked: 0,
  completedThisWeek: 0
};

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function laneTasksByOrder(tasks: Task[], status: TaskStatus): Task[] {
  return tasks
    .filter((task) => task.status === status)
    .sort((a, b) => (a.order === b.order ? b.updatedAt.localeCompare(a.updatedAt) : a.order - b.order));
}

function laneTasksForView(tasks: Task[], status: TaskStatus, sortMode: TaskSortMode): Task[] {
  const lane = tasks.filter((task) => task.status === status);
  if (sortMode === "due_asc") {
    return lane.sort((a, b) => {
      const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  return lane.sort((a, b) => (a.order === b.order ? b.updatedAt.localeCompare(a.updatedAt) : a.order - b.order));
}

function formatDate(value: string | null): string {
  if (!value) {
    return "No due date";
  }
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toDateInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) {
    return direct[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function shiftMonth(value: Date, delta: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

function buildCalendarDays(month: Date): Array<{ key: string; inMonth: boolean }> {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return { key: dateKey(day), inMonth: day.getMonth() === month.getMonth() };
  });
}

function priorityClass(priority: Task["priority"]): string {
  return `priority-${priority}`;
}

function projectAccent(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 75%, 58%)`;
}

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) {
        detail = `: ${body.error}`;
      }
    } else {
      const text = await res.text().catch(() => "");
      if (text) {
        detail = `: ${text}`;
      }
    }
    throw new Error(`Request failed: ${res.status}${detail}`);
  }
  return res.json();
}

function applyLocalReorder(tasks: Task[], movedTaskId: string, toStatus: TaskStatus, orderedTaskIds: string[]): Task[] {
  const next = tasks.map((task) => ({ ...task }));
  const moved = next.find((task) => task.id === movedTaskId);
  if (!moved) {
    return tasks;
  }
  moved.status = toStatus;

  const byId = new Map(next.map((task) => [task.id, task]));
  const lanes: Record<TaskStatus, string[]> = {
    todo: laneTasksByOrder(next, "todo").map((task) => task.id),
    in_progress: laneTasksByOrder(next, "in_progress").map((task) => task.id),
    blocked: laneTasksByOrder(next, "blocked").map((task) => task.id),
    parking_lot: laneTasksByOrder(next, "parking_lot").map((task) => task.id),
    done: laneTasksByOrder(next, "done").map((task) => task.id)
  };

  for (const status of Object.keys(lanes) as TaskStatus[]) {
    lanes[status] = lanes[status].filter((id) => byId.get(id)?.status === status);
  }

  const existingLane = lanes[toStatus].filter((id) => id !== movedTaskId);
  const front = orderedTaskIds.filter((id) => existingLane.includes(id) || id === movedTaskId);
  const tail = existingLane.filter((id) => !front.includes(id));
  lanes[toStatus] = [...front, ...tail];

  for (const status of Object.keys(lanes) as TaskStatus[]) {
    lanes[status].forEach((id, index) => {
      const task = byId.get(id);
      if (task) {
        task.order = index;
      }
    });
  }

  return sortTasks(next);
}

export function Dashboard() {
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(initialSummary);

  const [projectTitle, setProjectTitle] = useState("");
  const [projectDueDate, setProjectDueDate] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskRecurrence, setTaskRecurrence] = useState<Recurrence>("none");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>("kanban_order");
  const [taskProjectFilter, setTaskProjectFilter] = useState<string>("all");

  const [selectedProjectFeedId, setSelectedProjectFeedId] = useState("");
  const [selectedTaskFeedId, setSelectedTaskFeedId] = useState("");
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [activeTaskModalId, setActiveTaskModalId] = useState<string | null>(null);
  const [taskCalendarMonth, setTaskCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [projectFeedEntries, setProjectFeedEntries] = useState<ContentEntry[]>([]);
  const [taskFeedEntries, setTaskFeedEntries] = useState<ContentEntry[]>([]);

  const [projectText, setProjectText] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [projectFile, setProjectFile] = useState<File | null>(null);

  const [taskText, setTaskText] = useState("");
  const [taskUrl, setTaskUrl] = useState("");
  const [taskFile, setTaskFile] = useState<File | null>(null);

  const [importType, setImportType] = useState<ImportType>("apple_reminders");
  const [importText, setImportText] = useState("title,status,notes\nFollow up invoice,todo,Finance list");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: TaskStatus; beforeId: string | null } | null>(null);
  const [mobileMode, setMobileMode] = useState(false);

  const refreshSummary = useCallback(async () => {
    const summaryJson = await requestJson("/api/dashboard/summary");
    setSummary(summaryJson);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    const [projectsJson, tasksJson, summaryJson] = await Promise.all([
      requestJson("/api/projects"),
      requestJson("/api/tasks"),
      requestJson("/api/dashboard/summary")
    ]);

    const nextProjects: Project[] = projectsJson.items ?? [];
    const nextTasks: Task[] = sortTasks(tasksJson.items ?? []);

    setProjects(nextProjects);
    setTasks(nextTasks);
    setSummary(summaryJson);

    const inbox = nextProjects.find((project) => project.title === "Inbox");
    const projectFromQuery = searchParams.get("contentParentType") === "project" ? searchParams.get("contentParentId") : null;
    if (nextProjects.length === 0) {
      if (selectedProjectFeedId) {
        setSelectedProjectFeedId("");
      }
    } else if (!selectedProjectFeedId || !nextProjects.some((project) => project.id === selectedProjectFeedId)) {
      setSelectedProjectFeedId((projectFromQuery && nextProjects.find((project) => project.id === projectFromQuery)?.id) || inbox?.id || nextProjects[0].id);
    }

    if (nextTasks.length === 0) {
      if (selectedTaskFeedId) {
        setSelectedTaskFeedId("");
      }
    } else if (!selectedTaskFeedId || !nextTasks.some((task) => task.id === selectedTaskFeedId)) {
      const fromQuery = searchParams.get("contentParentType") === "task" ? searchParams.get("contentParentId") : null;
      setSelectedTaskFeedId((fromQuery && nextTasks.find((task) => task.id === fromQuery)?.id) || nextTasks[0].id);
    }

    if (activeTaskModalId && !nextTasks.some((task) => task.id === activeTaskModalId)) {
      setActiveTaskModalId(null);
    }
    if (expandedProjectId && !nextProjects.some((project) => project.id === expandedProjectId)) {
      setExpandedProjectId(null);
    }

    if (!newTaskProjectId && nextProjects.length > 0) {
      setNewTaskProjectId(inbox?.id || nextProjects[0].id);
    }

    setLoading(false);
  }, [activeTaskModalId, expandedProjectId, newTaskProjectId, searchParams, selectedProjectFeedId, selectedTaskFeedId]);

  const refreshFeeds = useCallback(async () => {
    const jobs: Promise<void>[] = [];
    if (selectedProjectFeedId) {
      jobs.push(
        requestJson(`/api/content?parentType=project&parentId=${encodeURIComponent(selectedProjectFeedId)}`).then((data) =>
          setProjectFeedEntries(data.items ?? [])
        )
      );
    } else {
      setProjectFeedEntries([]);
    }

    if (selectedTaskFeedId) {
      jobs.push(
        requestJson(`/api/content?parentType=task&parentId=${encodeURIComponent(selectedTaskFeedId)}`).then((data) => setTaskFeedEntries(data.items ?? []))
      );
    } else {
      setTaskFeedEntries([]);
    }

    await Promise.all(jobs);
  }, [selectedProjectFeedId, selectedTaskFeedId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void refreshFeeds();
  }, [refreshFeeds]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobileMode(query.matches || navigator.maxTouchPoints > 0);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!activeTaskModalId) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveTaskModalId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTaskModalId]);

  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const activeTask = useMemo(() => sortedTasks.find((task) => task.id === activeTaskModalId) ?? null, [activeTaskModalId, sortedTasks]);
  const visibleTasks = useMemo(
    () => (taskProjectFilter === "all" ? sortedTasks : sortedTasks.filter((task) => task.projectId === taskProjectFilter)),
    [sortedTasks, taskProjectFilter]
  );
  const canDragBoard = !mobileMode && taskSortMode === "kanban_order" && taskProjectFilter === "all";
  const activeTaskDueDateKey = activeTask ? toDateInput(activeTask.dueDate) : "";
  const calendarDays = useMemo(() => buildCalendarDays(taskCalendarMonth), [taskCalendarMonth]);
  const todayKey = dateKey(new Date());

  useEffect(() => {
    if (!activeTask) {
      return;
    }
    const selected = toDateInput(activeTask.dueDate);
    if (selected) {
      const local = new Date(`${selected}T00:00:00`);
      if (!Number.isNaN(local.getTime())) {
        setTaskCalendarMonth(startOfMonth(local));
        return;
      }
    }
    setTaskCalendarMonth(startOfMonth(new Date()));
  }, [activeTask?.id, activeTask?.dueDate]);

  function openProjectContext(projectId: string) {
    setSelectedProjectFeedId(projectId);
    setExpandedProjectId((current) => (current === projectId ? null : projectId));
  }

  function openTaskContext(taskId: string) {
    setSelectedTaskFeedId(taskId);
    setActiveTaskModalId(taskId);
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!projectTitle.trim()) {
      return;
    }
    await requestJson("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: projectTitle,
        dueDate: projectDueDate ? new Date(`${projectDueDate}T12:00:00`).toISOString() : null
      })
    });
    setProjectTitle("");
    setProjectDueDate("");
    await refreshAll();
  }

  async function handleCreateTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) {
      return;
    }
    if (!newTaskProjectId) {
      setMessage("Select a project for the task.");
      return;
    }

    const created = await requestJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskTitle,
        priority: taskPriority,
        recurrence: taskRecurrence,
        dueDate: taskDueDate ? new Date(`${taskDueDate}T12:00:00`).toISOString() : null,
        projectId: newTaskProjectId
      })
    });
    setTaskTitle("");
    setTaskRecurrence("none");
    setTaskDueDate("");
    const createdTaskId = created?.item?.id;
    if (typeof createdTaskId === "string") {
      setSelectedTaskFeedId(createdTaskId);
      setActiveTaskModalId(createdTaskId);
    }
    await refreshAll();
  }

  async function handleTaskStatus(taskId: string, status: TaskStatus) {
    await requestJson(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    await refreshAll();
  }

  async function handleTaskRecurrence(task: Task, recurrence: Recurrence) {
    await requestJson(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recurrence })
    });
    await refreshAll();
  }

  async function handleTaskDueDate(taskId: string, value: string) {
    await requestJson(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value ? new Date(`${value}T12:00:00`).toISOString() : null })
    });
    await refreshAll();
  }

  async function handleTaskPriority(taskId: string, priority: Task["priority"]) {
    await requestJson(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority })
    });
    await refreshAll();
  }

  async function handleTaskProject(taskId: string, projectId: string) {
    await requestJson(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    await refreshAll();
  }

  async function handleProjectStatus(projectId: string, status: ProjectStatus) {
    await requestJson(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    await refreshAll();
  }

  async function handleProjectDueDate(projectId: string, value: string) {
    await requestJson(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value ? new Date(`${value}T12:00:00`).toISOString() : null })
    });
    await refreshAll();
  }

  async function handleRenameProject(project: Project) {
    const title = window.prompt("Rename project", project.title)?.trim();
    if (!title || title === project.title) {
      return;
    }
    await requestJson(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    await refreshAll();
  }

  async function handleRenameTask(task: Task) {
    const title = window.prompt("Rename task", task.title)?.trim();
    if (!title || title === task.title) {
      return;
    }
    await requestJson(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    await refreshAll();
  }

  async function handleDelete(url: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }
    await requestJson(url, { method: "DELETE" });
    if (url.includes("/api/tasks/")) {
      const taskId = url.split("/").pop() ?? "";
      if (taskId && selectedTaskFeedId === taskId) {
        setSelectedTaskFeedId("");
      }
      if (taskId && activeTaskModalId === taskId) {
        setActiveTaskModalId(null);
      }
    }
    if (url.includes("/api/projects/")) {
      const projectId = url.split("/").pop() ?? "";
      if (projectId && selectedProjectFeedId === projectId) {
        setSelectedProjectFeedId("");
      }
      if (projectId && expandedProjectId === projectId) {
        setExpandedProjectId(null);
      }
    }
    await refreshAll();
    await refreshFeeds();
  }

  async function uploadImage(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const data = await requestJson("/api/content/upload", {
      method: "POST",
      body: form
    });
    return data.asset.id;
  }

  async function addProjectText() {
    if (!selectedProjectFeedId || !projectText.trim()) {
      return;
    }
    await requestJson("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentType: "project",
        parentId: selectedProjectFeedId,
        entryType: "text",
        textContent: projectText.trim()
      })
    });
    setProjectText("");
    await refreshFeeds();
  }

  async function addProjectUrl() {
    if (!selectedProjectFeedId || !projectUrl.trim()) {
      return;
    }
    await requestJson("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentType: "project",
        parentId: selectedProjectFeedId,
        entryType: "url",
        url: projectUrl.trim()
      })
    });
    setProjectUrl("");
    await refreshFeeds();
  }

  async function addProjectImage() {
    if (!selectedProjectFeedId || !projectFile) {
      return;
    }
    const assetId = await uploadImage(projectFile);
    await requestJson("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentType: "project",
        parentId: selectedProjectFeedId,
        entryType: "image",
        assetId
      })
    });
    setProjectFile(null);
    await refreshFeeds();
  }

  async function addTaskText() {
    if (!selectedTaskFeedId || !taskText.trim()) {
      return;
    }
    try {
      await requestJson("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentType: "task",
          parentId: selectedTaskFeedId,
          entryType: "text",
          textContent: taskText.trim()
        })
      });
      setTaskText("");
      await refreshFeeds();
      setMessage("Task text added.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to add task text.";
      setMessage(msg);
    }
  }

  async function addTaskUrl() {
    if (!selectedTaskFeedId || !taskUrl.trim()) {
      return;
    }
    try {
      await requestJson("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentType: "task",
          parentId: selectedTaskFeedId,
          entryType: "url",
          url: taskUrl.trim()
        })
      });
      setTaskUrl("");
      await refreshFeeds();
      setMessage("Task URL added.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to add task URL.";
      setMessage(msg);
    }
  }

  async function addTaskImage() {
    if (!selectedTaskFeedId || !taskFile) {
      return;
    }
    try {
      const assetId = await uploadImage(taskFile);
      await requestJson("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentType: "task",
          parentId: selectedTaskFeedId,
          entryType: "image",
          assetId
        })
      });
      setTaskFile(null);
      await refreshFeeds();
      setMessage("Task image added.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to add task image.";
      setMessage(msg);
    }
  }

  async function editEntry(entry: ContentEntry) {
    if (entry.entryType === "text") {
      const next = window.prompt("Edit text", entry.textContent || "");
      if (next === null) {
        return;
      }
      await requestJson(`/api/content/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textContent: next })
      });
      await refreshFeeds();
      return;
    }

    if (entry.entryType === "url") {
      const next = window.prompt("Edit URL", entry.url || "");
      if (next === null) {
        return;
      }
      await requestJson(`/api/content/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: next })
      });
      await refreshFeeds();
    }
  }

  async function handlePreviewImport() {
    const data = await requestJson("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: importType, text: importText })
    });

    const rows: PreviewRow[] = (data.rows ?? []).map((row: PreviewRow) => ({
      ...row,
      selectedAction: row.suggestedAction
    }));

    setPreview({ ...data, rows });
    setMessage(`Preview ready: ${data.validRows} valid, ${data.invalidRows} invalid`);
  }

  function handlePreviewAction(index: number, action: ImportAction) {
    setPreview((current) => {
      if (!current) {
        return current;
      }
      const rows = [...current.rows];
      rows[index] = { ...rows[index], selectedAction: action };
      return { ...current, rows };
    });
  }

  async function handleCommitImport() {
    if (!preview) {
      setMessage("Run preview first.");
      return;
    }

    const rows = preview.rows.map((row) => ({
      values: row.values,
      action: row.error ? "skip" : row.selectedAction,
      duplicateMatch: row.duplicateMatch
    }));

    const data = await requestJson("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: importType, rows })
    });

    setMessage(
      `Import committed. Created: P${data.createdProjects} T${data.createdTasks} C${data.createdContentEntries}. Updated: P${data.updatedProjects} T${data.updatedTasks}. Skipped: ${data.skippedRows}`
    );
    setPreview(null);
    await refreshAll();
    await refreshFeeds();
  }

  async function handleDrop(toStatus: TaskStatus, beforeId: string | null) {
    if (!draggedTaskId || !canDragBoard) {
      return;
    }

    const laneIds = laneTasksByOrder(tasks, toStatus)
      .filter((task) => task.id !== draggedTaskId)
      .map((task) => task.id);

    if (beforeId && laneIds.includes(beforeId)) {
      laneIds.splice(laneIds.indexOf(beforeId), 0, draggedTaskId);
    } else {
      laneIds.push(draggedTaskId);
    }

    const previous = tasks;
    setTasks(applyLocalReorder(previous, draggedTaskId, toStatus, laneIds));

    try {
      const data = await requestJson("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movedTaskId: draggedTaskId, toStatus, orderedTaskIds: laneIds })
      });
      setTasks(sortTasks(data.items ?? []));
      await refreshSummary();
    } catch {
      setTasks(previous);
      setMessage("Reorder failed. Board restored.");
    } finally {
      setDraggedTaskId(null);
      setDropTarget(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar panel">
        <div>
          <p className="eyebrow">Mission Control</p>
          <h1>Operational Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <Link href="/planner" className="mini-link">
            Open Planner
          </Link>
          <p className="date-stamp">Dark Ops Mode</p>
        </div>
      </header>

      {message ? <p className="flash">{message}</p> : null}

      <section className="panel center">
        <h2>Today Snapshot</h2>
        <div className="kpis">
          <article>
            <span>Overdue</span>
            <strong>{summary.overdue}</strong>
          </article>
          <article>
            <span>Due Today</span>
            <strong>{summary.dueToday}</strong>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{summary.blocked}</strong>
          </article>
          <article>
            <span>Done (Week)</span>
            <strong>{summary.completedThisWeek}</strong>
          </article>
        </div>

        <h2>Task Board</h2>
        <div className="task-board-controls">
          <select value={taskSortMode} onChange={(event) => setTaskSortMode(event.target.value as TaskSortMode)}>
            <option value="kanban_order">Sort: manual board order</option>
            <option value="due_asc">Sort: due date (soonest first)</option>
          </select>
          <select value={taskProjectFilter} onChange={(event) => setTaskProjectFilter(event.target.value)}>
            <option value="all">Project: all</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                Project: {project.title}
              </option>
            ))}
          </select>
        </div>
        {!canDragBoard ? <p className="info-text">Drag and drop is disabled while sorting by due date or filtering by project.</p> : null}
        <form className="inline-form" onSubmit={handleCreateTask}>
          <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="New task title" />
          <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
          <select value={taskRecurrence} onChange={(event) => setTaskRecurrence(event.target.value as Recurrence)}>
            <option value="none">no recurrence</option>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
          </select>
          <select value={newTaskProjectId} onChange={(event) => setNewTaskProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} />
          <button type="submit">Add Task</button>
        </form>

        <div className="kanban-board">
          {taskColumns.map((column) => {
            const columnTasks = laneTasksForView(visibleTasks, column.status, taskSortMode);
            return (
              <article
                key={column.status}
                className={`kanban-lane ${dropTarget?.status === column.status ? "lane-active" : ""}`}
                onDragOver={(event) => {
                  if (!canDragBoard) {
                    return;
                  }
                  event.preventDefault();
                  setDropTarget({ status: column.status, beforeId: null });
                }}
                onDrop={(event) => {
                  if (!canDragBoard) {
                    return;
                  }
                  event.preventDefault();
                  void handleDrop(column.status, null);
                }}
              >
                <header className="lane-head">
                  <h3>{column.label}</h3>
                  <span>{columnTasks.length}</span>
                </header>
                <ul>
                  {columnTasks.map((task) => {
                    const project = projectById.get(task.projectId);
                    const highlight = dropTarget?.status === column.status && dropTarget.beforeId === task.id;
                    const projectColor = project ? projectAccent(project.id) : "var(--accent-2)";
                    return (
                      <li
                        key={task.id}
                        className={`task-card ${highlight ? "card-drop" : ""}`}
                        style={{ "--project-accent": projectColor } as CSSProperties}
                        draggable={canDragBoard}
                        onDragStart={() => setDraggedTaskId(task.id)}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDropTarget(null);
                        }}
                        onDragOver={(event) => {
                          if (!canDragBoard) {
                            return;
                          }
                          event.preventDefault();
                          setDropTarget({ status: column.status, beforeId: task.id });
                        }}
                        onDrop={(event) => {
                          if (!canDragBoard) {
                            return;
                          }
                          event.preventDefault();
                          void handleDrop(column.status, task.id);
                        }}
                      >
                        <div className="card-head">
                          <div className="task-title-row">
                            <span className={`priority-dot ${priorityClass(task.priority)}`} title={task.priority} aria-label={`priority ${task.priority}`} />
                            <button
                              type="button"
                              className="task-title-link"
                              onClick={() => {
                                openTaskContext(task.id);
                              }}
                            >
                              {task.title}
                            </button>
                          </div>
                        </div>
                        <div className="project-row-inline">
                          <button
                            type="button"
                            className="project-chip"
                            onClick={() => {
                              if (project) {
                                openProjectContext(project.id);
                              }
                            }}
                            disabled={!project}
                          >
                            {project?.title ?? "No project"}
                          </button>
                        </div>
                        <p className="card-meta">{formatDate(task.dueDate)}</p>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>

        <h2>Projects</h2>
        <form className="inline-form" onSubmit={handleCreateProject}>
          <input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="New project title" />
          <input type="date" value={projectDueDate} onChange={(event) => setProjectDueDate(event.target.value)} />
          <button type="submit">Add Project</button>
        </form>
        <div className="project-list">
          {projects.map((project) => (
            <article key={project.id} className="project-row">
              <div>
                <button type="button" className="project-title-link" onClick={() => openProjectContext(project.id)}>
                  {project.title}
                </button>
                <p>
                  {project.status} | {formatDate(project.dueDate)}
                </p>
              </div>
              {expandedProjectId === project.id ? (
                <div className="card-expand">
                  <div className="item-actions">
                    <select value={project.status} onChange={(event) => void handleProjectStatus(project.id, event.target.value as ProjectStatus)}>
                      <option value="planned">planned</option>
                      <option value="active">active</option>
                      <option value="blocked">blocked</option>
                      <option value="done">done</option>
                      <option value="archived">archived</option>
                    </select>
                    <input type="date" value={toDateInput(project.dueDate)} onChange={(event) => void handleProjectDueDate(project.id, event.target.value)} />
                    <button type="button" onClick={() => void handleRenameProject(project)}>
                      Rename
                    </button>
                    <button type="button" onClick={() => void handleDelete(`/api/projects/${project.id}`, `project ${project.title}`)}>
                      Delete
                    </button>
                  </div>
                  <textarea rows={3} value={projectText} onChange={(event) => setProjectText(event.target.value)} placeholder="Add text" />
                  <button type="button" onClick={() => void addProjectText()}>
                    Add Text
                  </button>
                  <input value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://example.com" />
                  <button type="button" onClick={() => void addProjectUrl()}>
                    Add URL
                  </button>
                  <input type="file" accept="image/*" onChange={(event) => setProjectFile(event.currentTarget.files?.[0] ?? null)} />
                  <button type="button" onClick={() => void addProjectImage()}>
                    Add Image
                  </button>
                  <ul className="content-feed">
                    {selectedProjectFeedId === project.id
                      ? projectFeedEntries.map((entry) => (
                          <li key={entry.id} className="content-item">
                            <p className="content-type">{entry.entryType}</p>
                            {entry.entryType === "url" && entry.url ? (
                              <a href={entry.url} target="_blank" rel="noreferrer" className="content-link">
                                {entry.url}
                              </a>
                            ) : entry.entryType === "image" && entry.asset ? (
                              <img src={`/api/content/assets/${entry.asset.id}`} alt="content asset" className="content-image" />
                            ) : (
                              <p>{entry.textContent}</p>
                            )}
                            <div className="item-actions">
                              {entry.entryType !== "image" ? (
                                <button type="button" onClick={() => void editEntry(entry)}>
                                  Edit
                                </button>
                              ) : null}
                              <button type="button" onClick={() => void handleDelete(`/api/content/${entry.id}`, `content entry`)}>
                                Delete
                              </button>
                            </div>
                          </li>
                        ))
                      : null}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {activeTask ? (
        <div
          className="task-modal-backdrop"
          onClick={() => {
            setActiveTaskModalId(null);
          }}
        >
          <aside
            className="task-modal panel"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="task-modal-head">
              <div>
                <p className="content-type">Task</p>
                <div className="task-modal-title-row">
                  <h3>{activeTask.title}</h3>
                  <button type="button" onClick={() => void handleRenameTask(activeTask)}>
                    Rename
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveTaskModalId(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="item-actions">
              <select value={activeTask.status} onChange={(event) => void handleTaskStatus(activeTask.id, event.target.value as TaskStatus)}>
                <option value="todo">todo</option>
                <option value="in_progress">in_progress</option>
                <option value="blocked">blocked</option>
                <option value="parking_lot">parking_lot</option>
                <option value="done">done</option>
              </select>
              <select value={activeTask.priority} onChange={(event) => void handleTaskPriority(activeTask.id, event.target.value as Task["priority"])}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </select>
              <select value={activeTask.projectId} onChange={(event) => void handleTaskProject(activeTask.id, event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
              <select value={activeTask.recurrence} onChange={(event) => void handleTaskRecurrence(activeTask, event.target.value as Recurrence)}>
                <option value="none">none</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
              </select>
              <button type="button" onClick={() => void handleDelete(`/api/tasks/${activeTask.id}`, `task ${activeTask.title}`)}>
                Delete
              </button>
            </div>

            <section className="task-calendar">
              <div className="task-calendar-head">
                <p className="field-label">Due Date Calendar</p>
                <div className="task-calendar-nav">
                  <button type="button" onClick={() => setTaskCalendarMonth((current) => shiftMonth(current, -1))}>
                    Prev
                  </button>
                  <strong>{taskCalendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
                  <button type="button" onClick={() => setTaskCalendarMonth((current) => shiftMonth(current, 1))}>
                    Next
                  </button>
                  <button type="button" onClick={() => void handleTaskDueDate(activeTask.id, "")}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="task-calendar-weekdays">
                <span>Sun</span>
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
              </div>
              <div className="task-calendar-grid">
                {calendarDays.map((day) => {
                  const dayNum = Number(day.key.slice(8, 10));
                  const classes = [
                    "task-calendar-day",
                    day.inMonth ? "" : "calendar-day-muted",
                    day.key === activeTaskDueDateKey ? "calendar-day-selected" : "",
                    day.key === todayKey ? "calendar-day-today" : ""
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={day.key}
                      type="button"
                      className={classes}
                      onClick={() => {
                        void handleTaskDueDate(activeTask.id, day.key);
                      }}
                    >
                      {dayNum}
                    </button>
                  );
                })}
              </div>
            </section>

            <textarea rows={3} value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder="Add text" />
            <button type="button" onClick={() => void addTaskText()}>
              Add Text
            </button>
            <input value={taskUrl} onChange={(event) => setTaskUrl(event.target.value)} placeholder="https://example.com" />
            <button type="button" onClick={() => void addTaskUrl()}>
              Add URL
            </button>
            <input type="file" accept="image/*" onChange={(event) => setTaskFile(event.currentTarget.files?.[0] ?? null)} />
            <button type="button" onClick={() => void addTaskImage()}>
              Add Image
            </button>
            <ul className="content-feed">
              {selectedTaskFeedId === activeTask.id
                ? taskFeedEntries.map((entry) => (
                    <li key={entry.id} className="content-item">
                      <p className="content-type">{entry.entryType}</p>
                      {entry.entryType === "url" && entry.url ? (
                        <a href={entry.url} target="_blank" rel="noreferrer" className="content-link">
                          {entry.url}
                        </a>
                      ) : entry.entryType === "image" && entry.asset ? (
                        <img src={`/api/content/assets/${entry.asset.id}`} alt="content asset" className="content-image" />
                      ) : (
                        <p>{entry.textContent}</p>
                      )}
                      <div className="item-actions">
                        {entry.entryType !== "image" ? (
                          <button type="button" onClick={() => void editEntry(entry)}>
                            Edit
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void handleDelete(`/api/content/${entry.id}`, `content entry`)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))
                : null}
            </ul>
          </aside>
        </div>
      ) : null}

      <section className="grid-layout">
        <aside className="right panel">
          <h2>Import Center</h2>
          <label className="field-label">Source</label>
          <select value={importType} onChange={(event) => setImportType(event.target.value as ImportType)}>
            <option value="apple_reminders">apple_reminders</option>
            <option value="apple_notes">apple_notes</option>
            <option value="chatgpt_projects">chatgpt_projects</option>
            <option value="claude_projects">claude_projects</option>
          </select>
          <label className="field-label">CSV (first row as header)</label>
          <textarea rows={7} value={importText} onChange={(event) => setImportText(event.target.value)} />
          <div className="quick-actions">
            <button type="button" onClick={() => void handlePreviewImport()}>
              Preview
            </button>
            <button type="button" onClick={() => void handleCommitImport()} disabled={!preview}>
              Commit
            </button>
          </div>
          {preview ? (
            <div className="preview-box">
              <p>
                Rows: {preview.rows.length} | Valid: {preview.validRows} | Invalid: {preview.invalidRows}
              </p>
              <div className="preview-table">
                <div className="preview-row preview-head">
                  <span>Line</span>
                  <span>Title</span>
                  <span>Duplicate</span>
                  <span>Action</span>
                </div>
                {preview.rows.map((row, index) => (
                  <div key={`${row.line}-${index}`} className="preview-row">
                    <span>{row.line}</span>
                    <span>{row.values.title || "(empty)"}</span>
                    <span>
                      {row.error
                        ? row.error
                        : row.duplicateMatch
                          ? `${row.duplicateMatch.kind} (${row.duplicateMatch.score}) -> ${row.duplicateMatch.title}`
                          : "none"}
                    </span>
                    <select value={row.selectedAction} onChange={(event) => handlePreviewAction(index, event.target.value as ImportAction)}>
                      <option value="create">create</option>
                      <option value="update">update</option>
                      <option value="skip">skip</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {loading ? <p className="info-text">Loading...</p> : null}
        </aside>
      </section>

      <footer className="panel footer">Data persists in /data/mission-control.db</footer>
    </main>
  );
}
