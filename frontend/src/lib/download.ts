// The only place that builds an object URL or a download link: the bytes come from the backend, the filename from its sanitizer.

/** Saves `bytes` as a file named `filename` through a local blob: URL that is never rendered into the page. */
export function downloadBytes(filename: string, bytes: Uint8Array, type = 'text/x-diff'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // After the click's task: the browser has taken the blob by then.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
