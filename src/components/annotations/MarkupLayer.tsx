import { memo } from "react";
import { useShallow } from "zustand/shallow";
import type {
  ArrowMarkup,
  FreehandMarkup,
  Markup,
} from "@/lib/annotations/markupTypes";
import { useMarkupStore } from "@/state/markupStore";
import { useMarkupUi, type MarkupDraft } from "@/state/markupUi";

interface MarkupLayerProps {
  pageNumber: number;
  /** Current zoom — geometry is stored scale-free and projected here. */
  scale: number;
}

/**
 * Batch 6 layer: freeform annotations (underline, strikethrough, shapes,
 * arrows, freehand, text). Mounted inside the per-page annotation slot,
 * so markups scroll with their page and scale with zoom by construction.
 * The PDF pixels and text layer are never touched.
 */
export const MarkupLayer = memo(function MarkupLayer({
  pageNumber,
  scale,
}: MarkupLayerProps) {
  const markups = useMarkupStore(
    useShallow((s) => s.markups.filter((m) => m.page === pageNumber)),
  );
  const tool = useMarkupUi((s) => s.tool);
  const draft = useMarkupUi((s) => s.draft);
  const draftColor = useMarkupUi((s) => s.color);
  const draftStroke = useMarkupUi((s) => s.stroke);
  const select = useMarkupUi((s) => s.select);
  const selectedId = useMarkupUi((s) => s.selectedId);

  if (markups.length === 0 && (!draft || draft.page !== pageNumber)) {
    return null;
  }

  // Shape/text containers only intercept the pointer in select mode so
  // drawing a new markup always reaches the viewer handlers. Underlines
  // and strikethroughs never intercept (they sit on text) and are
  // selected through the viewer's geometric hit test instead.
  const interactive = tool === "select";

  const handlePick = (e: React.MouseEvent, id: string) => {
    if (!interactive) return;
    e.stopPropagation();
    select(id, { x: e.clientX, y: e.clientY });
  };

  const handleDown = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
  };

  return (
    <>
      {markups.map((m) => (
        <MarkupShape
          key={m.id}
          markup={m}
          scale={scale}
          interactive={interactive}
          selected={m.id === selectedId}
          onPick={handlePick}
          onDown={handleDown}
        />
      ))}
      {draft && draft.page === pageNumber && (
        <MarkupDraftShape draft={draft} scale={scale} color={draftColor} stroke={draftStroke} />
      )}
    </>
  );
});

function MarkupShape({
  markup: m,
  scale,
  interactive,
  selected,
  onPick,
  onDown,
}: {
  markup: Markup;
  scale: number;
  interactive: boolean;
  selected: boolean;
  onPick: (e: React.MouseEvent, id: string) => void;
  onDown: (e: React.MouseEvent) => void;
}) {
  switch (m.kind) {
    case "underline":
      return (
        <>
          {m.quads.map((q, i) => (
            <div
              key={`${m.id}:${i}`}
              className="mk mk-underline"
              data-markup-id={m.id}
              data-markup-kind="underline"
              style={{
                left: q.left * scale,
                top: q.top * scale,
                width: q.width * scale,
                height: q.height * scale,
                color: m.color,
              }}
            >
              <div
                className="mk-underline-line"
                style={{ borderBottomWidth: Math.max(1, m.stroke * scale) }}
              />
            </div>
          ))}
        </>
      );
    case "strike":
      return (
        <>
          {m.quads.map((q, i) => (
            <div
              key={`${m.id}:${i}`}
              className="mk mk-strike"
              data-markup-id={m.id}
              data-markup-kind="strike"
              style={{
                left: q.left * scale,
                top: q.top * scale,
                width: q.width * scale,
                height: q.height * scale,
                color: m.color,
              }}
            >
              <div
                className="mk-strike-line"
                style={{ height: Math.max(1, m.stroke * scale) }}
              />
            </div>
          ))}
        </>
      );
    case "rect":
    case "ellipse": {
      const border = m.kind === "rect" ? "mk-rect-border" : "mk-ellipse-border";
      return (
        <div
          className={`mk mk-shape${selected ? " is-selected" : ""}`}
          data-markup-id={m.id}
          data-markup-kind={m.kind}
          role="button"
          tabIndex={interactive ? 0 : -1}
          aria-label={`${m.kind === "rect" ? "Rectangle" : "Circle"} annotation`}
          onMouseDown={onDown}
          onClick={(e) => onPick(e, m.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(e as unknown as React.MouseEvent, m.id);
            }
          }}
          style={{
            left: m.x * scale,
            top: m.y * scale,
            width: m.w * scale,
            height: m.h * scale,
            pointerEvents: interactive ? "auto" : "none",
          }}
        >
          <div
            className={m.kind === "rect" ? "mk-rect" : "mk-ellipse"}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            aria-hidden="true"
          >
            <div
              className={border}
              style={{ borderColor: m.color, borderWidth: Math.max(1, m.stroke * scale) }}
            />
          </div>
        </div>
      );
    }
    case "text":
      return (
        <div
          className={`mk mk-text-card${selected ? " is-selected" : ""}`}
          data-markup-id={m.id}
          data-markup-kind="text"
          role="button"
          tabIndex={interactive ? 0 : -1}
          aria-label="Text annotation"
          onMouseDown={onDown}
          onClick={(e) => onPick(e, m.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(e as unknown as React.MouseEvent, m.id);
            }
          }}
          style={{
            left: m.x * scale,
            top: m.y * scale,
            maxWidth: 240 * scale,
            fontSize: m.fontSize * scale,
            borderLeftColor: m.color,
            pointerEvents: interactive ? "auto" : "none",
          }}
        >
          {m.text}
        </div>
      );
    case "freehand":
      return (
        <FreehandSvg
          markup={m}
          scale={scale}
          interactive={interactive}
          selected={selected}
          onPick={onPick}
          onDown={onDown}
        />
      );
    case "arrow":
      return (
        <ArrowSvg
          markup={m}
          scale={scale}
          interactive={interactive}
          selected={selected}
          onPick={onPick}
          onDown={onDown}
        />
      );
  }
}

function svgBox(xs: number[], ys: number[], pad: number) {
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function FreehandSvg({
  markup: m,
  scale,
  interactive,
  selected,
  onPick,
  onDown,
}: {
  markup: FreehandMarkup;
  scale: number;
  interactive: boolean;
  selected: boolean;
  onPick: (e: React.MouseEvent, id: string) => void;
  onDown: (e: React.MouseEvent) => void;
}) {
  const pts = m.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  if (pts.length < 2) return null;
  const pad = 16;
  const box = svgBox(
    pts.map((p) => p.x),
    pts.map((p) => p.y),
    pad,
  );
  const rel = pts.map((p) => `${p.x - box.minX},${p.y - box.minY}`).join(" ");
  const width = Math.max(1, m.stroke * scale);
  return (
    <svg
      className="mk mk-svg"
      data-markup-id={m.id}
      data-markup-kind="freehand"
      aria-label="Freehand annotation"
      style={{
        left: box.minX,
        top: box.minY,
        width: box.w,
        height: box.h,
        outline: selected ? "2px dashed var(--accent)" : undefined,
        outlineOffset: 2,
      }}
    >
      <polyline
        points={rel}
        fill="none"
        stroke={m.color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <polyline
        className="mk-hit"
        points={rel}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(14, width + 8)}
        style={{ pointerEvents: interactive ? "stroke" : "none" }}
        onMouseDown={onDown}
        onClick={(e) => onPick(e, m.id)}
      />
    </svg>
  );
}

function ArrowSvg({
  markup: m,
  scale,
  interactive,
  selected,
  onPick,
  onDown,
}: {
  markup: ArrowMarkup;
  scale: number;
  interactive: boolean;
  selected: boolean;
  onPick: (e: React.MouseEvent, id: string) => void;
  onDown: (e: React.MouseEvent) => void;
}) {
  const x1 = m.x1 * scale;
  const y1 = m.y1 * scale;
  const x2 = m.x2 * scale;
  const y2 = m.y2 * scale;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const width = Math.max(1, m.stroke * scale);
  const ux = dx / len;
  const uy = dy / len;
  const headLen = 10 + width * 2.2;
  const headW = 7 + width * 1.8;
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  const corners = `${x2},${y2} ${bx - uy * headW * 0.5},${by + ux * headW * 0.5} ${bx + uy * headW * 0.5},${by - ux * headW * 0.5}`;
  const pad = 16;
  const box = svgBox([x1, x2, bx], [y1, y2, by], pad);
  const shift = (x: number, y: number) => `${x - box.minX},${y - box.minY}`;
  return (
    <svg
      className="mk mk-svg mk-arrow"
      data-markup-id={m.id}
      data-markup-kind="arrow"
      aria-label="Arrow annotation"
      style={{
        left: box.minX,
        top: box.minY,
        width: box.w,
        height: box.h,
        outline: selected ? "2px dashed var(--accent)" : undefined,
        outlineOffset: 2,
      }}
    >
      <line
        x1={x1 - box.minX}
        y1={y1 - box.minY}
        x2={bx - box.minX}
        y2={by - box.minY}
        stroke={m.color}
        strokeWidth={width}
        strokeLinecap="round"
        pointerEvents="none"
      />
      <polygon points={corners.split(" ").map((pt) => {
        const [px, py] = pt.split(",").map(Number);
        return shift(px, py);
      }).join(" ")} fill={m.color} pointerEvents="none" />
      <line
        className="mk-hit"
        x1={x1 - box.minX}
        y1={y1 - box.minY}
        x2={x2 - box.minX}
        y2={y2 - box.minY}
        stroke="transparent"
        strokeWidth={Math.max(14, width + 8)}
        style={{ pointerEvents: interactive ? "stroke" : "none" }}
        onMouseDown={onDown}
        onClick={(e) => onPick(e, m.id)}
      />
    </svg>
  );
}

function MarkupDraftShape({
  draft,
  scale,
  color,
  stroke,
}: {
  draft: MarkupDraft;
  scale: number;
  color: string;
  stroke: number;
}) {
  const width = Math.max(1, stroke * scale);
  if (draft.kind === "rect" || draft.kind === "ellipse") {
    const x = Math.min(draft.x0, draft.x1) * scale;
    const y = Math.min(draft.y0, draft.y1) * scale;
    const w = Math.abs(draft.x1 - draft.x0) * scale;
    const h = Math.abs(draft.y1 - draft.y0) * scale;
    if (w < 2 || h < 2) return null;
    return (
      <div className="mk mk-shape mk-draft" style={{ left: x, top: y, width: w, height: h, pointerEvents: "none" }}>
        <div
          className={draft.kind === "rect" ? "mk-rect-border" : "mk-ellipse-border"}
          style={{ borderColor: color, borderWidth: width }}
        />
      </div>
    );
  }
  if (draft.kind === "arrow") {
    const pts = [
      { x: draft.x1 * scale, y: draft.y1 * scale },
      { x: draft.x2 * scale, y: draft.y2 * scale },
    ];
    if (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 4) return null;
    const pad = 8;
    const box = svgBox(pts.map((p) => p.x), pts.map((p) => p.y), pad);
    return (
      <svg className="mk mk-svg mk-draft" style={{ left: box.minX, top: box.minY, width: box.w, height: box.h }}>
        <line
          x1={pts[0].x - box.minX}
          y1={pts[0].y - box.minY}
          x2={pts[1].x - box.minX}
          y2={pts[1].y - box.minY}
          stroke={color}
          strokeWidth={width}
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (draft.kind !== "freehand") return null;
  if (draft.points.length < 2) return null;
  const pts = draft.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const pad = 8;
  const box = svgBox(pts.map((p) => p.x), pts.map((p) => p.y), pad);
  return (
    <svg className="mk mk-svg mk-draft" style={{ left: box.minX, top: box.minY, width: box.w, height: box.h }}>
      <polyline
        points={pts.map((p) => `${p.x - box.minX},${p.y - box.minY}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
