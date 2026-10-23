import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

/** How every file list shows its files: full paths, or nested directories. */
export type FileView = 'path' | 'tree';

const KEY = 'graph:fileView';

/** Global, persisted as `code-git:graph:fileView`: one choice shared by every file list. */
export const fileViewStore = createStore<FileView>(getItem(KEY) === 'tree' ? 'tree' : 'path');
fileViewStore.subscribe(() => setItem(KEY, fileViewStore.get()));

export const setFileView = (v: FileView): void => fileViewStore.set(v);
export const useFileView = (): FileView => useStore(fileViewStore);
export const resetFileView = (): void => fileViewStore.set('path');
