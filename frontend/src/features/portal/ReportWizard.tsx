import { forwardRef, useCallback, useEffect, useId, useRef, useState } from "react";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Send } from "lucide-react";
import { Button, Card } from "../../components/ui";
import { useCreateTicket } from "../../lib/queries";
import { cn, nowForDatetimeLocal } from "../../lib/format";
import { PROBLEM_META } from "../../lib/labels";
import { PROBLEM_TYPES, type TicketCreateResponse } from "../../types";
import { describe, Field, FieldMessage, inputCls } from "./form";
import { LocationPicker, type Coords } from "./LocationPicker";
import { TicketSuccess } from "./TicketSuccess";

const MAX_DESC = 300;

const schema = z.object({
  user_id: z
    .string()
    .trim()
    .min(1, "Ingresa tu número de documento.")
    .regex(/^[A-Za-z0-9-]{4,20}$/, "Usa de 4 a 20 letras, números o guiones."),
  service_number: z
    .string()
    .trim()
    .min(1, "Ingresa tu número de servicio.")
    .regex(/^\d{6,12}$/, "Debe tener solo números (de 6 a 12 dígitos)."),
  // email y phone son opcionales en TicketCreateRequest: se validan solo si se completan
  email: z.union([z.literal(""), z.string().trim().email("Revisa el correo: debe verse como nombre@dominio.com.")]),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^9\d{8}$/, "Ingresa 9 dígitos; los celulares en Perú empiezan con 9.")])),
  coords: z
    .object({ lat: z.number(), lon: z.number() })
    .nullable()
    .refine((v): boolean => v !== null, "Marca en el mapa dónde ocurre el problema o usa tu ubicación.")
    .refine((v) => !v || (Math.abs(v.lat) <= 90 && Math.abs(v.lon) <= 180), "La ubicación no es válida."),
  location_text: z.string().trim().min(5, "Escribe una dirección o referencia (mínimo 5 caracteres).").max(160, "Máximo 160 caracteres."),
  problem_type: z.enum(PROBLEM_TYPES, { errorMap: () => ({ message: "Elige el tipo de problema." }) }),
  incident_time: z
    .string()
    .min(1, "Indica cuándo empezó el problema.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "La fecha no es válida.")
    .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, "La fecha no puede estar en el futuro.")
    .refine((v) => Date.parse(v) >= Date.now() - 30 * 86_400_000, "Solo puedes reportar problemas de los últimos 30 días."),
  description: z.string().trim().min(10, "Cuéntanos un poco más (mínimo 10 caracteres).").max(MAX_DESC, `Máximo ${MAX_DESC} caracteres.`),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

interface Step {
  title: string;
  subtitle: string;
  fields: FieldPath<FormInput>[];
}
const STEPS: readonly [Step, Step, Step] = [
  { title: "Servicio", subtitle: "Tus datos para identificar la línea y avisarte", fields: ["user_id", "service_number", "email", "phone"] },
  { title: "Ubicación", subtitle: "Dónde ocurre el problema", fields: ["coords", "location_text"] },
  { title: "Detalle", subtitle: "Qué pasa y desde cuándo", fields: ["problem_type", "incident_time", "description"] },
];

const DEFAULTS: Partial<FormInput> = { phone: "", coords: null, location_text: "", description: "", incident_time: "" };

export const ReportWizard = forwardRef<HTMLHeadingElement>(function ReportWizard(_props, titleRef) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const create = useCreateTicket();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<{ res: TicketCreateResponse; email: string } | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const {
    register,
    control,
    handleSubmit,
    trigger,
    setValue,
    getValues,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { ...DEFAULTS, incident_time: nowForDatetimeLocal() },
  });

  // Al cambiar de paso, el foco va al título del paso (lectores de pantalla y teclado)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const next = async () => {
    const ok = await trigger(STEPS[step]?.fields ?? [], { shouldFocus: true });
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const onSubmit = (v: FormOutput) => {
    if (!v.coords) return;
    create.mutate(
      {
        user_id: v.user_id,
        service_number: v.service_number,
        ...(v.email ? { email: v.email } : {}),
        ...(v.phone ? { phone: `+51${v.phone}` } : {}),
        location_text: v.location_text,
        lat: Number(v.coords.lat.toFixed(6)),
        lon: Number(v.coords.lon.toFixed(6)),
        problem_type: v.problem_type,
        description: v.description,
        // datetime-local (hora local del navegador) → ISO 8601 en UTC
        incident_time: new Date(v.incident_time).toISOString(),
      },
      { onSuccess: (res) => setDone({ res, email: v.email }) },
    );
  };

  // Si el usuario intenta enviar con errores de pasos anteriores, lo llevamos al primero con error
  const onInvalid = (errs: Partial<Record<string, unknown>>) => {
    const target = STEPS.findIndex((s) => s.fields.some((f) => f in errs));
    if (target >= 0 && target !== step) setStep(target);
  };

  const setCoords = useCallback((c: Coords) => setValue("coords", c, { shouldValidate: true, shouldDirty: true }), [setValue]);

  const restart = () => {
    const { user_id, service_number, email, phone } = getValues();
    reset({ ...DEFAULTS, user_id, service_number, email, phone, incident_time: nowForDatetimeLocal() });
    create.reset();
    setDone(null);
    setStep(0);
  };

  const desc = watch("description") ?? "";
  const problem = watch("problem_type");
  const progress = ((step + 1) / STEPS.length) * 100;
  const current = STEPS[step] ?? STEPS[0];

  if (done) return <TicketSuccess result={done.res} email={done.email} onRestart={restart} />;

  return (
    <Card className="overflow-hidden rounded-xl" aria-labelledby={id("title")}>
      {/* Progreso */}
      <div className="border-b border-line/8 px-5 pb-4 pt-5 sm:px-7">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={id("title")} ref={titleRef} tabIndex={-1} className="text-lg font-semibold tracking-tight text-fg focus:outline-none">
            Reportar un problema
          </h2>
          <span className="num shrink-0 text-sm text-fg-subtle">
            Paso {step + 1} de {STEPS.length}
          </span>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Progreso del reporte"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Paso ${step + 1} de ${STEPS.length}: ${current.title}`}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "current" : "todo";
            return (
              <li key={s.title}>
                <button
                  type="button"
                  disabled={i >= step}
                  onClick={() => setStep(i)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md text-left text-sm transition-colors disabled:cursor-default",
                    state === "current" ? "font-semibold text-fg" : state === "done" ? "text-fg-muted hover:text-accent" : "text-fg-subtle",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors",
                      state === "done" && "border-accent bg-accent text-accent-fg",
                      state === "current" && "border-accent text-accent",
                      state === "todo" && "border-line/25 text-fg-subtle",
                    )}
                    aria-hidden
                  >
                    {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="num">{i + 1}</span>}
                  </span>
                  <span className="truncate">{s.title}</span>
                  {state === "done" && <span className="sr-only">(completado, volver a este paso)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          // Enter en un paso intermedio avanza en lugar de enviar
          if (step < STEPS.length - 1) {
            e.preventDefault();
            void next();
          } else void handleSubmit(onSubmit, onInvalid)(e);
        }}
      >
        <section key={step} className="animate-page-in scroll-mt-24 px-5 py-6 sm:px-7" aria-labelledby={id("step")}>
          <h3 id={id("step")} ref={stepHeading} tabIndex={-1} className="text-md font-semibold text-fg focus:outline-none">
            {current.title}
          </h3>
          <p className="mb-5 text-sm text-fg-muted">{current.subtitle}</p>

          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id={id("user_id")} label="N.° de documento" error={errors.user_id?.message} hint="DNI o carné de extranjería del titular.">
                <input {...register("user_id")} {...describe(id("user_id"), errors.user_id?.message, true)} autoComplete="off" placeholder="DNI-70451289" className={inputCls(!!errors.user_id)} />
              </Field>
              <Field id={id("service_number")} label="N.° de servicio" error={errors.service_number?.message} hint="Figura en tu recibo.">
                <input
                  {...register("service_number")}
                  {...describe(id("service_number"), errors.service_number?.message, true)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="1023456789"
                  className={inputCls(!!errors.service_number, "num")}
                />
              </Field>
              <Field id={id("email")} label="Correo electrónico" optional error={errors.email?.message} hint="Para avisarte de cada cambio de estado." className="sm:col-span-2">
                <input {...register("email")} {...describe(id("email"), errors.email?.message, true)} type="email" autoComplete="email" placeholder="nombre@correo.com" className={inputCls(!!errors.email)} />
              </Field>
              <Field id={id("phone")} label="Celular" optional error={errors.phone?.message} hint="Te enviaremos un SMS cuando se restablezca el servicio." className="sm:col-span-2">
                <div
                  className={cn(
                    "flex h-11 overflow-hidden rounded-lg border bg-surface-1 transition-colors focus-within:ring-4",
                    errors.phone ? "border-danger/70 focus-within:ring-danger/15" : "border-line/20 hover:border-line/35 focus-within:border-accent focus-within:ring-accent/15",
                  )}
                >
                  <span className="num grid select-none place-items-center border-r border-line/15 bg-surface-2 px-3 text-md text-fg-muted" aria-hidden>
                    +51
                  </span>
                  <input
                    {...register("phone")}
                    {...describe(id("phone"), errors.phone?.message, true)}
                    aria-label="Celular, sin el código de país +51"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={11}
                    placeholder="999 111 222"
                    className="num min-w-0 flex-1 bg-transparent px-3 text-md text-fg placeholder:text-fg-subtle/80 focus:outline-none"
                  />
                </div>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="mb-1.5 text-base font-medium text-fg" id={id("coords-label")}>
                  Punto en el mapa
                </p>
                <Controller
                  control={control}
                  name="coords"
                  render={({ field }) => (
                    <LocationPicker
                      value={field.value ?? null}
                      onChange={setCoords}
                      onZone={(name) => setValue("location_text", name, { shouldValidate: true })}
                      error={errors.coords?.message}
                      describedBy={errors.coords ? `${id("coords")}-err` : undefined}
                    />
                  )}
                />
                <FieldMessage id={id("coords")} error={errors.coords?.message} />
              </div>
              <Field id={id("location_text")} label="Dirección o referencia" error={errors.location_text?.message} hint="Ej.: frente al Hospital Loayza, cuadra 8 de Av. Alfonso Ugarte.">
                <input {...register("location_text")} {...describe(id("location_text"), errors.location_text?.message, true)} autoComplete="street-address" placeholder="Calle, número, distrito o una referencia cercana" className={inputCls(!!errors.location_text)} />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <fieldset aria-describedby={errors.problem_type ? `${id("problem_type")}-err` : undefined}>
                <legend className="mb-2 text-base font-medium text-fg">Tipo de problema</legend>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {PROBLEM_TYPES.map((t) => {
                    const m = PROBLEM_META[t];
                    const Icon = m.icon;
                    const on = problem === t;
                    return (
                      <label
                        key={t}
                        className={cn(
                          "relative flex min-h-[84px] cursor-pointer flex-col justify-between gap-3 rounded-lg border p-3.5 text-base font-medium transition-all duration-150",
                          "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/25",
                          on ? "border-accent bg-accent/8 text-fg shadow-[0_0_0_1px_rgb(var(--accent))]" : "border-line/15 bg-surface-1 text-fg-muted hover:border-line/35 hover:text-fg",
                          errors.problem_type && !problem && "border-danger/50",
                        )}
                      >
                        <input type="radio" value={t} {...register("problem_type")} className="sr-only" />
                        <span className={cn("grid h-9 w-9 place-items-center rounded-lg transition-colors", on ? "bg-accent text-accent-fg" : "bg-surface-3 text-fg-muted")}>
                          <Icon className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        {m.label}
                        {on && <Check className="absolute right-3 top-3 h-4 w-4 text-accent" strokeWidth={3} aria-hidden />}
                      </label>
                    );
                  })}
                </div>
                <FieldMessage id={id("problem_type")} error={errors.problem_type?.message} />
              </fieldset>

              <Field id={id("incident_time")} label="¿Desde cuándo?" error={errors.incident_time?.message} hint="Fecha y hora aproximada en que empezó.">
                <input {...register("incident_time")} {...describe(id("incident_time"), errors.incident_time?.message, true)} type="datetime-local" max={nowForDatetimeLocal()} className={inputCls(!!errors.incident_time, "num sm:max-w-xs")} />
              </Field>

              <div>
                <label htmlFor={id("description")} className="mb-1.5 block text-base font-medium text-fg">
                  Descripción
                </label>
                <textarea
                  {...register("description")}
                  {...describe(id("description"), errors.description?.message)}
                  rows={4}
                  maxLength={MAX_DESC}
                  placeholder="Ej.: Desde la mañana no tengo internet en casa y el módem muestra la luz roja."
                  className={inputCls(!!errors.description, "h-auto resize-none py-2.5 leading-6")}
                />
                <div className="mt-1.5 flex items-start gap-3">
                  <div className="flex-1">
                    <FieldMessage id={id("description")} error={errors.description?.message} />
                  </div>
                  <span className={cn("num shrink-0 text-sm", desc.length >= MAX_DESC ? "text-danger" : desc.length > MAX_DESC - 30 ? "text-warn" : "text-fg-subtle")} aria-live="polite" aria-atomic>
                    {desc.length}/{MAX_DESC}
                  </span>
                </div>
              </div>

              {create.isError && (
                <div role="alert" className="flex gap-3 rounded-lg border border-danger/30 bg-danger/6 p-4 text-sm">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                  <div>
                    <p className="font-semibold text-fg">No pudimos enviar tu reporte</p>
                    <p className="mt-0.5 text-fg-muted">{create.error.message} Tus datos siguen aquí; vuelve a intentarlo.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex items-center gap-3 border-t border-line/8 bg-surface-2/60 px-5 py-4 sm:px-7">
          {step > 0 && (
            <Button variant="ghost" size="lg" onClick={back} disabled={create.isPending} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Atrás
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button key="next" variant="primary" size="lg" onClick={() => void next()} className="ml-auto">
              Continuar <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button key="submit" type="submit" variant="primary" size="lg" loading={create.isPending} icon={<Send className="h-4 w-4" aria-hidden />} className="ml-auto">
              {create.isPending ? "Enviando…" : "Enviar reporte"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
});
