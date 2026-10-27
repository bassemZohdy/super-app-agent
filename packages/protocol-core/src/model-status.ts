import { translate, type Locale, type CatalogKey } from './i18n.ts';

/** Public model metadata only. No provider URL, credential or raw provider error belongs in a shell. */
export interface ModelStatus { provider?: string; model?: string; enabled?: boolean; configured?: boolean; ready?: boolean; mode?: string }
export function modelStatusLabel(model: ModelStatus | null | undefined, options: { locale?: Locale; connection?: 'checking' | 'online' | 'offline'; inference?: 'connected' | 'error' } = {}): string {
  const locale = options.locale || 'en';
  const local = ['local', 'llama.cpp'].includes(model?.provider || '') || model?.mode === 'local';
  const provider = model?.provider === 'litellm' ? 'LiteLLM' : model?.provider === 'openrouter' ? 'OpenRouter' : translate(locale, local ? 'model.local' : 'model.unknown');
  let key: CatalogKey;
  if (options.connection === 'offline') key = 'model.offline';
  else if (options.connection === 'checking') key = 'model.checking';
  else if (options.inference === 'error') key = 'model.error';
  else if (!model?.enabled) key = 'status.demoMode';
  else if (model.configured === false) key = 'model.unconfigured';
  else if (options.inference === 'connected') key = 'model.connected';
  else if (model.ready) key = 'model.ready';
  else key = local ? 'model.warming' : 'model.configured';
  return translate(locale, key, { provider });
}
