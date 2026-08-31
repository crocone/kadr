/**
 * Connection presets: default base URL and model.
 *
 * This is data, not code — the list eases first-time setup but decides nothing.
 * Every field is hand-editable, and anything speaking the OpenAI-compatible
 * protocol can be plugged in: OpenRouter, a corporate proxy, a custom build.
 *
 * URLs and model names change on the provider side, so these are a hint, not a
 * promise: if a provider renames a model, the user types the new name without
 * waiting for an extension update.
 */
export type PresetId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio' | 'custom'

export type Preset = {
  id: PresetId
  label: string
  baseUrl: string
  model: string
  /** Image-editing model: provider-specific and distinct from the text model. */
  imageModel: string
  /** Whether a key is needed; a local server needs none. */
  needsKey: boolean
  /** Where to get a key — shown as a link next to the field. */
  keysUrl?: string
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
    needsKey: true,
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-opus-5',
    // The provider has no image editing: field left empty, the panel says so.
    imageModel: '',
    needsKey: true,
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
    needsKey: true,
    keysUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2-vision',
    imageModel: '',
    needsKey: false,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    imageModel: '',
    needsKey: false,
  },
  { id: 'custom', label: 'Свой адрес', baseUrl: '', model: '', imageModel: '', needsKey: false },
]

export function presetById(id: PresetId): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]!
}

/**
 * Preset lookup by URL: settings store the URL, not a provider name — so the
 * connection survives a preset rename and the list stays replaceable.
 */
export function presetForUrl(baseUrl: string): Preset | undefined {
  const clean = baseUrl.trim().replace(/\/+$/, '')
  return PRESETS.find((preset) => preset.baseUrl !== '' && preset.baseUrl === clean)
}

/** Local endpoint: implies no key required and data never leaves the machine. */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}
