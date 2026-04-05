export const MetricTile = ({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "neutral" | "accent" | "warning" | "success";
}) => {
  const toneMap = {
    neutral: "from-white/[0.06] to-white/[0.02] text-white",
    accent: "from-[rgba(56,214,180,0.16)] to-[rgba(56,214,180,0.03)] text-white",
    warning: "from-[rgba(242,183,109,0.18)] to-[rgba(242,183,109,0.04)] text-white",
    success: "from-[rgba(138,240,194,0.15)] to-[rgba(138,240,194,0.03)] text-white",
  } as const;

  return (
    <div className={`relative overflow-hidden rounded-[22px] border border-white/8 bg-gradient-to-b p-3.5 ${toneMap[tone]}`}>
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/60 to-transparent opacity-60" />
      <div className="eyebrow">{label}</div>
      <div className="data-mono mt-2 text-[1.65rem] font-semibold leading-none">{value}</div>
      {caption ? <div className="mt-1.5 text-[11px] leading-5 text-white/58">{caption}</div> : null}
    </div>
  );
};
