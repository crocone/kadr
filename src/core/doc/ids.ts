/** Ids for documents, captures and layers. crypto.randomUUID exists in both the SW and the window. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export const newDocId = () => newId('doc')
export const newImageId = () => newId('img')
export const newLayerId = () => newId('layer')
export const newPresetId = () => newId('preset')
