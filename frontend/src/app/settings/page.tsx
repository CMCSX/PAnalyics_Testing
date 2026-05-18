"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import {
  listUsers,
  createUser,
  setUserAdmin,
  deleteUser,
  changePassword,
  adminUpdateUser,
  type UserResponse,
} from "@/lib/api";
import { useUnifiedAuditLog } from "@/lib/queries";
import { Eye, EyeOff, Plus, Shield, Lock, ClipboardList, Users, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function SettingsPage() {
  const { user, token } = useAuth();
  const isAdmin = !!user?.is_superuser;
  const [activeTab, setActiveTab] = useState<"settings" | "users">("settings");

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Settings
      </h1>

      {/* Tabs (admin only) */}
      {isAdmin && (
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors rounded-t-md ${
              activeTab === "settings"
                ? "border-b-2 border-[#5B66E2] text-[#5B66E2] bg-[#5B66E2]/5"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Lock className="h-4 w-4" />
            Settings
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors rounded-t-md ${
              activeTab === "users"
                ? "border-b-2 border-[#5B66E2] text-[#5B66E2] bg-[#5B66E2]/5"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Users className="h-4 w-4" />
            User Management
          </button>
        </div>
      )}

      {/* Settings tab content (or always shown for non-admins) */}
      {(!isAdmin || activeTab === "settings") && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6 items-start">
          <ChangePasswordSection token={token} />
          <UnifiedAuditLogSection token={token} />
        </div>
      )}

      {/* User Management tab content (admin only) */}
      {isAdmin && activeTab === "users" && (
        <UserManagementSection token={token} currentUserId={user?.id} />
      )}
    </div>
  );
}

/* ─── Change Password ─── */
function ChangePasswordSection({ token }: { token: string | null }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      toast.error("New password must contain at least one uppercase letter.");
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      toast.error("New password must contain at least one lowercase letter.");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      toast.error("New password must contain at least one digit.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (!token) return;

    setIsSubmitting(true);
    try {
      await changePassword(token, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Lock className="h-5 w-5 text-[#8B96F2]" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Change Password
        </h2>
      </div>

      <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label className="text-gray-700 dark:text-gray-300">Current Password</Label>
          <div className="relative">
            <Input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="pr-10 bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-700 dark:text-gray-300">New Password</Label>
          <div className="relative">
            <Input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="Min. 8 chars, upper, lower, digit"
              className="pr-10 bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-700 dark:text-gray-300">Confirm New Password</Label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Updating…" : "Update Password"}
        </button>
      </form>
    </Card>
  );
}

/* ─── User Management (Admin) ─── */
function UserManagementSection({
  token,
  currentUserId,
}: {
  token: string | null;
  currentUserId: string | undefined;
}) {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // Edit user modal
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  function openEditModal(u: UserResponse) {
    setEditingUser(u);
    setEditName(u.full_name);
    setEditEmail(u.email);
    setEditPassword("");
    setEditConfirmPassword("");
    setShowEditPassword(false);
  }

  function closeEditModal() {
    setEditingUser(null);
  }

  async function handleEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editingUser) return;

    if (editPassword && editPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (editPassword && !/[A-Z]/.test(editPassword)) {
      toast.error("Password must contain at least one uppercase letter.");
      return;
    }
    if (editPassword && !/[a-z]/.test(editPassword)) {
      toast.error("Password must contain at least one lowercase letter.");
      return;
    }
    if (editPassword && !/[0-9]/.test(editPassword)) {
      toast.error("Password must contain at least one digit.");
      return;
    }
    if (editPassword && editPassword !== editConfirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    const updates: { full_name?: string; email?: string; password?: string } = {};
    if (editName.trim() !== editingUser.full_name) updates.full_name = editName.trim();
    if (editEmail.trim().toLowerCase() !== editingUser.email) updates.email = editEmail.trim();
    if (editPassword) updates.password = editPassword;

    if (Object.keys(updates).length === 0) {
      closeEditModal();
      return;
    }

    setIsUpdating(true);
    try {
      const updated = await adminUpdateUser(token, editingUser.id, updates);
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? updated : u)));
      toast.success(`Updated ${updated.full_name}.`);
      closeEditModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user.");
    } finally {
      setIsUpdating(false);
    }
  }

  // New user form
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!token) return;
    listUsers(token)
      .then(setUsers)
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load users.")
      )
      .finally(() => setIsLoadingUsers(false));
  }, [token]);

  async function handleToggleAdmin(userId: string, newValue: boolean) {
    if (!token) return;
    setTogglingAdmin(userId);
    try {
      const updated = await setUserAdmin(token, userId, newValue);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      toast.success(newValue ? "Admin access granted." : "Admin access revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update admin status.");
    } finally {
      setTogglingAdmin(null);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setIsCreating(true);
    try {
      const newUser = await createUser(token, {
        email,
        full_name: fullName,
        password,
      });
      setUsers((prev) => [newUser, ...prev]);
      toast.success(`Account created for ${newUser.email}`);
      setEmail("");
      setFullName("");
      setPassword("");
      setShowCreateForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteUser(target: UserResponse) {
    if (!token) return;
    const confirmed = window.confirm(
      `Delete user ${target.email}? This will permanently remove their account and uploaded data.`
    );
    if (!confirmed) return;

    setDeletingUser(target.id);
    try {
      await deleteUser(token, target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      toast.success(`Deleted ${target.email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setDeletingUser(null);
    }
  }

  // If not admin, the section won't show (handled via loadError gracefully)
  if (loadError === "Admin access required.") return null;

  return (
    <>
    <Card className="border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#8B96F2]" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            User Management
          </h2>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {loadError && loadError !== "Admin access required." && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {loadError}
        </div>
      )}

      {/* Create user form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateUser}
          className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-muted p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-gray-700 dark:text-gray-300 text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-700 dark:text-gray-300 text-xs">Full Name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-700 dark:text-gray-300 text-xs">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Min. 8 characters"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isCreating}
              className="rounded-md bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isCreating ? "Creating…" : "Create Account"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users list */}
      <div className="overflow-x-auto">
        {isLoadingUsers ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium">Email</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Admin</th>
              <th className="pb-3 font-medium">Created</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-b border-gray-100 dark:border-gray-700/50"
              >
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] text-xs font-semibold text-white">
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-gray-900 dark:text-gray-200">
                      {u.full_name}
                      {u.id === currentUserId && (
                        <span className="ml-1.5 text-xs text-[#8B96F2]">(you)</span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="py-3 text-gray-600 dark:text-gray-400">
                  {u.email}
                </td>
                <td className="py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.is_active
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="py-3">
                  {u.id === currentUserId || u.email.toLowerCase() === "payanalytics86@gmail.com" ? (
                    <label className="flex items-center gap-2 w-fit opacity-50 cursor-not-allowed">
                      <input
                        type="checkbox"
                        checked={u.is_superuser}
                        disabled
                        className="h-4 w-4 rounded accent-[#5B66E2] cursor-not-allowed"
                      />
                      {u.is_superuser && (
                        <span className="text-xs text-[#8B96F2] font-medium">Admin</span>
                      )}
                    </label>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={u.is_superuser}
                        disabled={togglingAdmin === u.id}
                        onChange={(e) => handleToggleAdmin(u.id, e.target.checked)}
                        className="h-4 w-4 rounded accent-[#5B66E2] cursor-pointer disabled:cursor-wait"
                      />
                      {u.is_superuser && (
                        <span className="text-xs text-[#8B96F2] font-medium">Admin</span>
                      )}
                    </label>
                  )}
                </td>
                <td className="py-3 text-gray-500 dark:text-gray-400">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                  {u.id === currentUserId || u.email.toLowerCase() === "payanalytics86@gmail.com" ? (
                    <>
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-400 opacity-60 cursor-not-allowed"
                        title="This account cannot be edited"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-400 opacity-60 cursor-not-allowed"
                        title="This account cannot be deleted"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#5B66E2]/40 bg-[#5B66E2]/10 px-2.5 py-1.5 text-xs font-medium text-[#5B66E2] transition-colors hover:bg-[#5B66E2]/20"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        disabled={deletingUser === u.id}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/20 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingUser === u.id ? "Deleting..." : "Delete"}
                      </button>
                    </>
                  )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loadError && (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-gray-400"
                >
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>
    </Card>

    {/* Edit User Modal */}
    {editingUser && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={closeEditModal}
        />
        {/* Dialog */}
        <div className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] text-xs font-semibold text-white">
                {editingUser.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Edit User</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{editingUser.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeEditModal}
              className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleEditUser} className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-700 dark:text-gray-300">Full Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                placeholder="John Doe"
                className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-gray-700 dark:text-gray-300">Email</Label>
              <Input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required
                placeholder="user@example.com"
                className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-gray-700 dark:text-gray-300">
                New Password
                <span className="ml-1.5 text-xs text-gray-400 font-normal">(leave blank to keep current)</span>
              </Label>
              <div className="relative">
                <Input
                  type={showEditPassword ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Min. 8 chars, upper, lower, digit"
                  className="pr-10 bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword(!showEditPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {editPassword && (
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-700 dark:text-gray-300">Confirm New Password</Label>
                <Input
                  type="password"
                  value={editConfirmPassword}
                  onChange={(e) => setEditConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:border-[#5B66E2] focus-visible:ring-[#5B66E2]/30"
                />
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="rounded-md bg-gradient-to-r from-[#5B66E2] to-[#8B96F2] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isUpdating ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
}

/* ─── Audit Log (unified: uploads, deletions, record changes — max 10 per user) ─── */

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  file_upload: { label: "Upload", color: "bg-green-500/10 text-green-400" },
  file_delete: { label: "Delete File", color: "bg-red-500/10 text-red-400" },
  record_delete: { label: "Delete Record", color: "bg-orange-500/10 text-orange-400" },
  record_bulk_delete: { label: "Bulk Delete", color: "bg-red-500/10 text-red-400" },
  record_create: { label: "Create Record", color: "bg-blue-500/10 text-blue-400" },
  record_update: { label: "Edit Record", color: "bg-yellow-500/10 text-yellow-400" },
};

function UnifiedAuditLogSection({ token }: { token: string | null }) {
  const { data: entries = [], isLoading: loading } = useUnifiedAuditLog(token);

  return (
    <Card className="border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <div className="flex items-start gap-2 mb-4">
        <ClipboardList className="h-5 w-5 text-[#8B96F2] mt-0.5 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Audit Log</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-[8px]">
            Your recent file activity (uploads, deletions, record changes).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No activity recorded yet.</p>
      ) : (
        <div className="overflow-y-auto max-h-[420px] space-y-2 pr-1">
          {entries.map((e) => {
            const actionInfo = ACTION_LABELS[e.action] ?? { label: e.action, color: "bg-gray-500/10 text-gray-400" };
            return (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 shadow-sm hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors"
              >
                <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${actionInfo.color}`}>
                  {actionInfo.label}
                </span>
                <span className="flex-1 truncate text-sm text-gray-700 dark:text-gray-300 min-w-0" title={e.file_name}>
                  {e.file_name}
                </span>
                <span className="shrink-0 text-sm text-gray-600 dark:text-gray-400">{fmtCount(e.record_count)} rec</span>
                <span className="shrink-0 text-sm font-medium text-green-600 dark:text-green-400">
                  {e.total_amount > 0 ? `₱${fmt(e.total_amount)}` : "—"}
                </span>
                <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">{fmtDate(e.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
