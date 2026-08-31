import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Transformer } from 'react-konva'

/** Result of the frame gesture in document coordinates, before rotation. */
export type TransformBox = { x: number; y: number; w: number; h: number; rotation: number }

/**
 * Selection frame over the chosen object — a layer or the capture itself.
 *
 * Konva scales the node while the document stores sizes, so when the gesture ends
 * the scale is converted into dimensions and reset to one. Otherwise the object
 * would accumulate scale on top of scale and drift from what the model records.
 */
export function SelectionFrame({
  nodeId,
  liveWidth = false,
  onTransform,
}: {
  nodeId: string | null
  /**
   * Resizes the box, not the content: scale is cancelled during the gesture and
   * converted into node width. The label rewraps by words to fit the frame while
   * letters keep their size — a stretched font is a distortion, not a resize.
   */
  liveWidth?: boolean
  onTransform: (box: TransformBox) => void
}) {
  const ref = useRef<Konva.Transformer>(null)

  useEffect(() => {
    const transformer = ref.current
    if (!transformer) return

    // The stage is taken from the transformer itself: reading the stage ref during render is not allowed.
    const stage = transformer.getStage()
    const node = nodeId && stage ? stage.findOne(`#${nodeId}`) : null

    transformer.nodes(node ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }, [nodeId])

  return (
    <Transformer
      ref={ref}
      rotateEnabled
      ignoreStroke
      // A label's height follows its content, so only the side handles remain:
      // otherwise you drag the bottom and the text jumps up and down.
      {...(liveWidth ? { enabledAnchors: ['middle-left', 'middle-right'] } : {})}
      borderStroke="#6d5cf5"
      anchorStroke="#6d5cf5"
      anchorSize={8}
      boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
      onTransform={(event) => {
        if (!liveWidth) return
        const node = event.target
        node.width(Math.max(8, node.width() * node.scaleX()))
        node.scale({ x: 1, y: 1 })
      }}
      onTransformEnd={(event) => {
        const node = event.target
        const scaleX = node.scaleX()
        const scaleY = node.scaleY()

        const box = {
          // The capture node is positioned by its center, layer nodes by a corner;
          // subtracting the node's own offset reduces both to the pre-rotation top-left.
          x: node.x() - node.offsetX() * scaleX,
          y: node.y() - node.offsetY() * scaleY,
          w: Math.max(1, node.width() * scaleX),
          h: Math.max(1, node.height() * scaleY),
          rotation: node.rotation(),
        }

        node.scale({ x: 1, y: 1 })
        onTransform(box)
      }}
    />
  )
}
