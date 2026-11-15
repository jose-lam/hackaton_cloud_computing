// Gráficos Recharts con tema propio: ejes y grilla recesivos, tooltips cuidados, colores fijos por categoría.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { formatHour, formatNumber } from "../../lib/format";
import { problemLabel } from "../../lib/labels";
import type { AnalyticsSummary, TrendPoint } from "../../types";

const AXIS = { fill: "#7a8aa0", fontSize: 11, fontFamily: '"JetBrains Mono Variable", monospace' };
const GRID = "rgba(148,170,200,0.08)";
const ACCENT = "#2dd4bf";

// Paleta categórica validada (modo oscuro); el color sigue a la categoría, no al ranking.
export const TYPE_COLORS: Record<string, string> = {
  SIN_INTERNET: "#3987e5",
  SIN_SENAL: "#d95926",
  INTERNET_LENTO: "#199e70",
  FALLA_LLAMADAS: "#c98500",
  OTRO: "#d55181",
};

function ChartTooltip({ active, payload, label, unit, labelFormatter }: TooltipProps<number, string> & { unit: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-md border border-line/15 bg-surface-2 px-3 py-2 shadow-pop">
      {label !== undefined && <p className="mb-1 text-xs font-medium text-fg-muted">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: (p.payload as { fill?: string })?.fill ?? p.color ?? ACCENT }} aria-hidden />
          <span className="flex-1 text-fg-muted">{p.name}</span>
          <span className="num font-semibold text-fg">
            {formatNumber(Number(p.value))} <span className="text-xs font-normal text-fg-subtle">{unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="1" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="ts" tickFormatter={(v: string) => formatHour(v)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<ChartTooltip unit="reportes" labelFormatter={(l) => `Hora ${formatHour(l)}`} />} cursor={{ stroke: "rgba(148,170,200,0.35)", strokeWidth: 1 }} />
        <Area type="monotone" dataKey="reports" name="Reportes" stroke={ACCENT} strokeWidth={2} fill="url(#trendFill)" activeDot={{ r: 4, stroke: "#0d131b", strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Etiqueta de eje en una sola línea (Recharts parte el texto en varias por defecto). */
function ZoneTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#a0afc2" fontSize={12} fontFamily='"Inter Variable", sans-serif'>
      {payload?.value}
    </text>
  );
}

export function TopZonesChart({ data }: { data: AnalyticsSummary["top_zones"] }) {
  const rows = data.slice(0, 6).map((z) => ({ ...z, short: z.zone_name.length > 26 ? `${z.zone_name.slice(0, 25)}…` : z.zone_name }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, bottom: 0, left: 0 }} barCategoryGap={8}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="short" width={200} tick={<ZoneTick />} axisLine={false} tickLine={false} interval={0} />
        <Tooltip content={<ChartTooltip unit="incidencias" />} cursor={{ fill: "rgba(148,170,200,0.06)" }} labelFormatter={(_, p) => String((p?.[0]?.payload as { zone_name?: string })?.zone_name ?? "")} />
        <Bar dataKey="incident_count" name="Incidencias" fill={ACCENT} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} label={{ position: "right", fill: "#a0afc2", fontSize: 11, fontFamily: AXIS.fontFamily }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProblemTypesChart({ data }: { data: AnalyticsSummary["top_problem_types"] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const rows = data.map((d) => ({ name: problemLabel(d.problem_type), value: d.count, fill: TYPE_COLORS[d.problem_type] ?? "#64748b" }));
  return (
    <div className="flex h-full items-center gap-6">
      <div className="relative h-full min-h-[180px] w-[46%] min-w-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="#0d131b" strokeWidth={2} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.name} fill={r.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip unit="reportes" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-2xl font-semibold text-fg">{formatNumber(total)}</p>
            <p className="text-2xs uppercase tracking-[0.1em] text-fg-subtle">reportes</p>
          </div>
        </div>
      </div>
      {/* Leyenda con etiquetas, valores y % (identidad nunca solo por color) */}
      <ul className="flex-1 space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.fill }} aria-hidden />
            <span className="flex-1 truncate text-fg-muted">{r.name}</span>
            <span className="num font-semibold text-fg">{r.value}</span>
            <span className="num w-10 text-right text-xs text-fg-subtle">{Math.round((r.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
