'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface StreamingMessageProps {
  isStreaming: boolean;
  content: string;
  isThinking?: boolean;
}

export function StreamingMessage({ isStreaming, content, isThinking }: StreamingMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as content streams
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [content, isStreaming]);

  if (isThinking && !content) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Thinking...</span>
      </div>
    );
  }

  return (
    <div ref={contentRef}>
      <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
              p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              pre: ({ children }) => <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-3 text-sm font-mono">{children}</pre>,
              code: ({ className, children, ...props }: any) => !className
                  ? <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>
                  : <code className={className} {...props}>{children}</code>,
              h1: ({ children }) => <h1 className="font-semibold mb-2 mt-4 text-lg">{children}</h1>,
              h2: ({ children }) => <h2 className="font-semibold mb-2 mt-4 text-base">{children}</h2>,
              h3: ({ children }) => <h3 className="font-semibold mb-2 mt-4 text-sm">{children}</h3>,
              a: ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">{children}</a>,
              blockquote: ({ children }) => <blockquote className="border-l-4 border-muted pl-4 italic mb-3">{children}</blockquote>,
          }}
      >
          {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
      )}
    </div>
  );
}
