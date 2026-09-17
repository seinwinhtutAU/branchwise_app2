/* The report tabs intentionally share a query hook and table primitives from this module. */
/* eslint-disable react-refresh/only-export-components */
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { DashboardIcon } from "@renderer/components/ui/icons";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { WHOLESALE_REPORTS_URL } from "@renderer/components/features/wholesale/shared/api";
import {
  periodQueryParams,
  previousPeriodLabel,
  type PeriodKey,
} from "@renderer/components/features/dashboard/helpers";
import type { ReactNode } from "react";

export interface ReportTabProps {
  session: Session;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
}

export function reportUrl(
  pillar: "revenue" | "cost" | "inventory" | "customer",
  period: PeriodKey,
  dateFrom: string,
  dateTo: string,
): string {
  const params = periodQueryParams(period, dateFrom, dateTo);
  return `${WHOLESALE_REPORTS_URL}/${pillar}?${params.toString()}`;
}

export function useWholesaleReport<T>(
  pillar: "revenue" | "cost" | "inventory" | "customer",
  props: ReportTabProps,
): {
  data: T | undefined;
  isRefreshing: boolean;
  failed: boolean;
  reload: () => Promise<void>;
} {
  return useUrlQuery<T>(
    reportUrl(pillar, props.period, props.dateFrom, props.dateTo),
    props.session,
    `${pillar} report`,
  );
}

export function ReportLoading({
  tiles = 4,
}: {
  tiles?: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: tiles }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-56" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function ReportError({
  title,
  reload,
}: {
  title: string;
  reload: () => Promise<void>;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<DashboardIcon />}
      title={`Couldn't load the ${title} report`}
      description="Something went wrong reaching the backend."
      action={
        <Button variant="secondary" size="sm" onClick={reload}>
          Try again
        </Button>
      }
    />
  );
}

export function ReportSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      {children}
    </Card>
  );
}

export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: string;
}): React.JSX.Element {
  return (
    <Tr>
      <Td
        colSpan={colSpan}
        className="py-10 text-center text-sm text-text-muted"
      >
        {children}
      </Td>
    </Tr>
  );
}

export function ReportTable({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <TableContainer className="rounded-none border-0">
      {children}
    </TableContainer>
  );
}

export function ReportTableHeader({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Thead>
      <Tr>{children}</Tr>
    </Thead>
  );
}

export function ReportTableBody({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return <Tbody>{children}</Tbody>;
}

export function ReportRefreshing({
  show,
}: {
  show: boolean;
}): React.JSX.Element | null {
  if (!show) return null;
  return (
    <p className="text-xs text-text-muted" role="status">
      Refreshing…
    </p>
  );
}

export function ReportKpiNote({
  period,
  dateFrom,
  dateTo,
}: Pick<ReportTabProps, "period" | "dateFrom" | "dateTo">): string {
  return previousPeriodLabel(period, dateFrom, dateTo);
}

export {
  Button,
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  formatKyat,
  formatQty,
  formatSets,
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
};
