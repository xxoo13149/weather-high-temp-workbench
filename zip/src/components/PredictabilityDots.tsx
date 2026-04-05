export const PredictabilityDots = ({
  score,
  label,
}: {
  score: number | null;
  label: string;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full border transition ${
            score !== null && index <= score
              ? "border-[rgba(138,240,194,0.8)] bg-[var(--success)] shadow-[0_0_0_4px_rgba(138,240,194,0.08)]"
              : "border-white/14 bg-white/6"
          }`}
        />
      ))}
    </div>
    <span className="text-sm text-white/62">{label}</span>
  </div>
);
