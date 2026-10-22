import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Contains a panel's render error to that panel: the others, and the app, keep running. A new `resetKey` (another tab)
 * retries. `onClose` (an on-demand panel) adds a Close that gives the slot back to its default panels.
 */
export class PanelBoundary extends Component<{ title: string; resetKey: string; onClose?: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`code-git: the ${this.props.title} panel failed`, error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-3 text-sm">
        <p className="text-destructive">The {this.props.title} panel failed: {error.message}</p>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>Retry</Button>
          {this.props.onClose && <Button variant="outline" size="sm" onClick={() => { this.setState({ error: null }); this.props.onClose!(); }}>Close {this.props.title}</Button>}
        </div>
      </div>
    );
  }
}
