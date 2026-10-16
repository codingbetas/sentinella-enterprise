import { useEffect, useState } from "react";

export interface ProcessItem {
  pid: number | null;
  name: string | null;
  memory_percent: number;
  cpu_percent: number;
  username?: string | null;
}

export interface TelemetryData {
  id?: number | string;

  node_name: string;

  cpu_usage_percent: number;
  memory_usage_percent: number;

  anomaly_score?: number | null;
  is_anomaly?: boolean;

  status?: string;

  mode?: "real" | "simulated";

  os?: string;

  timestamp?: string;

  ai_analysis?: string | null;

  ai_incident_report?: string | null;

  top_processes?: ProcessItem[];
}

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export function useTelemetry(
  mode: "real" | "simulated" = "real",
) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) {
        return;
      }

      const url =
        `${WS_BASE_URL}/ws/telemetry?mode=${encodeURIComponent(mode)}`;

      console.log(
        "Connecting to telemetry WebSocket:",
        url,
      );

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          if (stopped) {
            return;
          }

          console.log(
            "Telemetry WebSocket connected.",
          );

          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          if (stopped) {
            return;
          }

          try {
            const parsed =
              JSON.parse(event.data) as TelemetryData;

            setData(parsed);
          } catch (error) {
            console.error(
              "Failed to parse telemetry WebSocket message:",
              error,
            );
          }
        };

        ws.onerror = (error) => {
          if (stopped) {
            return;
          }

          console.error(
            "Telemetry WebSocket error:",
            error,
          );

          setIsConnected(false);
        };

        ws.onclose = (event) => {
          if (stopped) {
            return;
          }

          console.warn(
            "Telemetry WebSocket closed:",
            event.code,
            event.reason,
          );

          setIsConnected(false);

          reconnectTimer = setTimeout(() => {
            connect();
          }, 2000);
        };
      } catch (error) {
        console.error(
          "Failed to create telemetry WebSocket:",
          error,
        );

        setIsConnected(false);

        reconnectTimer = setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    connect();

    return () => {
      stopped = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;

        ws.close();
        ws = null;
      }
    };
  }, [mode]);

  return {
    data,
    isConnected,
  };
}
