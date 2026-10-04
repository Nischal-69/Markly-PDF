import { Icon, type IconName } from "@/components/icons/Icon";
import { MARKUP_COLORS, MARKUP_STROKES } from "@/lib/annotations/markupTypes";
import { usePdfStore } from "@/state/pdfStore";
import { useMarkupUi, type MarkupTool } from "@/state/markupUi";

const TOOLS: Array<{ id: MarkupTool; label: string; icon: IconName }> = [
  { id: "select", label: "Select", icon: "cursor" },
  { id: "underline", label: "Underline", icon: "underline" },
  { id: "strike", label: "Strikethrough", icon: "strike" },
  { id: "freehand", label: "Freehand drawing", icon: "pen" },
  { id: "rect", label: "Rectangle", icon: "rect" },
  { id: "ellipse", label: "Circle", icon: "ellipse" },
  { id: "arrow", label: "Arrow", icon: "arrow" },
  { id: "text", label: "Text annotation", icon: "textAnnot" },
];

/**
 * Batch 6 annotation toolbar: slim in-flow strip under the top toolbar,
 * visible only in the viewer. Picking a text tool (underline /
 * strikethrough) applies it to the next text selection; picking a draw
 * tool arms pointer drawing on the pages; Select returns to normal
 * reading/selection.
 */
export function MarkupToolbar() {
  const screen = usePdfStore((s) => s.screen);
  const tool = useMarkupUi((s) => s.tool);
  const color = useMarkupUi((s) => s.color);
  const stroke = useMarkupUi((s) => s.stroke);
  const setTool = useMarkupUi((s) => s.setTool);
  const setColor = useMarkupUi((s) => s.setColor);
  const setStroke = useMarkupUi((s) => s.setStroke);

  if (screen !== "viewer") return null;

  const needsStroke = tool !== "select" && tool !== "text";

  return (
    <div className="markup-bar" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`markup-tool${tool === t.id ? " is-active" : ""}`}
          onClick={() => setTool(t.id)}
          title={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
        >
          <Icon name={t.icon} size={15} />
        </button>
      ))}
      <span className="markup-sep" aria-hidden="true" />
      {MARKUP_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`markup-dot${color === c.swatch ? " is-active" : ""}`}
          style={{ backgroundColor: c.swatch }}
          title={`Annotation color ${c.label}`}
          aria-label={`Annotation color ${c.label}`}
          aria-pressed={color === c.swatch}
          onClick={() => setColor(c.swatch)}
        />
      ))}
      {needsStroke && (
        <select
          className="markup-width"
          value={String(stroke)}
          onChange={(e) => setStroke(Number(e.target.value))}
          aria-label="Annotation line thickness"
          title="Line thickness"
        >
          {MARKUP_STROKES.map((w) => (
            <option key={w} value={String(w)}>
              {w === 1.5 ? "Thin" : w === 2.5 ? "Medium" : "Thick"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
