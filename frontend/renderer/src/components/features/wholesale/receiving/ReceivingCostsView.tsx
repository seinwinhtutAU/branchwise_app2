import React from "react";
import { Button } from "@renderer/components/ui/Button";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CellInput,
  CurrencySelect,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/currency";
import {
  COST_KINDS,
  type Receiving,
  type ReceivingCost,
} from "@renderer/components/features/wholesale/receivings";
import { formatKyat } from "@renderer/components/features/wholesale/shared";
import { formatSets } from "@renderer/components/features/wholesale/units";

export function ReceivingCostsView({
  receiving,
  costPerPackage,
  costPerPair,
  counted,
  stages,
  carriers,
  totalCostAmount,
  addCost,
  removeCost,
  setCost,
  setCostCurrency,
  setCostOriginalAmount,
  setCostExchangeRate,
}: {
  receiving: Receiving;
  costPerPackage: number;
  costPerPair: number;
  counted: number;
  stages: string[];
  carriers: string[];
  totalCostAmount: number;
  addCost: () => void;
  removeCost: (index: number) => void;
  setCost: (index: number, patch: Partial<ReceivingCost>) => void;
  setCostCurrency: (index: number, code: CurrencyCode) => void;
  setCostOriginalAmount: (index: number, value: number) => void;
  setCostExchangeRate: (index: number, value: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Only the two figures you cannot read off the table itself. The total is
          already on the tab and again under the table, and the "Add cost" button
          already sits in the table header, so neither needs a card of its own. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-bg-base p-4 shadow-xs">
          <span className="text-xs font-medium text-text-muted">
            Cost Per Package
          </span>
          <p className="text-xl font-bold font-mono text-text-primary mt-1">
            {formatKyat(costPerPackage)}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            Across {receiving.total_packages} total packages
          </p>
        </div>

        <div className="rounded-xl border border-border bg-bg-base p-4 shadow-xs">
          <span className="text-xs font-medium text-text-muted">
            Cost / Pair
          </span>
          <p className="text-xl font-bold font-mono text-success mt-1">
            +{formatKyat(costPerPair)}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            Based on {formatSets(counted)} counted
          </p>
        </div>
      </div>

      {/* Costs table */}
      <div className="flex-1 min-h-[440px] border border-border rounded-xl bg-bg-base overflow-hidden flex flex-col shadow-xs">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-bg-subtle/30">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Costs</h3>
            <p className="text-xs text-text-muted">
              Record what was spent stage by stage to see the true cost per shoe.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={addCost}
            className="h-7 text-xs gap-1 shadow-xs"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add Cost
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <TableContainer className="rounded-lg border border-border">
            <Thead>
              <Tr>
                <Th className="min-w-[11rem]">Stage / Location</Th>
                <Th className="w-32">Date</Th>
                <Th className="min-w-[11rem]">Paid To</Th>
                <Th className="min-w-[10rem]">Fee Type</Th>
                <Th className="w-48 text-right">Amount</Th>
                <Th className="min-w-[12rem]">Note</Th>
                <Th className="w-10" aria-label="Remove" />
              </Tr>
            </Thead>
            <Tbody>
              {receiving.costs.map((cost, index) => (
                <Tr key={cost.cost_id}>
                  <Td>
                    <SuggestInput
                      label={`Where cost ${index + 1} was spent`}
                      placeholder="e.g. Mawlamyine Cargo"
                      suggestions={stages}
                      value={cost.stage}
                      onChange={(next) => setCost(index, { stage: next })}
                      bare
                    />
                  </Td>
                  <Td>
                    <CellInput
                      label={`Date of cost ${index + 1}`}
                      placeholder="YYYY-MM-DD"
                      type="date"
                      value={cost.cost_date}
                      onChange={(cost_date) => setCost(index, { cost_date })}
                      className="font-mono text-xs"
                    />
                  </Td>
                  <Td>
                    <SuggestInput
                      label={`Who was paid for cost ${index + 1}`}
                      placeholder="Carrier/Driver/Porter"
                      suggestions={carriers}
                      value={cost.carrier}
                      onChange={(next) => setCost(index, { carrier: next })}
                      bare
                    />
                  </Td>
                  <Td>
                    <SuggestInput
                      label={`What cost ${index + 1} was for`}
                      placeholder="Fee type"
                      suggestions={COST_KINDS}
                      value={cost.kind}
                      onChange={(next) => setCost(index, { kind: next })}
                      bare
                    />
                  </Td>
                  {/* Currency sits inside the amount cell rather than in a column
                      of its own — it is part of writing the amount, and almost
                      every line is in Kyat anyway. */}
                  <Td className="text-right">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <CurrencySelect
                          label={`Currency ${index + 1}`}
                          value={
                            (cost.currency_code as CurrencyCode) ||
                            DEFAULT_CURRENCY
                          }
                          onChange={(code) => setCostCurrency(index, code)}
                          className="shrink-0 text-xs px-1"
                        />
                        {cost.currency_code &&
                        isForeignCurrency(cost.currency_code) ? (
                          <CellInput
                            label={`Original amount ${index + 1}`}
                            placeholder="Original"
                            className="flex-1 text-right font-mono"
                            value={String(cost.original_amount ?? "")}
                            onChange={(next) =>
                              setCostOriginalAmount(index, Number(next) || 0)
                            }
                          />
                        ) : (
                          <CellInput
                            label={`Amount ${index + 1}`}
                            placeholder="0"
                            numeric
                            className="flex-1 text-right font-mono font-semibold"
                            value={String(cost.amount || "")}
                            onChange={(next) =>
                              setCost(index, { amount: Number(next) || 0 })
                            }
                          />
                        )}
                      </div>

                      {cost.currency_code &&
                        isForeignCurrency(cost.currency_code) && (
                          <>
                            <CellInput
                              label={`Exchange rate ${index + 1}`}
                              placeholder="Rate"
                              className="text-right font-mono text-xs"
                              value={String(cost.exchange_rate ?? "")}
                              onChange={(next) =>
                                setCostExchangeRate(index, Number(next) || 0)
                              }
                            />
                            <span className="text-xs font-bold font-mono text-brand tabular-nums">
                              = {formatKyat(cost.amount)}
                            </span>
                          </>
                        )}
                    </div>
                  </Td>
                  <Td>
                    <CellInput
                      label={`Note on cost ${index + 1}`}
                      placeholder="Take a note..."
                      value={cost.note}
                      onChange={(next) => setCost(index, { note: next })}
                    />
                  </Td>
                  <Td className="text-center">
                    <button
                      type="button"
                      onClick={() => removeCost(index)}
                      className="p-1.5 rounded text-text-muted hover:text-error hover:bg-error-subtle transition-colors"
                      title="Remove cost line"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </Td>
                </Tr>
              ))}

              {receiving.costs.length === 0 && (
                <Tr>
                  <Td
                    colSpan={7}
                    className="text-center py-8 text-text-muted text-xs"
                  >
                    No expenses logged for this arrival yet. Click "Add Cost"
                    above.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </TableContainer>
        </div>

        <div className="px-5 py-3 border-t border-border bg-bg-subtle/50 flex items-center justify-between text-sm">
          <span className="font-semibold text-text-secondary">
            Total Cost ({receiving.costs.length} lines)
          </span>
          <span className="font-bold font-mono text-brand text-base">
            {formatKyat(totalCostAmount)}
          </span>
        </div>
      </div>
    </div>
  );
}
