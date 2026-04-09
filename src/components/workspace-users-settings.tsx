"use client";

import {
  createWorkspaceUserAction,
  deleteWorkspaceUserAction,
  updateWorkspaceUserAction,
} from "@/app/actions";
import { roleCopy } from "@/lib/crm-shared";
import { UserRole } from "@/lib/db";
import {
  ACCESS_LEVEL_LABELS,
  getRolePrivilegeDefaults,
  hasCustomPrivilegeOverrides,
  mergePrivileges,
  PRIVILEGE_KEYS,
  PRIVILEGE_LABELS,
  type AccessLevel,
  type PrivilegeKey,
} from "@/lib/user-privileges";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

export type WorkspaceUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string | null;
  privilegeOverrides?: unknown;
};

const ROLE_OPTIONS = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES, UserRole.TECH] as const;

function PrivilegeFields({
  role,
  value,
  onChange,
  idPrefix,
}: {
  role: UserRole;
  value: Record<PrivilegeKey, AccessLevel>;
  onChange: (next: Record<PrivilegeKey, AccessLevel>) => void;
  idPrefix: string;
}) {
  if (role === UserRole.ADMIN) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
        <p className="text-sm font-medium text-slate-800">Administrator</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Admins always have full access everywhere, including Workspace configuration. No per-area overrides apply.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workspace access</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Defaults follow the role; change a row to override. <span className="font-medium text-slate-700">View only</span>{" "}
          is read; <span className="font-medium text-slate-700">View &amp; edit</span> can create and change records.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PRIVILEGE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-${key}`} className="text-xs font-medium text-slate-600">
              {PRIVILEGE_LABELS[key]}
            </label>
            <select
              id={`${idPrefix}-${key}`}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value as AccessLevel })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            >
              <option value="none">{ACCESS_LEVEL_LABELS.none}</option>
              <option value="read">{ACCESS_LEVEL_LABELS.read}</option>
              <option value="write">{ACCESS_LEVEL_LABELS.write}</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

type WorkspaceUsersSettingsProps = {
  users: WorkspaceUserRow[];
  currentUserId: string;
  canManageUsers: boolean;
};

export function WorkspaceUsersSettings({ users, currentUserId, canManageUsers }: WorkspaceUsersSettingsProps) {
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState<UserRole>(UserRole.SALES);
  const [addPrivs, setAddPrivs] = useState(() => getRolePrivilegeDefaults(UserRole.SALES));
  const [editing, setEditing] = useState<WorkspaceUserRow | null>(null);
  const [editRole, setEditRole] = useState<UserRole>(UserRole.SALES);
  const [editPrivs, setEditPrivs] = useState(() => getRolePrivilegeDefaults(UserRole.SALES));
  const [removePending, startRemove] = useTransition();
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (addOpen) {
      setAddRole(UserRole.SALES);
      setAddPrivs(getRolePrivilegeDefaults(UserRole.SALES));
    }
  }, [addOpen]);

  useEffect(() => {
    if (editing) {
      setEditRole(editing.role as UserRole);
      setEditPrivs(mergePrivileges(editing.role as UserRole, editing.privilegeOverrides));
    }
  }, [editing]);

  useEffect(() => {
    if (!addOpen) return;
    const id = requestAnimationFrame(() => {
      const el = addDialogRef.current;
      if (el && !el.open) el.showModal();
    });
    return () => cancelAnimationFrame(id);
  }, [addOpen]);

  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => {
      const el = editDialogRef.current;
      if (el && !el.open) el.showModal();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const openAdd = () => setAddOpen(true);
  const closeAdd = () => {
    addDialogRef.current?.close();
    setAddOpen(false);
  };

  const openEdit = (user: WorkspaceUserRow) => setEditing(user);
  const closeEdit = () => {
    editDialogRef.current?.close();
    setEditing(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = `${u.name} ${u.email} ${u.role} ${u.team ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, query]);

  if (!canManageUsers) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Only an <span className="font-medium text-slate-800">ADMIN</span> can add or edit accounts. This directory is
          read-only for your role.
        </p>
        <div className="overflow-x-auto rounded-[22px] border border-slate-200/90">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 sm:px-5">Name</th>
                <th className="px-4 py-3 sm:px-5">Email</th>
                <th className="px-4 py-3 sm:px-5">Role</th>
                <th className="px-4 py-3 sm:px-5">Team</th>
                <th className="px-4 py-3 sm:px-5">Access</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-slate-900 sm:px-5">{user.name}</td>
                  <td className="px-4 py-3 text-slate-600 sm:px-5">{user.email}</td>
                  <td className="px-4 py-3 sm:px-5">
                    <span className="crm-badge">{user.role}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 sm:px-5">{user.team || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 sm:px-5">
                    {user.role === UserRole.ADMIN
                      ? "Full"
                      : hasCustomPrivilegeOverrides(user.privilegeOverrides)
                        ? "Custom"
                        : "Role default"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Sign-in is email-based; each person uses their own workspace account. Set{" "}
        <span className="font-medium text-slate-800">Workspace access</span> per person (bookings, calls, clients,
        tasks, imports, reports). <span className="font-medium text-slate-800">ADMIN</span> always has full access.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor="team-search" className="sr-only">
            Search team
          </label>
          <input
            id="team-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, role, or team…"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="shrink-0 rounded-xl bg-[#1e5ea8] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17497f]"
        >
          Add team member
        </button>
      </div>

      <div className="overflow-x-auto rounded-[22px] border border-slate-200/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 sm:px-5">Name</th>
              <th className="px-4 py-3 sm:px-5">Email</th>
              <th className="px-4 py-3 sm:px-5">Role</th>
              <th className="px-4 py-3 sm:px-5">Team</th>
              <th className="px-4 py-3 sm:px-5">Access</th>
              <th className="px-4 py-3 text-right sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500 sm:px-5">
                  No one matches that search.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-slate-900 sm:px-5">{user.name}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-slate-600 sm:max-w-xs sm:px-5" title={user.email}>
                    {user.email}
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <span className="crm-badge">{user.role}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 sm:px-5">{user.team || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 sm:px-5">
                    {user.role === UserRole.ADMIN ? (
                      <span className="text-xs text-slate-500">Full</span>
                    ) : hasCustomPrivilegeOverrides(user.privilegeOverrides) ? (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                        Custom
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Role default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right sm:px-5">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      {user.id !== currentUserId ? (
                        <button
                          type="button"
                          disabled={removePending}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 transition hover:bg-red-100 disabled:opacity-50"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Remove ${user.name}? They must have no calls, bookings, or imports in the system.`,
                              )
                            ) {
                              return;
                            }
                            startRemove(async () => {
                              const fd = new FormData();
                              fd.set("id", user.id);
                              await deleteWorkspaceUserAction(fd);
                            });
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {addOpen ? (
        <dialog
          ref={addDialogRef}
          className="w-[calc(100%-2rem)] max-w-3xl rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
          onClose={closeAdd}
        >
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-900">Add team member</h3>
            <p className="mt-1 text-sm text-slate-500">They sign in with this email. Set role and optional access overrides.</p>
          </div>
          <form
            action={async (fd) => {
              await createWorkspaceUserAction(fd);
              closeAdd();
            }}
            className="px-6 py-5"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Profile</p>
                <div>
                  <label htmlFor="dlg-add-name" className="mb-1 block text-xs font-medium text-slate-600">
                    Name
                  </label>
                  <input
                    id="dlg-add-name"
                    name="name"
                    required
                    minLength={2}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dlg-add-email" className="mb-1 block text-xs font-medium text-slate-600">
                    Email
                  </label>
                  <input
                    id="dlg-add-email"
                    name="email"
                    type="email"
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dlg-add-role" className="mb-1 block text-xs font-medium text-slate-600">
                    Role
                  </label>
                  <select
                    id="dlg-add-role"
                    name="role"
                    value={addRole}
                    onChange={(e) => {
                      const r = e.target.value as UserRole;
                      setAddRole(r);
                      setAddPrivs(getRolePrivilegeDefaults(r));
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dlg-add-team" className="mb-1 block text-xs font-medium text-slate-600">
                    Team (optional)
                  </label>
                  <input
                    id="dlg-add-team"
                    name="team"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
              </div>
              <div>
                <PrivilegeFields idPrefix="add" role={addRole} value={addPrivs} onChange={setAddPrivs} />
                {PRIVILEGE_KEYS.map((k) => (
                  <input key={k} type="hidden" name={`priv_${k}`} value={addPrivs[k]} />
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={closeAdd}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17497f]"
              >
                Add member
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {editing ? (
        <dialog
          ref={editDialogRef}
          className="w-[calc(100%-2rem)] max-w-3xl rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
          onClose={closeEdit}
        >
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-900">Edit team member</h3>
            <p className="mt-1 text-sm text-slate-500">{roleCopy[editing.role as keyof typeof roleCopy]}</p>
          </div>
          <form
            key={editing.id}
            action={async (fd) => {
              await updateWorkspaceUserAction(fd);
              closeEdit();
            }}
            className="px-6 py-5"
          >
            <input type="hidden" name="id" value={editing.id} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Profile</p>
                <div>
                  <label htmlFor="dlg-edit-name" className="mb-1 block text-xs font-medium text-slate-600">
                    Name
                  </label>
                  <input
                    id="dlg-edit-name"
                    name="name"
                    required
                    minLength={2}
                    defaultValue={editing.name}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dlg-edit-email" className="mb-1 block text-xs font-medium text-slate-600">
                    Email
                  </label>
                  <input
                    id="dlg-edit-email"
                    name="email"
                    type="email"
                    required
                    defaultValue={editing.email}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dlg-edit-role" className="mb-1 block text-xs font-medium text-slate-600">
                    Role
                  </label>
                  <select
                    id="dlg-edit-role"
                    name="role"
                    value={editRole}
                    onChange={(e) => {
                      const r = e.target.value as UserRole;
                      setEditRole(r);
                      setEditPrivs(getRolePrivilegeDefaults(r));
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dlg-edit-team" className="mb-1 block text-xs font-medium text-slate-600">
                    Team
                  </label>
                  <input
                    id="dlg-edit-team"
                    name="team"
                    defaultValue={editing.team ?? ""}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                  />
                </div>
              </div>
              <div>
                <PrivilegeFields idPrefix="edit" role={editRole} value={editPrivs} onChange={setEditPrivs} />
                {editRole !== UserRole.ADMIN
                  ? PRIVILEGE_KEYS.map((k) => <input key={k} type="hidden" name={`priv_${k}`} value={editPrivs[k]} />)
                  : null}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17497f]"
              >
                Save
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
