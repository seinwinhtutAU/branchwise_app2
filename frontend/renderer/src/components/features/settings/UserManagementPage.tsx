import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { CloseIcon, PlusIcon, UsersIcon } from "@renderer/components/ui/icons";

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: RoleValue;
  branch_id: string | null;
  branch_name: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

type RoleValue = "development" | "admin" | "retail_management" | "retail" | "wholesale";

const ROLE_OPTIONS: { value: RoleValue; label: string; description: string }[] =
  [
    {
      value: "development",
      label: "Development",
      description: "Full access to every workspace, setting, and role assignment",
    },
    {
      value: "admin",
      label: "Admin",
      description: "Summary and health dashboard, basic settings, and user management",
    },
    {
      value: "retail_management",
      label: "Retail management",
      description: "Full access to the retail workspace",
    },
    {
      value: "retail",
      label: "Retail user",
      description: "Import and import history only",
    },
    {
      value: "wholesale",
      label: "Wholesale user",
      description: "Full access to the wholesale workspace",
    },
  ];

interface Props {
  session: Session;
  profile: Profile | null;
}

function roleNeedsBranch(role: RoleValue): boolean {
  return role === "retail" || role === "wholesale";
}

function errorMessage(response: Response, fallback: string): Promise<Error> {
  return response
    .json()
    .then((body: { detail?: string }) => new Error(body.detail || fallback))
    .catch(() => new Error(fallback));
}

export function UserManagementPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast();
  const isDevelopment = profile?.role === "development";
  const assignableRoles = useMemo(
    () =>
      isDevelopment
        ? ROLE_OPTIONS
        : ROLE_OPTIONS.filter((option) => option.value !== "development"),
    [isDevelopment],
  );
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "retail" as RoleValue,
    branch_id: "",
  });

  const branchMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  async function loadUsers(): Promise<void> {
    setLoadingError(null);
    try {
      const [usersResponse, branchesResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/users`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${apiBaseUrl}/api/branches?kind=all`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!usersResponse.ok)
        throw await errorMessage(usersResponse, "Couldn't load users");
      if (!branchesResponse.ok)
        throw await errorMessage(branchesResponse, "Couldn't load branches");
      setUsers((await usersResponse.json()) as ManagedUser[]);
      setBranches((await branchesResponse.json()) as BranchOption[]);
    } catch (error) {
      setLoadingError(
        error instanceof Error ? error.message : "Couldn't load users",
      );
    }
  }

  useEffect(() => {
    void loadUsers();
    // The session object is stable for the lifetime of this page; refreshing the token
    // should not clear the table or interrupt an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  useEffect(() => {
    if (!isCreateOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !creating) setIsCreateOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [creating, isCreateOpen]);

  function updateDraft(id: string, patch: Partial<ManagedUser>): void {
    setUsers(
      (current) =>
        current?.map((account) =>
          account.id === id ? { ...account, ...patch } : account,
        ) ?? current,
    );
  }

  async function saveUser(account: ManagedUser): Promise<void> {
    if (roleNeedsBranch(account.role) && !account.branch_id) {
      showToast("error", "Select a branch for this account first");
      return;
    }
    setSavingId(account.id);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users/${account.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          role: account.role,
          branch_id: roleNeedsBranch(account.role) ? account.branch_id : null,
        }),
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't update account");
      const updated = (await response.json()) as ManagedUser;
      setUsers(
        (current) =>
          current?.map((item) => (item.id === updated.id ? updated : item)) ??
          current,
      );
      showToast("success", "Account permissions updated");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't update account",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function createUser(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (roleNeedsBranch(newUser.role) && !newUser.branch_id) {
      showToast("error", "Select a branch for this account");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: newUser.name,
          email: newUser.email,
          password: newUser.password,
          role: newUser.role,
          branch_id: roleNeedsBranch(newUser.role) ? newUser.branch_id : null,
        }),
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't create account");
      const created = (await response.json()) as ManagedUser;
      setUsers((current) =>
        [...(current ?? []), created].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setNewUser({
        name: "",
        email: "",
        password: "",
        role: "retail",
        branch_id: "",
      });
      setIsCreateOpen(false);
      showToast("success", "Account created");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't create account",
      );
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(account: ManagedUser): Promise<void> {
    if (
      !window.confirm(
        `Delete ${account.name}'s account? This cannot be undone.`,
      )
    )
      return;
    setDeletingId(account.id);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users/${account.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't delete account");
      setUsers(
        (current) =>
          current?.filter((item) => item.id !== account.id) ?? current,
      );
      showToast("success", "Account deleted");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't delete account",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loadingError) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="Couldn't load user management"
        description={loadingError}
        action={<Button onClick={() => void loadUsers()}>Try again</Button>}
      />
    );
  }

  const userCount = users?.length ?? 0;
  const adminCount =
    users?.filter((account) => account.role === "admin").length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="User management"
        description="Create accounts, control workspace access and assign retail branches."
        action={
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-text-muted">
              <span>{userCount} accounts</span>
              <span className="text-border">·</span>
              <span>{adminCount} admins</span>
            </div>
          </div>
        }
      />

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-title"
        >
          <button
            type="button"
            aria-label="Close new user dialog"
            className="absolute inset-0 cursor-default"
            onClick={() => {
              if (!creating) setIsCreateOpen(false);
            }}
          />
          <Card className="relative z-10 w-full max-w-2xl shadow-xl">
            <CardHeader
              title={<span id="create-user-title">New user</span>}
              description="The new user can sign in immediately with the password you provide."
              action={
                <button
                  type="button"
                  aria-label="Close new user dialog"
                  disabled={creating}
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary disabled:opacity-50"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              }
            />
            <form
              onSubmit={createUser}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <Input
                label="Name"
                placeholder="Jane Doe"
                value={newUser.name}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
              <Input
                type="email"
                label="Email"
                placeholder="jane@branchwise.app"
                value={newUser.email}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
              <Input
                type="password"
                label="Temporary password"
                placeholder="At least 8 characters"
                minLength={8}
                value={newUser.password}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
              />
              <Select
                label="Role"
                value={newUser.role}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    role: event.target.value as RoleValue,
                    branch_id: roleNeedsBranch(event.target.value as RoleValue)
                      ? current.branch_id
                      : "",
                  }))
                }
              >
                {assignableRoles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Branch"
                value={newUser.branch_id}
                disabled={!roleNeedsBranch(newUser.role)}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    branch_id: event.target.value,
                  }))
                }
              >
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
              <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-text-muted">
                  {
                    ROLE_OPTIONS.find((option) => option.value === newUser.role)
                      ?.description
                  }
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={creating}
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={creating}>
                    Create user
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <CardHeader
            title="Accounts"
            description="Changes apply to the next request the account makes."
            action={
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                <PlusIcon className="h-4 w-4" />
                New user
              </Button>
            }
          />
        </div>
        {users === null ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-5 w-5 text-text-muted" />
          </div>
        ) : users.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<UsersIcon />}
              title="No accounts yet"
              description="Create the first account above."
            />
          </div>
        ) : (
          <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
            <Thead>
              <Tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Branch</Th>
                <Th className="w-1">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {users.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <div className="font-medium text-text-primary">
                      {account.name}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {account.email}
                    </div>
                  </Td>
                  <Td>
                    <div className="min-w-44">
                      <Select
                        size="sm"
                        aria-label={`Role for ${account.name}`}
                        value={account.role}
                        onChange={(event) => {
                          const role = event.target.value as RoleValue;
                          updateDraft(account.id, {
                            role,
                            branch_id: roleNeedsBranch(role)
                              ? account.branch_id
                              : null,
                          });
                        }}
                      >
                        {(account.role === "development" ? ROLE_OPTIONS : assignableRoles).map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={!isDevelopment && option.value === "development"}
                          >
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Td>
                  <Td>
                    <Select
                      size="sm"
                      aria-label={`Branch for ${account.name}`}
                      value={account.branch_id ?? ""}
                      disabled={
                        !roleNeedsBranch(account.role)
                      }
                      onChange={(event) =>
                        updateDraft(account.id, {
                          branch_id: event.target.value || null,
                          branch_name:
                            branchMap.get(event.target.value) ?? null,
                        })
                      }
                    >
                      <option value="">No branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={savingId === account.id}
                        onClick={() => void saveUser(account)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-error hover:bg-error-subtle hover:text-error"
                        loading={deletingId === account.id}
                        onClick={() => void deleteUser(account)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}

export default UserManagementPage;
