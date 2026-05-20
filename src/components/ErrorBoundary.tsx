import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { Language } from '../types';
import { getExtraCopy } from '../localization/extra';

interface Props {
  children: ReactNode;
  language?: Language;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const t = getExtraCopy(this.props.language ?? 'English').app;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-8 text-center">
        <div className="w-16 h-16 bg-[#800000] rounded-[24px] flex items-center justify-center text-white shadow-xl shadow-red-900/20 mb-6">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tighter mb-2">
          {t.unexpectedTitle}
        </h1>
        <p className="text-sm text-gray-400 font-medium mb-8 max-w-xs">
          {t.unexpectedBody}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 active:scale-[0.98]"
        >
          {t.reloadApp}
        </button>
      </div>
    );
  }
}
