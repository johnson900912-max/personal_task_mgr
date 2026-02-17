"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Recurrence, Task, TaskStatus } from "@/src/lib/types";

const statusOptions: TaskStatus[] = ["todo", "in_progress", "blocked", "parking_lot", "done"];
const recurrenceOptions: Recurrence[] = ["none", "daily", "weekly"];

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function Planner() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    const data = await res.json();
    setTasks(data.items ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workload = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let overdue = 0;
    let dueToday = 0;
    let scheduledWeek = 0;
    let recurring = 0;

    for (const task of tasks) {
      if (task.recurrence !== "none") {
        recurring += 1;
      }
      if (task.dueDate && task.status !== "done") {
        const due = new Date(task.dueDate);
        if (due < today) {
          overdue += 1;
        }
        if (due >= today && due < weekEnd && due.toDateString() === today.toDateString()) {
          dueToday += 1;
        }
      }
      if (task.scheduledAt) {
        const scheduled = new Date(task.scheduledAt);
        if (scheduled >= today && scheduled < weekEnd) {
          scheduledWeek += 1;
        }
      }
    }

    return { overdue, dueToday, scheduledWeek, recurring };
  }, [tasks]);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aDate = a.scheduledAt ?? a.dueDate ?? "9999";
      const bDate = b.scheduledAt ?? b.dueDate ?? "9999";
      return aDate.localeCompare(bDate);
    });
  }, [tasks]);

  async function patchTask(taskId: string, patch: Partial<Task>) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    await refresh();
  }

  return (
    <main className="shell">
      <header className="topbar panel">
        <div>
          <p className="eyebrow">Mission Control</p>
          <h1>Planner</h1>
        </div>
        <div className="topbar-actions">
          <Link href="/" className="mini-link">
            Back To Dashboard
          </Link>
        </div>
      </header>

      <section className="panel planner-board">
        <h2>Workload View</h2>
        <div className="kpis planner-kpis">
          <article>
            <span>Overdue</span>
            <strong>{workload.overdue}</strong>
          </article>
          <article>
            <span>Due Today</span>
            <strong>{workload.dueToday}</strong>
          </article>
          <article>
            <span>Scheduled 7d</span>
            <strong>{workload.scheduledWeek}</strong>
          </article>
          <article>
            <span>Recurring</span>
            <strong>{workload.recurring}</strong>
          </article>
        </div>
      </section>

      <section className="panel planner-board">
        <h2>Schedule + Recurrence</h2>
        {message ? <p className="info-text">{message}</p> : null}
        <div className="planner-grid planner-grid-6 planner-head">
          <strong>Task</strong>
          <strong>Status</strong>
          <strong>Due Date</strong>
          <strong>Scheduled Date</strong>
          <strong>Recurrence</strong>
          <strong>Actions</strong>
        </div>
        {sorted.map((task) => (
          <div key={task.id} className="planner-grid planner-grid-6">
            <div className="planner-task-cell">
              <span>{task.title}</span>
              <Link href={`/?contentParentType=task&contentParentId=${encodeURIComponent(task.id)}`} className="mini-link">
                View Feed
              </Link>
            </div>
            <select value={task.status} onChange={(event) => void patchTask(task.id, { status: event.target.value as TaskStatus })}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input
              type="date"
              defaultValue={toDateInput(task.dueDate)}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                void patchTask(task.id, { dueDate: value ? new Date(`${value}T12:00:00`).toISOString() : null });
              }}
            />
            <input
              type="date"
              defaultValue={toDateInput(task.scheduledAt)}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                void patchTask(task.id, { scheduledAt: value ? new Date(`${value}T09:00:00`).toISOString() : null });
              }}
            />
            <select value={task.recurrence} onChange={(event) => void patchTask(task.id, { recurrence: event.target.value as Recurrence })}>
              {recurrenceOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                void patchTask(task.id, { scheduledAt: null, dueDate: null });
                setMessage(`Cleared dates for ${task.title}`);
              }}
            >
              Clear Dates
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
