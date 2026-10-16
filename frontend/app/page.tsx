"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  RefreshCcw,
  Server,
  Shield,
  Unlock,
  UserPlus,
} from "lucide-react";

import {
  useTelemetry,
  TelemetryData,
} from "@/hooks/useTelemetry";

const API_BASE_URL = "http://localhost:8000";

// ============================================================
// TYPES
// ============================================================

type ProcessInfo = {
  name?: string;
  pid?: number | string;
  memory_percent?: number;
  cpu_percent?: number;
};

type DashboardTelemetry = TelemetryData & {
  node_name: string;
  cpu_usage_percent: number;
  memory_usage_percent: number;
  anomaly_score?: number | null;
  is_anomaly: boolean;
  status?: string | null;
  ai_analysis?: string | null;
  ai_incident_report?: string | null;
  os?: string | null;
  top_processes?: ProcessInfo[];
};

// ============================================================
// HELPERS
// ============================================================

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getTimestampMs(
  timestamp: string | number | Date | null | undefined,
): number {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ""
  ) {
    return 0;
  }

  const milliseconds = new Date(timestamp).getTime();

  return Number.isNaN(milliseconds) ? 0 : milliseconds;
}

function formatTimestamp(
  timestamp: string | number | Date | null | undefined,
): string {
  const milliseconds = getTimestampMs(timestamp);

  if (milliseconds === 0) {
    return "--";
  }

  return new Date(milliseconds).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

// ============================================================
// SMALL COMPONENT
// ============================================================

function TelemetryRow({
  label,
  value,
  valueClass = "text-white",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
      <span className="text-xs text-slate-400">
        {label}
      </span>

      <span
        className={`text-xs font-mono ${valueClass}`}
      >
        {value}
      </span>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

export default function Dashboard() {
  // ==========================================================
  // AUTH
  // ==========================================================

  // IMPORTANT:
  // Do NOT read localStorage inside useState().
  // That causes server/client hydration mismatches.
const [token, setToken] = useState<string | null>(null);
const [authReady, setAuthReady] = useState(false);

useEffect(() => {
  const storedToken = window.localStorage.getItem(
    "sentinella_token",
  );

  // Defer the state update so React does not flag it as
  // a synchronous cascading update inside the effect.
  const frame = window.requestAnimationFrame(() => {
    setToken(storedToken);
    setAuthReady(true);
  });

  return () => {
    window.cancelAnimationFrame(frame);
  };
}, []);


  // ==========================================================
  // TELEMETRY
  // ==========================================================

  const [mode, setMode] = useState<"real" | "simulated">(
    "real",
  );

  const {
    data: rawLiveData,
    isConnected,
  } = useTelemetry(mode);

  const liveData =
    rawLiveData as DashboardTelemetry | null;

  // ==========================================================
  // AUTH FORM
  // ==========================================================

  const [isSignUp, setIsSignUp] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [authStatus, setAuthStatus] = useState("");

  // ==========================================================
  // PASSWORD
  // ==========================================================

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [showOldPassword, setShowOldPassword] =
    useState(false);

  const [showNewPassword, setShowNewPassword] =
    useState(false);

  const [passwordStatus, setPasswordStatus] =
    useState("");

  // ==========================================================
  // SYSTEM CONTROL
  // ==========================================================

  const [systemEnabled, setSystemEnabled] =
    useState(true);

  // ==========================================================
  // DATABASE LOGS
  // ==========================================================

  const [logs, setLogs] = useState<TelemetryData[]>([]);
  const [loadingLogs, setLoadingLogs] =
    useState(false);

  // ==========================================================
  // MANUAL AI TEST
  // ==========================================================

  const [customNode, setCustomNode] = useState(
    "custom-ui-node-01",
  );

  const [customCpu, setCustomCpu] =
    useState<number>(92.5);

  const [customMemory, setCustomMemory] =
    useState<number>(88);

  const [loadingAi, setLoadingAi] =
    useState(false);

  // ==========================================================
  // TOKEN STORAGE
  // ==========================================================

  const saveToken = useCallback(
    (newToken: string | null) => {
      if (typeof window !== "undefined") {
        if (newToken) {
          window.localStorage.setItem(
            "sentinella_token",
            newToken,
          );
        } else {
          window.localStorage.removeItem(
            "sentinella_token",
          );
        }
      }

      setToken(newToken);
    },
    [],
  );

  // ==========================================================
  // FETCH DATABASE TELEMETRY
  // ==========================================================

  const fetchTelemetryLogs = useCallback(
    async () => {
      setLoadingLogs(true);

      try {
        const response = await fetch(
          `${API_BASE_URL}/telemetry/`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `Telemetry API returned ${response.status}`,
          );
        }

        const result =
          (await response.json()) as TelemetryData[];

        const sorted = [...result].sort(
          (a, b) =>
            getTimestampMs(b.timestamp) -
            getTimestampMs(a.timestamp),
        );

        setLogs(sorted);
      } catch (error) {
        console.error(
          "Failed to fetch telemetry logs:",
          error,
        );
      } finally {
        setLoadingLogs(false);
      }
    },
    [],
  );

  // ==========================================================
  // LOGIN / REGISTRATION
  // ==========================================================

  const handleAuth = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    setAuthStatus("");

    try {
      if (isSignUp) {
        const response = await fetch(
          `${API_BASE_URL}/auth/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              username,
              password,
              role: "operator",
            }),
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.detail || "Registration failed.",
          );
        }

        setAuthStatus(
          "Account created successfully. Please sign in.",
        );

        setIsSignUp(false);
        setPassword("");

        return;
      }

      const formData = new URLSearchParams();

      formData.append("username", username);
      formData.append("password", password);

      const response = await fetch(
        `${API_BASE_URL}/token`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
          body: formData,
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ||
            "Invalid username or password.",
        );
      }

      saveToken(result.access_token);

      setPassword("");
      setAuthStatus("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Authentication failed.";

      setAuthStatus(message);
    }
  };

  // ==========================================================
  // LOGOUT
  // ==========================================================

  const handleLogout = () => {
    saveToken(null);

    setUsername("");
    setPassword("");
    setLogs([]);
    setAuthStatus("");
    setPasswordStatus("");
  };

  // ==========================================================
  // PASSWORD UPDATE
  // ==========================================================

  const handlePasswordUpdate = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    // Event handlers should NOT return JSX.
    if (!authReady || !token) {
      return;
    }

    setPasswordStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/password`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            old_password: oldPassword,
            new_password: newPassword,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ||
            "Password update failed.",
        );
      }

      setPasswordStatus(
        "Password updated successfully.",
      );

      setOldPassword("");
      setNewPassword("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Password update failed.";

      setPasswordStatus(message);
    }
  };

  // ==========================================================
  // SYSTEM CONTROL
  // ==========================================================

  const toggleSystemControl = async (
    enable: boolean,
  ) => {
    if (!token) {
      alert(
        "Administrator authentication required.",
      );
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/system/control?enable=${enable}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ||
            "System control request failed.",
        );
      }

      setSystemEnabled(enable);

      alert(
        result.message ||
          `System processing ${
            enable ? "resumed" : "halted"
          }.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "System control failed.";

      alert(message);
    }
  };

  // ==========================================================
  // AI DIAGNOSTIC
  // ==========================================================

  const triggerAiTest = async () => {
    setLoadingAi(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/ai/diagnose`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            node_name: customNode,
            cpu_usage_percent: customCpu,
            memory_usage_percent: customMemory,
            extra_metadata: {
              source: "frontend-manual-form",
              triggered_by: "frontend-dashboard",
            },
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ||
            "Failed to dispatch AI diagnostic.",
        );
      }

      alert(
        `AI diagnostic queued successfully.\n\nTask ID: ${result.task_id}`,
      );

      await delay(4000);
      await fetchTelemetryLogs();
    } catch (error) {
      console.error(
        "Failed to trigger AI diagnostic:",
        error,
      );

      alert(
        error instanceof Error
          ? error.message
          : "Error dispatching AI diagnostic.",
      );
    } finally {
      setLoadingAi(false);
    }
  };

  // ==========================================================
  // ADMIN REPORT DOWNLOAD
  // ==========================================================

  const downloadAdminReport = async (
    format: "json" | "csv" | "txt",
  ) => {
    if (!token) {
      alert(
        "Administrator authentication required.",
      );
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/admin/export-reports?format=${format}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        let message =
          "Failed to generate report.";

        try {
          const result = await response.json();
          message = result.detail || message;
        } catch {
          // Ignore invalid JSON.
        }

        throw new Error(message);
      }

      const blob = await response.blob();

      const url =
        window.URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = url;
      link.download =
        `sentinella-incident-report.${format}`;

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Report download failed.",
      );
    }
  };

  // ==========================================================
  // CURRENT LIVE TELEMETRY
  // ==========================================================

  const currentAnomaly =
    liveData?.is_anomaly ?? false;

  const currentStatus =
    liveData?.status ||
    "Waiting for telemetry";

  const currentAnalysis =
    liveData?.ai_analysis || null;

  const currentReport =
    liveData?.ai_incident_report || null;

  // ==========================================================
  // AUTH INITIALIZATION SCREEN
  // ==========================================================

  if (!authReady) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="text-sm text-slate-400">
          Loading Sentinella...
        </div>
      </main>
    );
  }

  // ==========================================================
  // LOGIN SCREEN
  // ==========================================================

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-8 rounded-2xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 mb-2">
              <Shield size={28} />
            </div>

            <h1 className="text-xl font-bold text-white">
              Sentinella Enterprise AIOps
            </h1>

            <p className="text-xs text-slate-400">
              Infrastructure telemetry, anomaly
              detection and AI-powered SRE diagnostics.
            </p>
          </div>

          {authStatus && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs p-3 rounded-lg text-center">
              {authStatus}
            </div>
          )}

          <form
            onSubmit={handleAuth}
            className="space-y-4"
          >
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Username
              </label>

              <input
                type="text"
                required
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value)
                }
                placeholder="admin"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Password
              </label>

              <div className="relative">
                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  required
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 pr-10 text-xs text-white focus:outline-none focus:border-indigo-500"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (value) => !value,
                    )
                  }
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                >
                  {showPassword ? (
                    <EyeOff size={14} />
                  ) : (
                    <Eye size={14} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg text-xs transition flex items-center justify-center gap-2"
            >
              {isSignUp ? (
                <UserPlus size={14} />
              ) : (
                <LogIn size={14} />
              )}

              {isSignUp
                ? "Create Account"
                : "Sign In to Dashboard"}
            </button>
          </form>

          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(
                  (value) => !value,
                );
                setAuthStatus("");
              }}
              className="text-xs text-indigo-400 hover:underline"
            >
              {isSignUp
                ? "Already have an account? Sign In"
                : "Don't have an account? Sign Up"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================================
  // DASHBOARD
  // ==========================================================

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 space-y-6">
      {/* HEADER */}

      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity className="text-indigo-500" />
            Sentinella AIOps Platform
          </h1>

          <p className="text-sm text-slate-400 mt-1">
            Real-Time Infrastructure Monitoring &
            AI Incident Intelligence
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-full border border-slate-800 text-xs">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isConnected
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-rose-500"
              }`}
            />

            {isConnected
              ? "Stream Connected"
              : "Disconnected"}
          </div>

          <button
            type="button"
            onClick={() =>
              setMode((current) =>
                current === "real"
                  ? "simulated"
                  : "real",
              )
            }
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            Mode: {mode.toUpperCase()}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="bg-rose-600/20 text-rose-400 border border-rose-500/30 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-rose-600/30 transition flex items-center gap-1"
          >
            <LogOut size={13} />
            Log Out
          </button>
        </div>
      </div>

      {/* TOP STATUS */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400">
                CPU Utilization
              </p>

              <p className="text-3xl font-bold text-white mt-1">
                {liveData
                  ? `${Number(
                      liveData.cpu_usage_percent,
                    ).toFixed(1)}%`
                  : "--"}
              </p>
            </div>

            <Cpu
              className="text-indigo-400"
              size={26}
            />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400">
                Memory Utilization
              </p>

              <p className="text-3xl font-bold text-white mt-1">
                {liveData
                  ? `${Number(
                      liveData.memory_usage_percent,
                    ).toFixed(1)}%`
                  : "--"}
              </p>
            </div>

            <HardDrive
              className="text-purple-400"
              size={26}
            />
          </div>
        </div>

        <div
          className={`p-5 rounded-xl shadow-lg border ${
            currentAnomaly
              ? "bg-rose-950/30 border-rose-500/40"
              : "bg-slate-900 border-slate-800"
          }`}
        >
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400">
                Infrastructure Status
              </p>

              <p
                className={`text-lg font-bold mt-2 ${
                  currentAnomaly
                    ? "text-rose-400"
                    : "text-emerald-400"
                }`}
              >
                {currentStatus}
              </p>
            </div>

            {currentAnomaly ? (
              <AlertTriangle
                className="text-rose-400"
                size={28}
              />
            ) : (
              <CheckCircle2
                className="text-emerald-400"
                size={28}
              />
            )}
          </div>
        </div>
      </div>

      {/* ADMIN */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* SYSTEM */}

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <Server
              className="text-indigo-400"
              size={19}
            />

            <h2 className="font-semibold text-white">
              System Processing
            </h2>
          </div>

          <p className="text-xs text-slate-400 mb-4">
            Administrator control over telemetry
            processing.
          </p>

          <div className="bg-slate-950 px-4 py-3 rounded-lg border border-slate-800 flex justify-between items-center">
            <span className="text-xs flex items-center gap-2">
              {systemEnabled ? (
                <Unlock
                  size={14}
                  className="text-emerald-400"
                />
              ) : (
                <Lock
                  size={14}
                  className="text-amber-400"
                />
              )}

              <strong
                className={
                  systemEnabled
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                {systemEnabled
                  ? "RESUMED"
                  : "HALTED"}
              </strong>
            </span>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  toggleSystemControl(true)
                }
                className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded text-xs"
              >
                Resume
              </button>

              <button
                type="button"
                onClick={() =>
                  toggleSystemControl(false)
                }
                className="bg-amber-600/20 text-amber-400 border border-amber-500/30 px-3 py-1 rounded text-xs"
              >
                Halt
              </button>
            </div>
          </div>
        </div>

        {/* REPORTS */}

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <Shield
              className="text-indigo-400"
              size={19}
            />

            <h2 className="font-semibold text-white">
              Audit & Incident Reports
            </h2>
          </div>

          <p className="text-xs text-slate-400 mb-4">
            Download telemetry and AI incident records.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {(["json", "csv", "txt"] as const).map(
              (format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() =>
                    downloadAdminReport(format)
                  }
                  className={
                    format === "json"
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-xs font-semibold"
                      : format === "csv"
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-semibold"
                        : "bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg text-xs font-semibold"
                  }
                >
                  {format.toUpperCase()}
                </button>
              ),
            )}
          </div>
        </div>

        {/* SECURITY */}

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound
              className="text-indigo-400"
              size={19}
            />

            <h2 className="font-semibold text-white">
              Security
            </h2>
          </div>

          <form
            onSubmit={handlePasswordUpdate}
            className="space-y-2"
          >
            {passwordStatus && (
              <div className="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 p-2 rounded">
                {passwordStatus}
              </div>
            )}

            <div className="relative">
              <input
                type={
                  showOldPassword
                    ? "text"
                    : "password"
                }
                required
                value={oldPassword}
                onChange={(e) =>
                  setOldPassword(e.target.value)
                }
                placeholder="Current Password"
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white pr-8"
              />

              <button
                type="button"
                onClick={() =>
                  setShowOldPassword(
                    (value) => !value,
                  )
                }
                className="absolute right-2 top-2 text-slate-400"
              >
                {showOldPassword ? (
                  <EyeOff size={13} />
                ) : (
                  <Eye size={13} />
                )}
              </button>
            </div>

            <div className="relative">
              <input
                type={
                  showNewPassword
                    ? "text"
                    : "password"
                }
                required
                value={newPassword}
                onChange={(e) =>
                  setNewPassword(e.target.value)
                }
                placeholder="New Password"
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white pr-8"
              />

              <button
                type="button"
                onClick={() =>
                  setShowNewPassword(
                    (value) => !value,
                  )
                }
                className="absolute right-2 top-2 text-slate-400"
              >
                {showNewPassword ? (
                  <EyeOff size={13} />
                ) : (
                  <Eye size={13} />
                )}
              </button>
            </div>

            <button
              type="submit"
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 rounded text-xs"
            >
              Update Password
            </button>
          </form>
        </div>
      </div>

      {/* LIVE TELEMETRY + AI */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LIVE NODE */}

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg space-y-3">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Cpu
              className="text-indigo-400"
              size={18}
            />
            Live Node Telemetry
          </h2>

          <TelemetryRow
            label="Node"
            value={
              liveData?.node_name || "Waiting..."
            }
          />

          <TelemetryRow
            label="CPU"
            value={
              liveData
                ? `${Number(
                    liveData.cpu_usage_percent,
                  ).toFixed(2)}%`
                : "--"
            }
            valueClass="text-indigo-400"
          />

          <TelemetryRow
            label="Memory"
            value={
              liveData
                ? `${Number(
                    liveData.memory_usage_percent,
                  ).toFixed(2)}%`
                : "--"
            }
            valueClass="text-indigo-400"
          />

          <TelemetryRow
            label="Anomaly Score"
            value={
              liveData?.anomaly_score !== null &&
              liveData?.anomaly_score !== undefined
                ? Number(
                    liveData.anomaly_score,
                  ).toFixed(6)
                : "--"
            }
            valueClass="text-amber-400"
          />

          <TelemetryRow
            label="Status"
            value={
              liveData?.status || "Waiting"
            }
            valueClass={
              liveData?.is_anomaly
                ? "text-rose-400"
                : "text-emerald-400"
            }
          />

          {liveData?.os && (
            <div className="text-[10px] text-slate-500">
              OS: {liveData.os}
            </div>
          )}
        </div>

        {/* AI */}

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg lg:col-span-2 space-y-4">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <AlertTriangle
                className={
                  currentAnomaly
                    ? "text-rose-400"
                    : "text-amber-400"
                }
                size={18}
              />

              AI Root-Cause Diagnostics
            </h2>

            <button
              type="button"
              onClick={triggerAiTest}
              disabled={loadingAi}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2"
            >
              <RefreshCcw
                size={13}
                className={
                  loadingAi
                    ? "animate-spin"
                    : ""
                }
              />

              {loadingAi
                ? "Analyzing..."
                : "Trigger AI Test"}
            </button>
          </div>

          <div
            className={`p-5 rounded-lg border min-h-[170px] ${
              currentAnomaly
                ? "bg-rose-950/20 border-rose-500/30"
                : "bg-slate-950 border-slate-800"
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              {currentAnomaly ? (
                <AlertTriangle
                  size={17}
                  className="text-rose-400"
                />
              ) : (
                <CheckCircle2
                  size={17}
                  className="text-emerald-400"
                />
              )}

              <span
                className={`text-xs font-bold ${
                  currentAnomaly
                    ? "text-rose-400"
                    : "text-emerald-400"
                }`}
              >
                {currentAnomaly
                  ? "ANOMALY DETECTED"
                  : "SYSTEM NOMINAL"}
              </span>
            </div>

            <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">
              {currentAnalysis ||
                "Awaiting telemetry analysis..."}
            </p>

            {currentReport &&
              currentReport !==
                currentAnalysis && (
                <div className="mt-5 pt-4 border-t border-slate-800">
                  <p className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold mb-2">
                    SRE Incident Report
                  </p>

                  <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">
                    {currentReport}
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* MANUAL TELEMETRY */}

      <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCcw
            className="text-indigo-400"
            size={18}
          />

          <h2 className="font-semibold text-white">
            Manual Telemetry & AI Test
          </h2>
        </div>

        <p className="text-xs text-slate-400 mb-5">
          Send custom CPU and memory metrics through
          the same Celery → Isolation Forest → Gemini
          pipeline.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">
              Node Name
            </label>

            <input
              type="text"
              value={customNode}
              onChange={(e) =>
                setCustomNode(e.target.value)
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">
              CPU Usage (%)
            </label>

            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={customCpu}
              onChange={(e) =>
                setCustomCpu(
                  Number(e.target.value),
                )
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">
              Memory Usage (%)
            </label>

            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={customMemory}
              onChange={(e) =>
                setCustomMemory(
                  Number(e.target.value),
                )
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={triggerAiTest}
          disabled={loadingAi}
          className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2"
        >
          <RefreshCcw
            size={14}
            className={
              loadingAi
                ? "animate-spin"
                : ""
            }
          />

          {loadingAi
            ? "Processing Telemetry..."
            : "Dispatch Telemetry & Run AI Diagnostics"}
        </button>
      </div>

      {/* TOP PROCESSES */}

      {liveData?.top_processes &&
        liveData.top_processes.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
              <Server
                className="text-indigo-400"
                size={18}
              />

              Top Memory Processes
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {liveData.top_processes.map(
                (process, index) => {
                  const safeProcess =
                    process as ProcessInfo;

                  return (
                    <div
                      key={`${safeProcess.name}-${safeProcess.pid ?? index}`}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-3"
                    >
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-xs text-slate-200 font-mono font-semibold truncate">
                          {safeProcess.name ||
                            "Unknown"}
                        </span>

                        <span className="text-xs text-indigo-400 font-semibold whitespace-nowrap">
                          {Number(
                            safeProcess.memory_percent ??
                              0,
                          ).toFixed(2)}
                          %
                        </span>
                      </div>

                      <div className="flex justify-between mt-2 text-[10px] text-slate-500">
                        <span>
                          PID:{" "}
                          {safeProcess.pid ??
                            "N/A"}
                        </span>

                        <span>
                          CPU:{" "}
                          {Number(
                            safeProcess.cpu_percent ??
                              0,
                          ).toFixed(2)}
                          %
                        </span>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}

      {/* HISTORY */}

      <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-white flex items-center gap-2">
              <HardDrive
                className="text-indigo-400"
                size={18}
              />

              Stored Telemetry & Incident History
            </h2>

            <p className="text-[11px] text-slate-500 mt-1">
              PostgreSQL records processed by the Celery
              worker.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void fetchTelemetryLogs()
            }
            disabled={loadingLogs}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs flex items-center gap-2"
          >
            <RefreshCcw
              size={13}
              className={
                loadingLogs
                  ? "animate-spin"
                  : ""
              }
            />

            Refresh Logs
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs">
            {loadingLogs
              ? "Loading telemetry records..."
              : "No telemetry records found."}
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {logs.map((log) => {
              const anomaly =
                log.is_anomaly;

              return (
                <div
                  key={log.id}
                  className={`border rounded-xl p-4 ${
                    anomaly
                      ? "bg-rose-950/20 border-rose-500/30"
                      : "bg-slate-950 border-slate-800"
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {anomaly ? (
                        <AlertTriangle
                          size={15}
                          className="text-rose-400"
                        />
                      ) : (
                        <CheckCircle2
                          size={15}
                          className="text-emerald-400"
                        />
                      )}

                      <span className="text-xs font-semibold text-white">
                        {log.node_name}
                      </span>

                      <span
                        className={`text-[10px] px-2 py-1 rounded ${
                          anomaly
                            ? "bg-rose-500/10 text-rose-400"
                            : "bg-emerald-500/10 text-emerald-400"
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>

                    <span className="text-[10px] text-slate-500">
                      {formatTimestamp(
                        log.timestamp,
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div>
                      <p className="text-[10px] text-slate-500">
                        CPU
                      </p>

                      <p className="text-sm text-indigo-400 font-mono">
                        {log.cpu_usage_percent}%
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] text-slate-500">
                        Memory
                      </p>

                      <p className="text-sm text-indigo-400 font-mono">
                        {log.memory_usage_percent}%
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] text-slate-500">
                        Anomaly Score
                      </p>

                      <p className="text-sm text-amber-400 font-mono">
                        {log.anomaly_score !==
                          null &&
                        log.anomaly_score !==
                          undefined
                          ? Number(
                              log.anomaly_score,
                            ).toFixed(6)
                          : "--"}
                      </p>
                    </div>
                  </div>

                  {log.ai_analysis && (
                    <div className="mt-4 pt-3 border-t border-slate-800">
                      <p className="text-[10px] uppercase tracking-wide text-indigo-400 font-bold mb-1">
                        AI Analysis
                      </p>

                      <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">
                        {log.ai_analysis
                          .split(
                            "| SRE Report:",
                          )[0]
                          .trim()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FOOTER */}

      <div className="text-center text-[10px] text-slate-600 pb-4">
        Sentinella Enterprise AIOps Platform •
        Telemetry + Isolation Forest + Celery + Gemini +
        PostgreSQL
      </div>
    </main>
  );
}
