import { ApiError } from '@/lib/api';
import { getIntegrations } from '@/lib/endpoints';
import { embedded } from '@/lib/host';
import { createStore } from './store';

// The sibling cc plugins code-git links to, by plugin id: null when it is not enabled (or code-git is not in cc).

export interface IntegrationsState { codeReview: string | null }

const INITIAL: IntegrationsState = { codeReview: null };
export const integrationsStore = createStore<IntegrationsState>(INITIAL);
export const resetIntegrations = (): void => integrationsStore.set(INITIAL);

/** Asks the backend once, only inside cc; a failure hides the links and is logged. */
export async function loadIntegrations(): Promise<void> {
  if (!embedded()) return;
  try {
    const r = await getIntegrations();
    integrationsStore.set({ codeReview: r.codeReview?.id ?? null });
  } catch (e) {
    integrationsStore.set(INITIAL);
    console.warn('code-git: links to code-review hidden:', e instanceof ApiError ? `${e.code ?? e.status} ${e.message}` : e);
  }
}
