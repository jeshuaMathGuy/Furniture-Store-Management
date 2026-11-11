/**
 * Flat architectural elevations used as 2D product illustrations until the 3D
 * viewer (Stage 3) and licensed imagery exist. They are drawn, not photographed.
 */
const MATERIAL_TONE: Record<string, string> = {
  oak: "#C8A27A", walnut: "#6B4E3D", cedar: "#B5835A", ash: "#D8C3A0", sheesham: "#8C5A3C",
  "solid wood": "#A9784F", "steel & oak": "#B9976F", fabric: "#D9C7B5", linen: "#E3D8C6", "bouclé": "#EFE9DE",
  wool: "#A8B09D", rattan: "#C9A86E", travertine: "#E2D3BC", marble: "#ECE7DF", mesh: "#4A4D46",
  steel: "#7D807A", aluminium: "#B9BCB6",
};

export function toneFor(material: string | null | undefined): string {
  return MATERIAL_TONE[(material ?? "").toLowerCase()] ?? "#D9C7B5";
}

type Shape = (t: string, d: string) => React.ReactNode;
const leg = (x: number, y: number, h: number, d: string, w = 3) => <rect x={x} y={y} width={w} height={h} rx={1} fill={d} />;

const SHAPES: Record<string, Shape> = {
  desk: (t, d) => (<>
    <rect x={30} y={62} width={140} height={8} rx={2} fill={t} />
    {leg(38, 70, 50, d)}{leg(159, 70, 50, d)}
    <rect x={120} y={70} width={36} height={22} rx={2} fill={t} opacity={0.75} />
  </>),
  chair: (t, d) => (<>
    <rect x={78} y={30} width={44} height={46} rx={10} fill={t} />
    <rect x={72} y={74} width={56} height={10} rx={4} fill={t} />
    {leg(78, 84, 36, d)}{leg(119, 84, 36, d)}
  </>),
  sofa: (t, d) => (<>
    <rect x={22} y={52} width={156} height={34} rx={12} fill={t} />
    <rect x={16} y={70} width={22} height={34} rx={8} fill={t} />
    <rect x={162} y={70} width={22} height={34} rx={8} fill={t} />
    <rect x={34} y={78} width={132} height={22} rx={6} fill={t} opacity={0.85} />
    <line x1={100} y1={80} x2={100} y2={100} stroke={d} strokeOpacity={0.25} />
    {leg(30, 104, 16, d, 4)}{leg(166, 104, 16, d, 4)}
  </>),
  table: (t, d) => (<>
    <rect x={20} y={64} width={160} height={9} rx={2} fill={t} />
    {leg(32, 73, 47, d, 5)}{leg(163, 73, 47, d, 5)}
  </>),
  sideboard: (t, d) => (<>
    <rect x={26} y={50} width={148} height={56} rx={3} fill={t} />
    {[0, 1, 2, 3].map((i) => <line key={i} x1={63 + i * 37} y1={54} x2={63 + i * 37} y2={102} stroke={d} strokeOpacity={i === 3 ? 0 : 0.3} />)}
    {leg(36, 106, 14, d)}{leg(161, 106, 14, d)}
  </>),
  bookcase: (t, d) => (<>
    <rect x={64} y={10} width={72} height={110} rx={2} fill="none" stroke={t} strokeWidth={5} />
    {[0, 1, 2, 3].map((i) => <rect key={i} x={66} y={32 + i * 22} width={68} height={3} fill={t} />)}
    <rect x={74} y={22} width={6} height={10} fill={d} opacity={0.5} /><rect x={84} y={44} width={14} height={10} fill={d} opacity={0.35} />
  </>),
  bed: (t, d) => (<>
    <rect x={24} y={40} width={16} height={68} rx={4} fill={t} />
    <rect x={40} y={78} width={140} height={22} rx={4} fill={t} />
    <rect x={44} y={68} width={130} height={14} rx={6} fill="#F5F1E9" stroke={d} strokeOpacity={0.15} />
    {leg(44, 100, 18, d, 4)}{leg(172, 100, 18, d, 4)}
  </>),
  lounge_chair: (t) => (<>
    <path d="M62 104 C56 60 70 34 100 34 C130 34 144 60 138 104 Z" fill={t} />
    <ellipse cx={100} cy={96} rx={44} ry={12} fill={t} stroke="#373A34" strokeOpacity={0.12} />
  </>),
  coffee_table: (t, d) => (<>
    <rect x={36} y={78} width={128} height={12} rx={6} fill={t} />
    <rect x={62} y={90} width={26} height={30} rx={3} fill={t} />
    <rect x={112} y={90} width={26} height={30} rx={3} fill={t} />
    <line x1={36} y1={84} x2={164} y2={84} stroke={d} strokeOpacity={0.15} />
  </>),
  bench: (t, d) => (<>
    <rect x={30} y={84} width={140} height={8} rx={2} fill={t} />
    {leg(40, 92, 28, d, 5)}{leg(155, 92, 28, d, 5)}
  </>),
  armchair: (t, d) => (<>
    <path d="M60 30 h80 v50 h-80 Z" fill={t} />
    <path d="M52 40 q8 -8 16 0 v44 h-16 Z M132 40 q8 -8 16 0 v44 h-16 Z" fill={t} />
    <rect x={56} y={80} width={88} height={20} rx={4} fill={t} opacity={0.85} />
    {leg(62, 100, 20, d)}{leg(135, 100, 20, d)}
  </>),
  nightstand: (t, d) => (<>
    <rect x={72} y={60} width={56} height={44} rx={4} fill={t} />
    <line x1={76} y1={74} x2={124} y2={74} stroke={d} strokeOpacity={0.3} />
    {leg(78, 104, 16, d)}{leg(119, 104, 16, d)}
  </>),
  chest: (t, d) => (<>
    <rect x={50} y={36} width={100} height={76} rx={3} fill={t} />
    {[0, 1, 2].map((i) => <g key={i}><line x1={54} y1={60 + i * 18} x2={146} y2={60 + i * 18} stroke={d} strokeOpacity={0.3} /><rect x={96} y={47 + i * 18} width={8} height={2} fill="#B08D57" /></g>)}
    {leg(56, 112, 8, d)}{leg(141, 112, 8, d)}
  </>),
  credenza: (t, d) => (<>
    <rect x={30} y={58} width={140} height={52} rx={2} fill={t} />
    <line x1={100} y1={62} x2={100} y2={106} stroke={d} strokeOpacity={0.3} />
    <rect x={56} y={80} width={18} height={2} fill={d} opacity={0.6} /><rect x={126} y={80} width={18} height={2} fill={d} opacity={0.6} />
    {leg(34, 110, 10, d)}{leg(163, 110, 10, d)}
  </>),
  side_table: (t, d) => (<>
    <rect x={76} y={84} width={48} height={6} rx={2} fill={t} />
    {leg(98, 30, 90, d)}
    <path d="M86 18 h28 l-6 14 h-16 Z" fill="#B08D57" />
    {leg(84, 90, 30, d)}{leg(113, 90, 30, d)}
  </>),
  shelving: (t, d) => (<>
    {[0, 1, 2, 3].map((i) => <rect key={i} x={36} y={26 + i * 24} width={128} height={4} rx={1} fill={t} />)}
    {leg(36, 20, 100, d)}{leg(161, 20, 100, d)}{leg(98, 20, 100, d, 2)}
  </>),
};

export function FurnitureGlyph({ modelKey, material, color, label, className }: {
  modelKey: string | null; material?: string | null; color?: string; label: string; className?: string;
}) {
  const tone = color ?? toneFor(material);
  const shape = SHAPES[modelKey ?? ""] ?? SHAPES.table!;
  return (
    <svg viewBox="0 0 200 140" role="img" aria-label={`Illustration of ${label}`} className={className}>
      <ellipse cx={100} cy={122} rx={78} ry={5} fill="#373A34" opacity={0.08} />
      {/* A hairline outline keeps pale finishes (linen, bouclé, marble) legible on limestone. */}
      <g stroke="#373A34" strokeOpacity={0.28} strokeWidth={0.9} strokeLinejoin="round">{shape(tone, "#373A34")}</g>
    </svg>
  );
}
