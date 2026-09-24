import { useState } from "react";
import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { DownloadIcon } from "@renderer/components/ui/icons";

type ExportFormat = "xlsx" | "csv";

const FORMATS: { id: ExportFormat; label: string; title: string }[] = [
  {
    id: "xlsx",
    label: "Export to Excel",
    title: "One Excel file with a sheet for every part of wholesale",
  },
  {
    id: "csv",
    label: "CSV files",
    title: "A zip of plain CSV files, one per sheet, for pandas, R or Power BI",
  },
];

// Every wholesale record — vouchers, shipments, receiving, orders, payments, stock,
// write-offs and the master lists — as flat tables for analysing outside the app. The
// server builds the file (GET /api/wholesale/export) so its statuses and totals are the
// ones the screens show.
export function ExportDataButtons({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const showToast = useToast();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function download(format: ExportFormat): Promise<void> {
    setBusy(format);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/wholesale/export?format=${format}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        showToast("error", body?.detail ?? `Export failed (${response.status})`);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `wholesale-data-${new Date().toLocaleDateString("en-CA")}.${format === "xlsx" ? "xlsx" : "zip"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast("success", "Wholesale data downloaded.");
    } catch {
      showToast("error", "Could not download the wholesale data. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {FORMATS.map((format) => (
        <Button
          key={format.id}
          variant="secondary"
          size="sm"
          title={format.title}
          loading={busy === format.id}
          disabled={busy !== null}
          onClick={() => void download(format.id)}
        >
          {busy === format.id ? null : <DownloadIcon className="w-4 h-4" />}
          {busy === format.id ? "Preparing…" : format.label}
        </Button>
      ))}
    </div>
  );
}
