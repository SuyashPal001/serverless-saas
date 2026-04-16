'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Wrench, Check, X, Loader2 } from 'lucide-react';

interface ToolCallCardProps {
  toolName: string;
  toolCallId: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  isLoading?: boolean;
  durationMs?: number;
}

function resultSummary(result: unknown): string {
    if (result === undefined) return '';
    if (typeof result === 'string') {
        const t = result.trim();
        return t.slice(0, 55) + (t.length > 55 ? '…' : '');
    }
    if (Array.isArray(result)) return `${result.length} result${result.length !== 1 ? 's' : ''}`;
    return '1 result';
}

export function ToolCallCard({
  toolName,
  toolCallId,
  arguments: args,
  result,
  error,
  isLoading,
  durationMs,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const status = isLoading ? 'loading' : error ? 'error' : result !== undefined ? 'success' : 'pending';

  return (
    <div className="bg-[#141414] border-[0.5px] border-[#222] rounded-[10px] overflow-hidden my-2 text-foreground">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-[14px] py-[10px] bg-transparent hover:bg-white/[0.02] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        
        <Wrench className="h-4 w-4 text-primary" />
        
        <span className="font-medium text-sm">{toolName}</span>

        {!isExpanded && result !== undefined && (
            <span className="text-xs text-[#444] font-mono truncate max-w-[180px]">
                {resultSummary(result)}
            </span>
        )}

        <div className="flex-1" />
        
        {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {status === 'success' && <Check className="h-4 w-4 text-green-500" />}
        {status === 'error' && <X className="h-4 w-4 text-red-500" />}
        
        {durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{durationMs}ms</span>
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-[14px] py-[10px] border-t border-[#222] space-y-3 bg-[#0e0e0e]">
          {args && Object.keys(args).length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Arguments</div>
              <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {result !== undefined && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Result</div>
              <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {error && (
            <div>
              <div className="text-xs font-medium text-red-500 mb-1">Error</div>
              <pre className="text-xs bg-red-500/10 text-red-500 p-2 rounded whitespace-pre-wrap">
                {error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
