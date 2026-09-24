import { useRef, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { invalidateEverything } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { maybeCompressFile } from "@renderer/lib/uploadCompression";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { UploadIcon } from "@renderer/components/ui/icons";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

interface Props {
  session: Session;
  branchId: string;
}

type GeneralUploadResult =
  | {
      salary_records_created: number;
      zero_selling_records_created: number;
      daily_cost_records_created: number;
    }
  | { error: string };

function GeneralFileImportCard({
  session,
  branchId,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileSelected(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const oversizedFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFile) {
      showToast("error", `${oversizedFile.name} exceeds the 50 MB limit.`);
      return;
    }

    setIsUploading(true);
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const formData = new FormData();
          formData.append("file", await maybeCompressFile(file));
          if (branchId) formData.append("branch_id", branchId);

          const response = await fetch(`${apiBaseUrl}/api/imports/general`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });
          if (response.ok) {
            const body = (await response.json()) as {
              salary_records_created?: number;
              zero_selling_records_created?: number;
              daily_cost_records_created?: number;
            };
            return {
              salary_records_created: body.salary_records_created ?? 0,
              zero_selling_records_created:
                body.zero_selling_records_created ?? 0,
              daily_cost_records_created: body.daily_cost_records_created ?? 0,
            };
          }
          const body = await response.json().catch(() => null);
          return {
            error:
              body?.detail ??
              `${file.name}: upload failed (${response.status})`,
          };
        }),
      );
      const errors = results
        .filter(
          (result): result is Extract<GeneralUploadResult, { error: string }> =>
            "error" in result,
        )
        .map((result) => result.error);
      if (errors.length > 0) {
        showToast("error", errors.join(" "));
        return;
      }

      const salaryRecordsCreated = results.reduce(
        (total, result) =>
          total +
          ("salary_records_created" in result
            ? (result.salary_records_created ?? 0)
            : 0),
        0,
      );
      const zeroSellingRecordsCreated = results.reduce(
        (total, result) =>
          total +
          ("zero_selling_records_created" in result
            ? (result.zero_selling_records_created ?? 0)
            : 0),
        0,
      );
      const dailyCostRecordsCreated = results.reduce(
        (total, result) =>
          total +
          ("daily_cost_records_created" in result
            ? (result.daily_cost_records_created ?? 0)
            : 0),
        0,
      );

      invalidateEverything();
      showToast(
        "success",
        `${files.length} general ${files.length === 1 ? "file" : "files"} stored unchanged.${
          salaryRecordsCreated > 0
            ? ` ${salaryRecordsCreated} salary ${salaryRecordsCreated === 1 ? "record" : "records"} added.`
            : ""
        }${
          zeroSellingRecordsCreated > 0
            ? ` ${zeroSellingRecordsCreated} zero-selling ${zeroSellingRecordsCreated === 1 ? "record" : "records"} added.`
            : ""
        }${
          dailyCostRecordsCreated > 0
            ? ` ${dailyCostRecordsCreated} daily usage ${dailyCostRecordsCreated === 1 ? "record" : "records"} added.`
            : ""
        }`,
      );
    } catch {
      showToast("error", "Upload failed — is the backend running?");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
              <UploadIcon />
            </span>
            General File
          </span>
        }
        description="Store files unchanged; recognised records are added to the relevant data tables"
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(event) => void handleFileSelected(event)}
        className="hidden"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-muted py-10 px-4 transition-all duration-150 hover:border-brand hover:text-brand hover:bg-brand-subtle/40 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer"
      >
        <UploadIcon />
        <span className="text-sm font-medium">
          {isUploading ? "Storing files…" : "Click to choose files"}
        </span>
        <span className="text-xs">Any file type — up to 50 MB per file</span>
      </button>
    </Card>
  );
}

export default GeneralFileImportCard;
