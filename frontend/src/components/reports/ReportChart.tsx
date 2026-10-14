import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  guestHistorySeries,
  occupancySeries,
  revenueSeries,
  serviceUsageSeries,
  type ServiceRankBy,
} from "@/lib/reportCharts";
import type { ReportType } from "@/lib/reportUrl";

/**
 * Chart summary above the data table for the reports whose rows aggregate into
 * a meaningful series. Built on the shadcn chart primitive (recharts) with the
 * locked Mono chart tokens; solid fills only, per DESIGN.md. Exact amounts stay
 * exact — the datum labels rendered in tooltips are formatted from the shared
 * money helpers, while the float values feed recharts scaling only.
 */

const CHART_TITLES: Record<string, { title: string; description: string }> = {
  occupancy: {
    title: "Occupancy by branch",
    description:
      "Share of active rooms currently occupied, per branch (CHECKED_IN lines).",
  },
  revenue: {
    title: "Monthly billed revenue",
    description:
      "FINAL invoice lines grouped by Asia/Colombo issue month; branches aggregated.",
  },
  "service-usage": {
    title: "Top services by revenue",
    description: "Non-void recorded usage, ranked by revenue generated.",
  },
  "preference-trends": {
    title: "Top guest preferences",
    description: "Most consumed services, ranked as selected.",
  },
  "guest-history": {
    title: "Top guests by lifetime expenditure",
    description: "Successful cash payments summed across all bookings.",
  },
};

const REVENUE_CONFIG: ChartConfig = {
  room: { label: "Room", color: "var(--color-chart-1)" },
  service: { label: "Service", color: "var(--color-chart-3)" },
  other: { label: "Other", color: "var(--color-chart-4)" },
};

const SINGLE_BAR_CONFIG = (label: string, color: string): ChartConfig => ({
  value: { label, color },
});

function truncate(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const COMPACT_NUMBER = new Intl.NumberFormat("en", { notation: "compact" });

function compactMoney(value: number): string {
  return COMPACT_NUMBER.format(value);
}

interface ReportChartProps {
  report: ReportType;
  rows: unknown[];
  /** Ranking metric for the preference-trends report. */
  rankBy?: ServiceRankBy;
  /** Row budget for ranking charts; sensible per-report defaults apply. */
  limit?: number;
}

export function ReportChart({ report, rows, rankBy = "revenue", limit }: ReportChartProps) {
  const heading = CHART_TITLES[report];
  if (!heading) return null;

  if (report === "occupancy") {
    const series = occupancySeries(rows);
    if (!series.length) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={SINGLE_BAR_CONFIG("Occupancy rate", "var(--color-chart-1)")}
            className="aspect-auto h-56 w-full"
          >
            <BarChart data={series} layout="vertical" margin={{ left: 4, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                unit="%"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                dataKey="branch"
                type="category"
                width={128}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: string) => truncate(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel={false}
                    formatter={(_value, _name, item) => {
                      const datum = item.payload as {
                        occupancyRate: number;
                        occupiedRooms: number;
                        totalRooms: number;
                      };
                      return (
                        <div className="flex flex-1 justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">Occupancy</span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {datum.occupancyRate}% · {datum.occupiedRooms}/
                            {datum.totalRooms} rooms
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="occupancyRate" fill="var(--color-value)" radius={4} barSize={18} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  }

  if (report === "revenue") {
    const series = revenueSeries(rows);
    if (!series.length) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={REVENUE_CONFIG} className="aspect-auto h-64 w-full">
            <BarChart data={series} margin={{ left: 4, right: 16, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(value: number) => compactMoney(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, name, item) => {
                      const datum = item.payload as Record<string, string>;
                      return (
                        <div className="flex flex-1 justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {datum[`${name}Label`] ?? String(value)}
                          </span>
                        </div>
                      );
                    }}
                    labelFormatter={(label) => `Month: ${label}`}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="room" stackId="revenue" fill="var(--color-room)" />
              <Bar dataKey="service" stackId="revenue" fill="var(--color-service)" />
              <Bar dataKey="other" stackId="revenue" fill="var(--color-other)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  }

  if (report === "service-usage" || report === "preference-trends") {
    const by: ServiceRankBy = report === "preference-trends" ? rankBy : "revenue";
    const series = serviceUsageSeries(rows, by, limit ?? (report === "preference-trends" ? 5 : 8));
    if (!series.length) return null;
    const chartKey = by === "quantity" ? "quantity" : "revenue";
    return (
      <Card>
        <CardHeader>
          <CardTitle>{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={SINGLE_BAR_CONFIG(
              by === "quantity" ? "Quantity consumed" : "Revenue",
              by === "quantity" ? "var(--color-chart-2)" : "var(--color-chart-1)",
            )}
            className="aspect-auto h-64 w-full"
          >
            <BarChart data={series} layout="vertical" margin={{ left: 4, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) =>
                  by === "quantity" ? String(value) : compactMoney(value)
                }
              />
              <YAxis
                dataKey="service"
                type="category"
                width={152}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: string) => truncate(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => {
                      const datum = item.payload as { revenueLabel: string; orders: number };
                      return (
                        <div className="flex flex-1 justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">
                            {by === "quantity" ? "Quantity" : "Revenue"} ·{" "}
                            {datum.orders} orders
                          </span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {by === "quantity"
                              ? Number(value).toLocaleString()
                              : datum.revenueLabel}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey={chartKey} fill="var(--color-value)" radius={4} barSize={16} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  }

  if (report === "guest-history") {
    const series = guestHistorySeries(rows, limit ?? 10);
    if (!series.length) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={SINGLE_BAR_CONFIG("Lifetime expenditure", "var(--color-chart-1)")}
            className="aspect-auto h-64 w-full"
          >
            <BarChart data={series} layout="vertical" margin={{ left: 4, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => compactMoney(value)}
              />
              <YAxis
                dataKey="guest"
                type="category"
                width={152}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: string) => truncate(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(_value, _name, item) => {
                      const datum = item.payload as {
                        expenditureLabel: string;
                        stays: number;
                      };
                      return (
                        <div className="flex flex-1 justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">
                            {datum.stays} stay{datum.stays === 1 ? "" : "s"}
                          </span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {datum.expenditureLabel}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="expenditure" fill="var(--color-value)" radius={4} barSize={16} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  }

  return null;
}
